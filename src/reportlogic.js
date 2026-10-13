// Report builder logic: what each field can do, joining records to their parents,
// filters, totals, grouping, time buckets, the gap-free grid, and what a dropped
// field does to a widget. Pure functions (no DOM, no Firebase), so they are unit-tested.
//
// A report: { id, name, ownerId, shared, widgets: [widget], createdAt, updatedAt }
// A widget: { id, type: 'kpi'|'bar'|'line'|'table', form, title|null,
//             measure: { fn: 'count'|'sum'|'avg', ref? }, group?, time?, interval?: 'week'|'month',
//             columns?: [ref], filter?: { ref, op: 'is'|'not', value }, sort?: { i, dir },
//             cols: 3..12, rows: 1..4 }
// A field reference: { form, id }. It may point at the widget's own form or at a form
// above it (a parent form), reached through each record's parentId.
//
// ctx (built by reports.js from the live app):
//   forms[]        forms this person can see
//   formById(id), recById(id), records (visible records)
//   valOf(field, rec, form), fmt(field, value), recTitle(rec, form), profiles

export const GRID = 12;
export const WIDTHS = [3, 4, 6, 8, 9, 12];
export const MAX_ROWS = 4;

/* ---------- fields ---------- */

const SYSTEM = [
  { id: '_created', label: 'Created on', type: 'date', system: true },
  { id: '_updated', label: 'Last edited', type: 'date', system: true },
  { id: '_owner', label: 'Created by', type: 'owner', system: true },
];

/** The form's title field, the same rule Formwright uses for record titles. */
export function titleFieldOf(form) {
  const fs = form.fields || [];
  return fs.find((f) => f.id === form.titleField) || fs.find((f) => ['text', 'email', 'phone', 'url'].includes(f.type)) || fs.find((f) => f.type !== 'heading');
}

/** Fields a report can use: the form's own (minus layout-only ones) plus Created on / Last edited / Created by. */
export function reportFields(form) {
  const own = (form.fields || []).filter((f) => !['heading', 'signature'].includes(f.type));
  return own.concat(SYSTEM);
}

export function fieldOf(ctx, ref) {
  if (!ref) return null;
  const form = ctx.formById(ref.form);
  if (!form) return null;
  return reportFields(form).find((f) => f.id === ref.id) || null;
}

/**
 * num   totals and averages      date  charts over time
 * group bar-chart groups          key   the form's title field (a table, or a group)
 * other table columns only
 */
export function kindOf(f, form) {
  if (!f) return 'none';
  if (['number', 'decimal', 'currency', 'percent', 'range', 'rating'].includes(f.type)) return 'num';
  if (f.type === 'formula') return f.format === 'text' ? 'other' : 'num';
  if (['date', 'datetime'].includes(f.type)) return 'date';
  if (form && !f.system) { const t = titleFieldOf(form); if (t && t.id === f.id) return 'key'; }
  if (['select', 'radio', 'multiselect', 'checkbox', 'text', 'relation', 'owner', 'color'].includes(f.type)) return 'group';
  return 'other';
}

export function glyphOf(f) {
  return ({ text: 'Aa', textarea: '¶', email: '@', phone: '+1', url: '//', location: '⌖', number: '#', decimal: '#', currency: '$', percent: '%', rating: '★', range: '⟷', formula: 'ƒx', date: '◷', time: '◷', datetime: '◷', checkbox: '✓', select: '▾', radio: '◉', multiselect: '☰', file: '⇪', image: '▣', color: '◐', relation: '↗', owner: '☺' })[f.type] || '·';
}

/* ---------- forms above a form (parents) ---------- */

export function parentsOf(ctx, formId) {
  return ctx.forms.filter((f) => (f.children || []).some((c) => c.formId === formId)).map((f) => f.id);
}

/** [formId, its parents, their parents, …] without repeats. */
export function chainOf(ctx, formId) {
  const out = [formId];
  for (let i = 0; i < out.length; i++) parentsOf(ctx, out[i]).forEach((p) => { if (!out.includes(p)) out.push(p); });
  return out;
}

/* ---------- values ---------- */

