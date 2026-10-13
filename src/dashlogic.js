// Saved reports and dashboards: the maths behind each report type, filters, periods, and
// turning the old report canvases into dashboards. Pure functions (no DOM, no Firebase),
// built on reportlogic.js, so they are unit-tested.
//
// A saved report (reportDefs/{id}): { name, ownerId, shared, groups: [groupId], def, createdAt, updatedAt }
//   def: { form, type, measure: {fn, ref?}, group?, col?, time?, interval?, columns?: [ref],
//          conditions: [{ ref, op: 'is'|'not', value }], join: 'and'|'or', dateRef?, compare?, sort? }
// A dashboard (dashboards/{id}): { name, ownerId, shared, groups: [groupId], tiles, filters, createdAt, updatedAt }
//   tiles:   [{ id, report: reportId, cols, rows }] or [{ id, text: { title, body }, cols, rows }]
//   filters: { period: 'all'|'month'|'30d'|'quarter'|'year', fields: [ref] }

import {
  fieldOf, valueOf, timeOf, textOf, kindOf, chainOf, measureOf, reportFields, titleFieldOf,
  defaultColumns, isEmptyVal,
} from './reportlogic.js';

export const TYPES = [
  ['table', 'Table'], ['grouped', 'Grouped table'], ['pivot', 'Pivot'], ['bar', 'Bar'],
  ['line', 'Line'], ['area', 'Area'], ['donut', 'Donut'], ['kpi', 'KPI'],
];
export const PERIODS = [['all', 'All time'], ['month', 'This month'], ['30d', 'Last 30 days'], ['quarter', 'This quarter'], ['year', 'This year']];
export const MAX_PIVOT_ROWS = 30;
export const MAX_PIVOT_COLS = 12;

/* ---------- fields a report can use ---------- */

/** Every field on the report's form and the forms above it: [{ ref, f, form, kind }]. */
export function chainFields(ctx, formId) {
  const out = [];
  chainOf(ctx, formId).forEach((fid) => {
    const form = ctx.formById(fid);
    if (form) reportFields(form).forEach((f) => out.push({ ref: { form: fid, id: f.id }, f, form, kind: kindOf(f, form) }));
  });
  return out;
}

const sameRef = (a, b) => !!a && !!b && a.form === b.form && a.id === b.id;

/* ---------- filters ---------- */

/** The keys a record falls under for a field: one, or several for multiple choice. */
export function keysOf(ctx, f, v) {
  if (f.type === 'multiselect') return Array.isArray(v) && v.length ? v.map(String) : ['(blank)'];
  if (f.type === 'relation') { const t = v && ctx.recById(v); return [t ? ctx.recTitle(t) : '(blank)']; }
  const t = textOf(ctx, f, v);
  return [t || '(blank)'];
}

/** Does a record pass one condition? Values compare as the text people see. */
export function condHit(ctx, rec, cond) {
  const f = fieldOf(ctx, cond.ref);
  if (!f) return true;
  const v = valueOf(ctx, rec, cond.ref);
  let hit;
  if (cond.value === '(blank)') hit = isEmptyVal(v);
  else hit = keysOf(ctx, f, v).includes(String(cond.value));
  return cond.op === 'not' ? !hit : hit;
}

/** The date field the dashboard's period applies to. */
export function dateRefOf(ctx, def) {
  if (def.dateRef && fieldOf(ctx, def.dateRef)) return def.dateRef;
  if (def.time && fieldOf(ctx, def.time)) return def.time;
  const form = ctx.formById(def.form);
  const d = form && (form.fields || []).find((f) => f.type === 'date' || f.type === 'datetime');
  return d ? { form: def.form, id: d.id } : { form: def.form, id: '_created' };
}

/** Does a dashboard filter on `ref` reach this report? Only when the field is on its form or a form above it. */
export function filterReaches(ctx, def, ref) {
  return !!ref && chainOf(ctx, def.form).includes(ref.form);
}

/**
 * Records for a report: its own conditions (AND/OR), then the dashboard's field filters
 * (any ticked value) and period.  extra: { fields: [{ ref, values }], range: { from, to } }
 */