/** The value of ref for a record of the widget's form, following parentId up to ref.form. */
export function valueOf(ctx, rec, ref) {
  let r = rec, guard = 0;
  while (r && r.formId !== ref.form && guard++ < 10) r = r.parentId ? ctx.recById(r.parentId) : null;
  if (!r) return undefined;
  if (ref.id === '_created') return r.createdAt;
  if (ref.id === '_updated') return r.updatedAt || r.createdAt;
  if (ref.id === '_owner') return r.ownerId;
  const form = ctx.formById(ref.form);
  const f = form && (form.fields || []).find((x) => x.id === ref.id);
  if (!f) return undefined;
  if (f.type === 'formula') {
    const saved = r.values && r.values[f.id];
    if (saved !== undefined && saved !== null && saved !== '') return saved;
    return ctx.valOf ? ctx.valOf(f, r, form) : undefined;
  }
  return r.values ? r.values[f.id] : undefined;
}

/** Milliseconds for a date-ish value ('2026-10-13', '2026-10-13T09:30', or a timestamp). */
export function timeOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v);
  const t = new Date(s.length === 10 ? s + 'T00:00' : s).getTime();
  return isNaN(t) ? null : t;
}

export function isEmptyVal(v) { return v == null || v === '' || (Array.isArray(v) && !v.length); }

/** Text for a group or a table cell. */
export function textOf(ctx, f, v) {
  if (f.type === 'owner') return (ctx.profiles && ctx.profiles[v] && ctx.profiles[v].displayName) || (v ? 'Someone' : '');
  if (f.id === '_created' || f.id === '_updated') return v ? new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  if (isEmptyVal(v)) return '';
  if (f.type === 'checkbox') return v ? 'Yes' : 'No';
  try { return ctx.fmt ? String(ctx.fmt(f, v) ?? '') : String(v); } catch (e) { return String(v); }
}

/* ---------- widget data ---------- */

export function filterValues(f) {
  if (f.type === 'checkbox') return ['Yes', 'No'];
  return (f.options || []).slice();
}

/** Records of the widget's form that pass its filter. */
export function rowsOf(ctx, w) {
  let list = ctx.records.filter((r) => r.formId === w.form);
  const flt = w.filter;
  if (flt) {
    const f = fieldOf(ctx, flt.ref);
    if (f) {
      list = list.filter((r) => {
        const v = valueOf(ctx, r, flt.ref);
        let hit;
        if (f.type === 'multiselect') hit = Array.isArray(v) && v.includes(flt.value);
        else if (f.type === 'checkbox') hit = (v ? 'Yes' : 'No') === flt.value;
        else hit = String(v ?? '') === String(flt.value);
        return flt.op === 'not' ? !hit : hit;
      });
    }
  }
  return list;
}

export function measureOf(ctx, w, list) {
  const m = w.measure || { fn: 'count' };
  if (m.fn === 'count' || !m.ref) return list.length;
  const nums = list.map((r) => Number(valueOf(ctx, r, m.ref))).filter((n) => !isNaN(n) && n !== null);
  const vals = list.map((r) => valueOf(ctx, r, m.ref)).filter((v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v))).map(Number);
  const sum = vals.reduce((a, b) => a + b, 0);
  if (m.fn === 'avg') return vals.length ? sum / vals.length : null;
  return nums.length ? sum : 0;
}

/** [{ key, value }] for a bar chart, in the field's own option order, else largest first; at most 8 bars. */
export function groupsOf(ctx, w, list) {
  const f = fieldOf(ctx, w.group);
  if (!f) return [];
  const m = new Map();
  list.forEach((r) => {
    const v = valueOf(ctx, r, w.group);
    let keys;
    if (f.type === 'multiselect') keys = Array.isArray(v) && v.length ? v : ['(blank)'];
    else if (f.type === 'relation') { const t = v && ctx.recById(v); keys = [t ? ctx.recTitle(t) : '(blank)']; }
    else { const t = textOf(ctx, f, v); keys = [t || '(blank)']; }
    keys.forEach((k) => { if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  });
  let items = [...m.entries()].map(([key, rs]) => ({ key, value: measureOf(ctx, w, rs) || 0 }));
  const flt = w.filter;
  if (flt && flt.op === 'not' && flt.ref.form === w.group.form && flt.ref.id === w.group.id) items = items.filter((x) => x.key !== flt.value);
  if (f.options && f.options.length) {
    const pos = (k) => { const i = f.options.indexOf(k); return i < 0 ? 999 : i; };
    items.sort((a, b) => pos(a.key) - pos(b.key) || b.value - a.value);
  } else items.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  if (items.length > 8) {
    const rest = items.slice(7);
    items = items.slice(0, 7).concat([{ key: 'Other (' + rest.length + ')', value: rest.reduce((a, b) => a + b.value, 0), other: true }]);
  }
  return items;
}

/** Buckets ending at `now`: the last 26 weeks (Monday starts) or 12 months. */
export function bucketsOf(ctx, w, list, now) {
  const weeks = (w.interval || 'week') === 'week';
  const n = weeks ? 26 : 12;
  const end = new Date(now);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    let a, b, d;
    if (weeks) {
      d = new Date(end); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - i * 7);
      a = d.getTime(); const e = new Date(d); e.setDate(e.getDate() + 7); b = e.getTime();
    } else {
      d = new Date(end.getFullYear(), end.getMonth() - i, 1); a = d.getTime(); b = new Date(end.getFullYear(), end.getMonth() - i + 1, 1).getTime();
    }
    const rs = list.filter((r) => { const t = timeOf(valueOf(ctx, r, w.time)); return t !== null && t >= a && t < b; });
    out.push({ start: a, date: d, value: measureOf(ctx, w, rs) || 0 });
  }
  return out;
}