export function rowsFor(ctx, def, extra = {}) {
  let list = ctx.records.filter((r) => r.formId === def.form);
  const conds = (def.conditions || []).filter((c) => c && c.ref && fieldOf(ctx, c.ref) && c.value !== undefined && c.value !== '');
  if (conds.length) {
    list = list.filter((r) => (def.join === 'or' ? conds.some((c) => condHit(ctx, r, c)) : conds.every((c) => condHit(ctx, r, c))));
  }
  (extra.fields || []).forEach((ff) => {
    if (!ff || !ff.values || !ff.values.length || !filterReaches(ctx, def, ff.ref)) return;
    list = list.filter((r) => ff.values.some((v) => condHit(ctx, r, { ref: ff.ref, op: 'is', value: v })));
  });
  if (extra.range) {
    const dref = dateRefOf(ctx, def);
    list = list.filter((r) => { const t = timeOf(valueOf(ctx, r, dref)); return t != null && t >= extra.range.from && t < extra.range.to; });
  }
  return list;
}

/* ---------- periods ---------- */

/** { from, to, prevFrom, prevTo, label, prevLabel } for a period key, or null for all time. */
export function periodRange(key, now) {
  const d = new Date(now);
  const y = d.getFullYear(), m = d.getMonth();
  const at = (yy, mm, dd = 1) => new Date(yy, mm, dd).getTime();
  switch (key) {
    case 'month': return { from: at(y, m), to: at(y, m + 1), prevFrom: at(y, m - 1), prevTo: at(y, m), label: 'this month', prevLabel: 'last month' };
    case '30d': { const to = new Date(y, m, d.getDate() + 1).getTime(); const day = 864e5; return { from: to - 30 * day, to, prevFrom: to - 60 * day, prevTo: to - 30 * day, label: 'the last 30 days', prevLabel: 'the 30 days before' }; }
    case 'quarter': { const q = Math.floor(m / 3) * 3; return { from: at(y, q), to: at(y, q + 3), prevFrom: at(y, q - 3), prevTo: at(y, q), label: 'this quarter', prevLabel: 'last quarter' }; }
    case 'year': return { from: at(y, 0), to: at(y + 1, 0), prevFrom: at(y - 1, 0), prevTo: at(y, 0), label: 'this year', prevLabel: 'last year' };
    default: return null;
  }
}

/** A KPI's value now and in the period before: on a dashboard its period, otherwise this month vs last. */
export function kpiOf(ctx, def, extra, now) {
  const range = extra.range ? periodRange(extra.periodKey, now) : null;
  const cur = rowsFor(ctx, def, extra);
  const value = measureOf(ctx, def, cur);
  if (!def.compare) return { value, n: cur.length };
  const r = range || periodRange('month', now);
  const curRows = range ? cur : rowsFor(ctx, def, { ...extra, range: { from: r.from, to: r.to } });
  const prevRows = rowsFor(ctx, def, { ...extra, range: { from: r.prevFrom, to: r.prevTo } });
  const a = measureOf(ctx, def, curRows), b = measureOf(ctx, def, prevRows);
  const delta = b ? ((a - b) / Math.abs(b)) * 100 : null;
  return { value: range ? value : a, n: curRows.length, prev: b, delta, label: r.label, prevLabel: r.prevLabel };
}

/* ---------- report types ---------- */

function orderKeys(f, keys, totals) {
  if (f.options && f.options.length) {
    const pos = (k) => { const i = f.options.indexOf(k); return i < 0 ? 999 : i; };
    return keys.sort((a, b) => pos(a) - pos(b) || (totals.get(b) || 0) - (totals.get(a) || 0) || a.localeCompare(b));
  }
  if (f.type === 'date' || f.type === 'datetime' || f.id === '_created' || f.id === '_updated') return keys.sort();
  return keys.sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0) || a.localeCompare(b));
}

/** Records split by a field: [{ key, rows, value }], in the field's option order, else largest first. */
export function groupRows(ctx, def, ref, list) {
  const f = fieldOf(ctx, ref);
  if (!f) return [];
  const m = new Map();
  list.forEach((r) => keysOf(ctx, f, valueOf(ctx, r, ref)).forEach((k) => { if (!m.has(k)) m.set(k, []); m.get(k).push(r); }));
  const totals = new Map([...m.entries()].map(([k, rs]) => [k, measureOf(ctx, def, rs) || 0]));
  return orderKeys(f, [...m.keys()], totals).map((k) => ({ key: k, rows: m.get(k), value: totals.get(k) }));
}