/** A round step for axis gridlines. */
export function niceStep(x) {
  if (!(x > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/* ---------- titles ---------- */

export function measureName(ctx, w) {
  const m = w.measure || { fn: 'count' };
  const form = ctx.formById(w.form);
  if (m.fn === 'count' || !m.ref) return form ? form.name : 'Records';
  const f = fieldOf(ctx, m.ref);
  return (m.fn === 'avg' ? 'Average ' : 'Total ') + (f ? f.label.toLowerCase() : 'value');
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function autoTitle(ctx, w) {
  const form = ctx.formById(w.form);
  const mn = measureName(ctx, w);
  const counting = !w.measure || w.measure.fn === 'count' || !w.measure.ref;
  if (w.type === 'kpi') return counting ? 'Number of ' + (form ? form.name.toLowerCase() : 'records') : cap(mn);
  if (w.type === 'bar') { const g = fieldOf(ctx, w.group); return cap(mn) + ' by ' + (g ? g.label.toLowerCase() : '…'); }
  if (w.type === 'line') return cap(mn) + ' per ' + (w.interval || 'week');
  return form ? form.name : 'Table';
}

export function refLabel(ctx, ref, baseForm) {
  const f = fieldOf(ctx, ref);
  if (!f) return 'Removed field';
  if (ref.form === baseForm) return f.label;
  const form = ctx.formById(ref.form);
  return (form ? form.name : '?') + ' › ' + f.label;
}

export function refsOf(w) {
  const out = [];
  if (w.measure && w.measure.ref) out.push(w.measure.ref);
  if (w.group) out.push(w.group);
  if (w.time) out.push(w.time);
  if (w.filter) out.push(w.filter.ref);
  (w.columns || []).forEach((c) => out.push(c));
  return out;
}

export function joinedForms(w) { return [...new Set(refsOf(w).map((r) => r.form).filter((id) => id !== w.form))]; }

/* ---------- making and changing widgets ---------- */

export function dims(type) { return type === 'kpi' ? { cols: 3, rows: 1 } : type === 'table' ? { cols: 12, rows: 3 } : { cols: 6, rows: 2 }; }

export function defaultColumns(ctx, formId) {
  const form = ctx.formById(formId);
  if (!form) return [];
  const t = titleFieldOf(form);
  const cols = [];
  if (t) cols.push({ form: formId, id: t.id });
  const parent = parentsOf(ctx, formId)[0];
  if (parent) { const pt = titleFieldOf(ctx.formById(parent)); if (pt) cols.push({ form: parent, id: pt.id }); }
  (form.fields || []).filter((f) => (!t || f.id !== t.id) && ['num', 'group', 'date'].includes(kindOf(f, form)) && f.type !== 'multiselect')
    .slice(0, 5 - cols.length).forEach((f) => cols.push({ form: formId, id: f.id }));
  return cols;
}

/** A new widget for a field dropped on an empty spot. */
export function widgetFor(ctx, ref, id) {
  const form = ctx.formById(ref.form);
  const f = fieldOf(ctx, ref);
  const k = kindOf(f, form);
  const base = { id, form: ref.form, title: null, measure: { fn: 'count' } };
  if (k === 'num') return { ...base, type: 'kpi', measure: { fn: ['rating', 'percent', 'range'].includes(f.type) ? 'avg' : 'sum', ref }, ...dims('kpi') };
  if (k === 'date') return { ...base, type: 'line', time: ref, interval: 'month', ...dims('line') };
  if (k === 'group') return { ...base, type: 'bar', group: ref, ...dims('bar') };
  const columns = defaultColumns(ctx, ref.form);
  if (!columns.some((c) => c.form === ref.form && c.id === ref.id)) columns.push(ref);
  return { ...base, type: 'table', columns, ...dims('table') };
}

/**
 * Apply a field dropped on widget w (a copy is changed and returned).
 * { widget, message } on success; { widget: null, message } when the forms aren't linked.
 */
export function dropField(ctx, w0, ref) {
  const w = JSON.parse(JSON.stringify(w0));
  const f = fieldOf(ctx, ref);
  const form = ctx.formById(ref.form);
  if (!f || !form) return { widget: null, message: 'That field is no longer available.' };
  let note = '';
  if (!chainOf(ctx, w.form).includes(ref.form)) {
    const up = chainOf(ctx, ref.form);
    if (up.includes(w.form) && refsOf(w).every((r) => up.includes(r.form))) {
      note = ' It now counts ' + form.name.toLowerCase() + ', so ' + (ctx.formById(w.form) || { name: 'the other' }).name + ' fields still work.';
      if (w.type === 'table' && !(w.columns && w.columns.length)) w.columns = defaultColumns(ctx, w.form);
      w.form = ref.form;
    } else {
      const a = form.name, b = (ctx.formById(w.form) || { name: 'this widget' }).name;
      return { widget: null, message: a + ' and ' + b + ' aren’t linked, so they can’t share a widget. Drop it on an empty spot to start a new one.' };
    }
  }
  const k = kindOf(f, form);
  const label = f.label.toLowerCase();
  const before = w.type;
  let message;
  if (w.type === 'table') {
    w.columns = (w.columns && w.columns.length) ? w.columns : defaultColumns(ctx, w.form);
    if (w.columns.some((c) => c.form === ref.form && c.id === ref.id)) return { widget: w, message: f.label + ' is already a column.' };
    w.columns.push(ref);
    message = 'Added ' + label + ' as a column.';
  } else if (k === 'num') {
    w.measure = { fn: ['rating', 'percent', 'range'].includes(f.type) ? 'avg' : 'sum', ref };
    message = 'Now showing ' + (w.measure.fn === 'avg' ? 'average ' : 'total ') + label + '.';
  } else if (k === 'date') {
    w.type = 'line'; w.time = ref; w.interval = w.interval || 'month';
    message = 'Now a chart over time, by ' + label + '.';
  } else if (k === 'group' || k === 'key') {
    w.type = 'bar'; w.group = ref;
    message = 'Grouped by ' + label + '.';
  } else {
    return { widget: null, message: f.label + ' can’t be charted. Drop it on a table to add it as a column.' };
  }
  if (before !== w.type) {
    w.title = null;
    const d = dims(w.type);
    w.cols = Math.max(w.cols || 0, d.cols);
    w.rows = Math.max(w.rows || 0, d.rows);
  }
  return { widget: w, message: message + note };
}

/** Switch a widget's type, filling in what the new type needs. */
export function changeType(ctx, w0, type) {
  const w = JSON.parse(JSON.stringify(w0));
  if (w.type === type) return w;
  const fields = [];
  chainOf(ctx, w.form).forEach((fid) => { const form = ctx.formById(fid); if (form) reportFields(form).forEach((f) => fields.push({ ref: { form: fid, id: f.id }, kind: kindOf(f, form), f })); });
  w.type = type;
  if (type === 'bar' && !w.group) { const g = fields.find((x) => x.kind === 'group' && x.f.type !== 'owner') || fields.find((x) => x.kind === 'group' || x.kind === 'key'); w.group = g ? g.ref : null; }
  if (type === 'line' && !w.time) { const d = fields.find((x) => x.kind === 'date' && !x.f.system) || fields.find((x) => x.kind === 'date'); w.time = d ? d.ref : null; w.interval = w.interval || 'month'; }
  if (type === 'table' && !(w.columns && w.columns.length)) w.columns = defaultColumns(ctx, w.form);
  const d = dims(type);
  w.cols = d.cols; w.rows = type === 'kpi' ? 1 : Math.max(d.rows, w.rows || 1);
  return w;
}

/* ---------- the grid: rows that always fill the width ---------- */

const clampCols = (c) => Math.min(GRID, Math.max(3, Math.round(c || 6)));
const clampRows = (r) => Math.min(MAX_ROWS, Math.max(1, Math.round(r || 1)));

/**
 * Place widgets in rows of 12 columns, in order. A row's leftover columns go to its other
 * widgets (never the one being resized, `pinned`), so no row has a gap; every widget in a
 * row takes the row's tallest height.
 * Returns { [id]: { c0, c, r0, h, row } } plus `_rows` (total grid rows).
 */
export function layout(widgets, pinned) {
  const out = {};
  const rows = [];
  let cur = [], used = 0;
  const close = () => { if (cur.length) rows.push(cur); cur = []; used = 0; };
  widgets.forEach((w) => {
    const c = clampCols(w.cols || dims(w.type).cols);
    if (used + c > GRID) close();
    cur.push({ w, c }); used += c;
  });
  close();
  let r0 = 0;
  rows.forEach((row, ri) => {
    const left = GRID - row.reduce((a, x) => a + x.c, 0);
    if (left > 0) {
      const takers = row.filter((x) => x.w.id !== pinned);
      const pool = takers.length ? takers : row;
      const total = pool.reduce((a, x) => a + x.c, 0);
      const shares = pool.map((x) => ({ x, exact: (x.c / total) * left }));
      shares.forEach((s) => { s.add = Math.floor(s.exact); });
      let rest = left - shares.reduce((a, s) => a + s.add, 0);
      shares.slice().sort((a, b) => (b.exact - b.add) - (a.exact - a.add)).forEach((s) => { if (rest > 0) { s.add++; rest--; } });
      shares.forEach((s) => { s.x.c += s.add; });
    }
    const h = Math.max(...row.map((x) => clampRows(x.w.rows || dims(x.w.type).rows)));
    let c0 = 0;
    row.forEach((x) => { out[x.w.id] = { c0, c: x.c, r0, h, row: ri }; c0 += x.c; });
    r0 += h;
  });
  out._rows = r0;
  return out;
}

/** Store what is on screen, so a finished resize stays exactly as seen. */
export function settle(widgets, pinned) {
  const L = layout(widgets, pinned);
  return widgets.map((w) => ({ ...w, cols: L[w.id].c, rows: L[w.id].h }));
}

/** Resize one widget's width, and the height of its whole row. */
export function resize(widgets, id, cols, rows) {
  const L = layout(widgets, id);
  if (!L[id]) return widgets;
  const row = L[id].row;
  return widgets.map((w) => {
    if (w.id === id) return { ...w, cols: clampCols(cols), rows: clampRows(rows) };
    if (L[w.id].row === row) return { ...w, rows: clampRows(rows) };
    return w;
  });
}

export function snapCols(c) { return WIDTHS.reduce((best, s) => (Math.abs(s - c) < Math.abs(best - c) ? s : best), GRID); }

export function widthName(c) { return ({ 3: 'Quarter', 4: 'Third', 6: 'Half', 8: 'Two-thirds', 9: 'Three-quarters', 12: 'Full width' })[c] || c + '/12'; }
export function heightName(h) { return ['Short', 'Medium', 'Tall', 'Extra tall'][clampRows(h) - 1]; }

/** Move widget `fromId` before `toId` (or to the end when toId is null). */
export function move(widgets, fromId, toId) {
  if (fromId === toId) return widgets;
  const ws = widgets.slice();
  const i = ws.findIndex((w) => w.id === fromId);
  if (i < 0) return widgets;
  const [w] = ws.splice(i, 1);
  const j = toId ? ws.findIndex((x) => x.id === toId) : -1;
  ws.splice(j < 0 ? ws.length : j, 0, w);
  return ws;
}