/** Bar and donut: at most `max` groups, the rest folded into "Other". */
export function slicesOf(ctx, def, list, max = 8) {
  let items = groupRows(ctx, def, def.group, list).map(({ key, value }) => ({ key, value }));
  const notOne = (def.conditions || []).filter((c) => c.op === 'not' && sameRef(c.ref, def.group)).map((c) => String(c.value));
  if (notOne.length) items = items.filter((x) => !notOne.includes(x.key));
  if (items.length > max) {
    const rest = items.slice(max - 1);
    items = items.slice(0, max - 1).concat([{ key: 'Other (' + rest.length + ')', value: rest.reduce((a, b) => a + b.value, 0), other: true }]);
  }
  return items;
}

/** Pivot: rows × columns of the measure, with totals. */
export function pivotOf(ctx, def, list) {
  const rf = fieldOf(ctx, def.group), cf = fieldOf(ctx, def.col);
  if (!rf || !cf) return null;
  const rows = groupRows(ctx, def, def.group, list);
  const cols = groupRows(ctx, def, def.col, list);
  const colKeys = cols.slice(0, MAX_PIVOT_COLS).map((c) => c.key);
  const out = rows.slice(0, MAX_PIVOT_ROWS).map((r) => {
    const byCol = new Map(colKeys.map((k) => [k, []]));
    r.rows.forEach((rec) => keysOf(ctx, cf, valueOf(ctx, rec, def.col)).forEach((k) => { if (byCol.has(k)) byCol.get(k).push(rec); }));
    return { key: r.key, cells: colKeys.map((k) => (byCol.get(k).length ? measureOf(ctx, def, byCol.get(k)) : null)), total: r.value };
  });
  return {
    cols: colKeys, rows: out,
    colTotals: cols.slice(0, MAX_PIVOT_COLS).map((c) => c.value),
    grand: measureOf(ctx, def, list),
    moreRows: Math.max(0, rows.length - MAX_PIVOT_ROWS), moreCols: Math.max(0, cols.length - MAX_PIVOT_COLS),
  };
}

/** Value used to sort a table column. */
export function sortKey(ctx, rec, ref) {
  const f = fieldOf(ctx, ref);
  const v = valueOf(ctx, rec, ref);
  if (!f) return null;
  if (['date', 'datetime'].includes(f.type) || ref.id === '_created' || ref.id === '_updated') return timeOf(v);
  if (typeof v === 'number') return v;
  if (f.type === 'relation') { const t = v && ctx.recById(v); return t ? ctx.recTitle(t).toLowerCase() : null; }
  const t = textOf(ctx, f, v);
  return t ? t.toLowerCase() : null;
}
export function sortRecs(ctx, list, ref, dir) {
  if (!ref) return list;
  return list.map((r) => ({ r, k: sortKey(ctx, r, ref) })).sort((a, b) => {
    if (a.k == null || b.k == null) return a.k == null && b.k == null ? 0 : a.k == null ? 1 : -1;
    return (a.k > b.k ? 1 : a.k < b.k ? -1 : 0) * (dir < 0 ? -1 : 1);
  }).map((x) => x.r);
}

/* ---------- making and repairing reports ---------- */

/** Fill in whatever a report's type needs, from the fields its form can reach. */
export function normalizeDef(ctx, def0) {
  const def = JSON.parse(JSON.stringify(def0 || {}));
  if (!ctx.formById(def.form)) return def;
  const fields = chainFields(ctx, def.form);
  const pick = (kinds, avoid) => (fields.find((x) => kinds.includes(x.kind) && !x.f.system && !sameRef(x.ref, avoid)) || fields.find((x) => kinds.includes(x.kind) && !sameRef(x.ref, avoid)) || {}).ref || null;
  def.measure = def.measure && (def.measure.fn === 'count' || fieldOf(ctx, def.measure.ref)) ? def.measure : { fn: 'count' };
  def.conditions = Array.isArray(def.conditions) ? def.conditions : [];
  def.join = def.join === 'or' ? 'or' : 'and';
  const t = def.type || 'table';
  if (['bar', 'donut', 'grouped', 'pivot'].includes(t) && !fieldOf(ctx, def.group)) def.group = pick(['group', 'key']);
  if (t === 'pivot' && (!fieldOf(ctx, def.col) || sameRef(def.col, def.group))) def.col = pick(['group'], def.group);
  if (['line', 'area'].includes(t)) {
    if (!fieldOf(ctx, def.time)) { const own = fields.find((x) => x.kind === 'date' && !x.f.system && x.ref.form === def.form); def.time = own ? own.ref : { form: def.form, id: '_created' }; }
    def.interval = def.interval === 'week' ? 'week' : 'month';
  }
  if (['table', 'grouped'].includes(t)) { def.columns = (def.columns || []).filter((r) => fieldOf(ctx, r)); if (!def.columns.length) def.columns = defaultColumns(ctx, def.form); }
  return def;
}

/** A first report for a form: a bar chart of its first choice field, else a table. */
export function newDef(ctx, formId) {
  const fields = chainFields(ctx, formId).filter((x) => x.ref.form === formId);
  const g = fields.find((x) => x.kind === 'group' && !x.f.system && x.f.options && x.f.options.length);
  return normalizeDef(ctx, g ? { form: formId, type: 'bar', group: g.ref, measure: { fn: 'count' } } : { form: formId, type: 'table', measure: { fn: 'count' } });
}

/** A widget from an old report canvas, as a saved report's def. */
export function defFromWidget(w) {
  const def = { form: w.form, type: ['kpi', 'bar', 'line', 'table'].includes(w.type) ? w.type : 'table', measure: w.measure || { fn: 'count' }, conditions: [], join: 'and' };
  if (w.group) def.group = w.group;
  if (w.time) def.time = w.time;
  if (w.interval) def.interval = w.interval;
  if (w.columns) def.columns = w.columns;
  if (w.sort) def.sort = w.sort;
  if (w.filter && w.filter.ref) def.conditions.push({ ref: w.filter.ref, op: w.filter.op === 'not' ? 'not' : 'is', value: w.filter.value });
  return def;
}

/**
 * Turn an old report canvas into a dashboard and its saved reports. IDs are derived from
 * the old ones, so running it twice writes the same documents.
 */
export function migrateLegacy(rep, autoName) {
  const reports = (rep.widgets || []).filter((w) => w && w.form).map((w) => ({
    id: 'mig-' + rep.id + '-' + w.id,
    data: { name: (w.title || (autoName ? autoName(w) : '') || 'Report').slice(0, 120), ownerId: rep.ownerId, shared: !!rep.shared, groups: [], def: defFromWidget(w), createdAt: rep.createdAt || Date.now(), updatedAt: Date.now() },
  }));
  const tiles = (rep.widgets || []).filter((w) => w && w.form).map((w) => ({ id: 't' + w.id, report: 'mig-' + rep.id + '-' + w.id, cols: w.cols || 6, rows: w.rows || 2 }));
  return {
    dashboard: { id: 'mig-' + rep.id, data: { name: (rep.name || 'Dashboard').slice(0, 120), ownerId: rep.ownerId, shared: !!rep.shared, groups: [], tiles, filters: { period: 'all', fields: [] }, createdAt: rep.createdAt || Date.now(), updatedAt: Date.now() } },
    reports,
  };
}

/** Who sees a shared item in their lists: everyone, or members of its groups. Admins and owners always. */
export function visibleTo(item, me, uid) {
  if (!item) return false;
  if (item.ownerId === uid || (me && me.role === 'admin')) return true;
  if (!item.shared) return false;
  const gs = item.groups || [];
  return !gs.length || gs.some((g) => (me?.groups || []).includes(g));
}

/** Dashboards that show a report. */
export function usedOn(dashboards, reportId) {
  return dashboards.filter((d) => (d.tiles || []).some((t) => t.report === reportId));
}

export { titleFieldOf };
