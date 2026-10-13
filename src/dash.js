// Reports and dashboards.
//   Reports (#/reports, #/report/<id>): one saved chart, table, pivot or KPI each.
//   Dashboards (#/dashboards, #/dashboard/<id>): saved reports and text blocks laid out on a
//   gap-free grid, with a period and field filters across the top. A report placed on
//   several dashboards is one report: editing it changes it everywhere.
// Every number is worked out here, in the viewer's browser, from the records the viewer is
// allowed to see (store.records already holds only those).
import './reports.css';
import './dash.css';
import { store, saveReportDef, deleteReportDef, saveDashboard, deleteDashboard, setHomeDashboard, writeMigration } from './store.js';
import { canViewForm, isAdmin } from './access.js';
import { esc, uid, clone, toast, badge } from './ui.js';
import {
  fieldOf, valueOf, textOf, kindOf, chainOf, measureOf, bucketsOf, niceStep, refLabel, autoTitle, layout,
  settle, resize, WIDTHS, MAX_ROWS, widthName, heightName,
} from './reportlogic.js';
import {
  TYPES, PERIODS, chainFields, rowsFor, periodRange, kpiOf, slicesOf, groupRows, pivotOf, sortRecs, normalizeDef,
  newDef, migrateLegacy, visibleTo, usedOn, filterReaches, dateRefOf, keysOf,
} from './dashlogic.js';

let H = { fmt: null, valOf: null, recTitle: null, go: null, openRecord: null, renderMain: null };
export function initReports(helpers) { H = { ...H, ...helpers }; }

const D = {
  rid: null, draft: null, confirm: null, // report editor
  did: null, edit: null, picker: false,   // dashboard (edit = working copy while editing)
  fv: {},                                 // filter choices per dashboard: { period, fields: { key: value } }
  sorts: {},                              // table sorts per tile/report
  returnTo: null,                         // dashboard to add a new report to after its first save
  migrating: false, migrated: new Set(),
};

/* ---------- data ---------- */

let ctxCache = null;
function ctx() {
  if (ctxCache && ctxCache.r === store.records && ctxCache.f === store.forms && ctxCache.m === store.me && ctxCache.p === store.profiles) return ctxCache.c;
  const forms = store.forms.filter((f) => canViewForm(store.me, f.id));
  const byId = new Map(store.records.map((r) => [r.id, r]));
  const fById = new Map(forms.map((f) => [f.id, f]));
  const c = {
    forms, records: store.records, profiles: store.profiles,
    formById: (id) => fById.get(id) || null,
    recById: (id) => byId.get(id) || null,
    valOf: (f, rec, form) => (H.valOf ? H.valOf(f, rec, form) : rec.values?.[f.id]),
    fmt: (f, v) => (H.fmt ? H.fmt(f, v) : String(v)),
    recTitle: (rec) => (H.recTitle ? H.recTitle(rec) : rec.id),
  };
  ctxCache = { r: store.records, f: store.forms, m: store.me, p: store.profiles, c };
  return c;
}
const me = () => store.user?.uid;
const admin = () => isAdmin(store.me);
const reportsVisible = () => store.reportDefs.filter((r) => visibleTo(r, store.me, me()));
const dashesVisible = () => store.dashboards.filter((d) => visibleTo(d, store.me, me()));
const reportById = (id) => store.reportDefs.find((r) => r.id === id) || null;
const dashById = (id) => store.dashboards.find((d) => d.id === id) || null;
const canChange = (item) => !!item && (item.ownerId === me() || (admin() && item.shared));
const nameOf = (u) => store.profiles[u]?.displayName || (u === me() ? 'you' : 'someone');
const homeId = () => store.profiles[me()]?.homeDashboard || '';
const refKey = (r) => (r ? r.form + '|' + r.id : '');
const refOf = (k) => { const [form, id] = String(k || '').split('|'); return form && id ? { form, id } : null; };
// Redraw after the current event finishes: a field losing focus while the page is being
// redrawn fires "change", and redrawing again inside that redraw would fail.
let paintQueued = false, afterPaint = [];
const repaint = (after) => {
  if (after) afterPaint.push(after);
  if (paintQueued) return;
  paintQueued = true;
  queueMicrotask(() => { paintQueued = false; if (H.renderMain) H.renderMain(); const fns = afterPaint; afterPaint = []; fns.forEach((f) => f()); });
};

/* ---------- old report canvases become dashboards (once, by their owner) ---------- */

export async function maybeMigrate() {
  if (D.migrating || !store.dashReady || !store.reportsReady || !store.user) return;
  const mine = store.reports.filter((r) => r.ownerId === me() && !D.migrated.has(r.id));
  if (!mine.length) return;
  D.migrating = true;
  const c = ctx();
  for (const rep of mine) {
    D.migrated.add(rep.id);
    const mig = migrateLegacy(rep, (w) => (c.formById(w.form) ? autoTitle(c, w) : ''));
    if (!admin()) { mig.dashboard.data.shared = false; mig.reports.forEach((r) => { r.data.shared = false; }); }
    try { await writeMigration(mig, rep.id); } catch (e) { console.error('[formwright] moving report', rep.id, e); }
  }
  D.migrating = false;
  toast('Your reports are now dashboards. Each chart became a saved report you can reuse.');
}

/* ---------- formatting ---------- */

function measureField(c, def) { const m = def.measure || { fn: 'count' }; return m.fn !== 'count' && m.ref ? fieldOf(c, m.ref) : null; }
function fmtMeasure(c, def, v) {
  if (v == null || (typeof v === 'number' && isNaN(v))) return '–';
  const f = measureField(c, def);
  if (!f) return Math.round(v).toLocaleString();
  if (f.type === 'rating') return (Math.round(v * 10) / 10).toLocaleString() + ' ★';
  const val = def.measure.fn === 'avg' ? Math.round(v * 100) / 100 : v;
  if (f.type === 'currency' || (f.type === 'formula' && f.format === 'currency')) {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(f.currency || 'USD').toUpperCase(), maximumFractionDigits: Math.abs(val) >= 100 ? 0 : 2 }).format(val); } catch (e) { return String(val); }
  }
  if (f.type === 'percent' || (f.type === 'formula' && f.format === 'percent')) return (Math.round(val * 10) / 10).toLocaleString() + '%';
  if (f.type === 'range') return (Math.round(val * 10) / 10) + (f.suffix || '');
  return Number(val).toLocaleString(undefined, { maximumFractionDigits: def.measure.fn === 'avg' ? 2 : 1 });
}
function fmtShort(c, def, v) {
  const f = measureField(c, def);
  const cur = f && (f.type === 'currency' || (f.type === 'formula' && f.format === 'currency')) ? '$' : '';
  const a = Math.abs(v);
  if (a >= 1e6) return cur + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return cur + (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return cur + (Math.round(v * 10) / 10).toLocaleString();
}
function measureLabel(c, def) {
  const m = def.measure || { fn: 'count' };
  const form = c.formById(def.form);
  if (m.fn === 'count' || !m.ref) return 'Number of ' + (form ? form.name.toLowerCase() : 'records');
  const f = fieldOf(c, m.ref);
  return (m.fn === 'avg' ? 'Average ' : 'Total ') + (f ? f.label.toLowerCase() : 'value');
}
function cellText(c, ref, rec) {
  const f = fieldOf(c, ref); if (!f) return '';
  const v = valueOf(c, rec, ref);
  if (f.type === 'relation') { const t = v && c.recById(v); return t ? c.recTitle(t) : ''; }
  return textOf(c, f, v);
}
const isNumRef = (c, r) => { const f = fieldOf(c, r); return !!f && kindOf(f) === 'num'; };

/* ---------- one report's body ---------- */

const COLORS = 8;
function captionOf(c, def, n, extra) {
  const form = c.formById(def.form);
  const parts = [n + ' ' + (n === 1 ? (form?.itemName || form?.name || 'record').toLowerCase().replace(/s$/, '') : (form?.name || 'records').toLowerCase())];
  const conds = (def.conditions || []).filter((x) => x.ref && fieldOf(c, x.ref) && x.value !== '');
  if (conds.length) parts.push(conds.map((x) => refLabel(c, x.ref, def.form) + (x.op === 'not' ? ' is not ' : ' is ') + x.value).join(def.join === 'or' ? ' or ' : ' and '));
  if (extra?.range && ['line', 'area'].includes(def.type)) parts.push('period doesn’t apply to charts over time');
  const blocked = (extra?.fields || []).filter((ff) => ff.values?.length && !filterReaches(c, def, ff.ref));
  if (blocked.length) parts.push(blocked.map((ff) => (fieldOf(c, ff.ref)?.label || 'filter')).join(', ') + ' filter doesn’t reach this report');
  return parts.join(' · ');
}

function bodyHTML(c, def, extra, key) {
  const form = c.formById(def.form);
  if (!form) return { html: `<p class="rp-empty">You don’t have access to the form this report uses.</p>`, caption: '' };
  const time = ['line', 'area'].includes(def.type);
  const ex = time ? { ...extra, range: null } : extra;
  if (def.type === 'kpi') {
    const k = kpiOf(c, def, ex, Date.now());
    let cmp = '';
    if (def.compare) {
      if (k.delta == null) cmp = `<div class="db-kd">Nothing in ${esc(k.prevLabel)} to compare with</div>`;
      else { const up = k.delta >= 0; cmp = `<div class="db-kd"><span aria-hidden="true">${up ? '▲' : '▼'}</span> ${up ? '+' : ''}${Math.round(k.delta)}% vs ${esc(k.prevLabel)} <span class="db-kp">(${esc(fmtMeasure(c, def, k.prev))})</span></div>`; }
    }
    return { html: `<div class="rp-kpi">${esc(fmtMeasure(c, def, k.value))}</div><div class="rp-kpisub">${esc(measureLabel(c, def))}${def.compare && !extra?.range ? ' · ' + esc(k.label) : ''}</div>${cmp}`, caption: captionOf(c, def, k.n, extra) };
  }
  const list = rowsFor(c, def, ex);
  const caption = captionOf(c, def, list.length, extra);
  if (!list.length) return { html: `<p class="rp-empty">No records match this report${extra?.range || (extra?.fields || []).some((x) => x.values?.length) ? ' with these filters' : ''}.</p>`, caption };
  if (def.type === 'bar') {
    const items = slicesOf(c, def, list);
    const max = Math.max(0, ...items.map((x) => x.value)) || 1;
    return { caption, html: `<div class="rp-bars" role="list">${items.map((x) => { const t = fmtMeasure(c, def, x.value); return `<div class="rp-bar" role="listitem" title="${esc(x.key + ': ' + t)}"><span class="rp-bl">${esc(x.key)}</span><span class="rp-bt"><span class="rp-bf" style="width:${Math.max(0.5, (x.value / max) * 100).toFixed(1)}%"></span></span><span class="rp-bv">${esc(t)}</span></div>`; }).join('')}</div>` };
  }
  if (def.type === 'donut') {
    const items = slicesOf(c, def, list).filter((x) => x.value > 0);
    const total = items.reduce((a, b) => a + b.value, 0) || 1;
    let acc = 0;
    const segs = items.map((x, i) => { const a = acc, b = acc + (x.value / total) * 100; acc = b; const gap = Math.min(0.6, (b - a) / 3); return `var(--dc${(i % COLORS) + 1}) ${a.toFixed(2)}% ${(b - gap).toFixed(2)}%, var(--surface) ${(b - gap).toFixed(2)}% ${b.toFixed(2)}%`; }).join(', ');
    return { caption, html: `<div class="db-donut"><div class="db-ring" style="background:conic-gradient(${segs})" role="img" aria-label="${esc(items.map((x) => x.key + ' ' + Math.round((x.value / total) * 100) + '%').join(', '))}"><div class="db-ringc">${esc(fmtShort(c, def, total))}<small>total</small></div></div>
      <div class="db-leg" role="list">${items.map((x, i) => `<div class="db-li" role="listitem"><span class="db-sw" style="background:var(--dc${(i % COLORS) + 1})"></span><span class="db-lk">${esc(x.key)}</span><span class="db-lv">${esc(fmtMeasure(c, def, x.value))}</span><span class="db-lp">${Math.round((x.value / total) * 100)}%</span></div>`).join('')}</div></div>` };
  }
  if (time) {
    if (!fieldOf(c, def.time)) return { caption, html: `<p class="rp-empty">Choose a date field in the report’s settings.</p>` };
    const weeks = (def.interval || 'month') === 'week';
    const b = bucketsOf(c, def, list, Date.now());
    const n = b.length;
    const step = niceStep(Math.max(0, ...b.map((x) => x.value)) / 4);
    const top = step * 4;
    const X = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);
    const Y = (v) => (v / top) * 100;
    const path = b.map((x, i) => (i ? 'L' : 'M') + X(i).toFixed(2) + ' ' + (100 - Y(x.value)).toFixed(2)).join(' ');
    const label = (x) => x.date.toLocaleDateString(undefined, weeks ? { month: 'short', day: 'numeric' } : { month: 'short' });
    const every = weeks ? 5 : 2;
    return { caption, html: `<div class="rp-ln"><div class="rp-plot">
      ${[0, 1, 2, 3, 4].map((k) => `<div class="rp-gl" style="bottom:${k * 25}%"><span>${esc(fmtShort(c, def, step * k))}</span></div>`).join('')}
      <svg class="rp-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${def.type === 'area' ? `<path class="rp-area" d="${path} L100 100 L0 100 Z"></path>` : ''}<path class="rp-path" d="${path}"></path></svg>
      ${b.map((x, i) => { const tip = (weeks ? 'Week of ' : '') + label(x) + ' · ' + fmtMeasure(c, def, x.value); return `<button type="button" class="rp-pt" style="left:${X(i).toFixed(2)}%;bottom:${Y(x.value).toFixed(2)}%" aria-label="${esc(tip)}"><i></i><span class="rp-tip">${esc(tip)}</span></button>`; }).join('')}
    </div><div class="rp-xax">${b.map((x, i) => ((n - 1 - i) % every === 0 ? `<span style="left:${X(i).toFixed(2)}%">${esc(label(x))}</span>` : '')).join('')}</div></div>` };
  }
  if (def.type === 'pivot') {
    const p = pivotOf(c, def, list);
    if (!p) return { caption, html: `<p class="rp-empty">Choose rows and columns in the report’s settings.</p>` };
    const tc = `minmax(140px,1.6fr) ${p.cols.map(() => 'minmax(84px,1fr)').join(' ')} minmax(96px,1fr)`;
    const rl = fieldOf(c, def.group)?.label || 'Rows', cl = fieldOf(c, def.col)?.label || 'Columns';
    return { caption, html: `<div class="rp-table db-pivot" role="table"><div class="rp-tr rp-th" role="row" style="grid-template-columns:${tc}"><div class="rp-td" role="columnheader">${esc(rl)} ↓ · ${esc(cl)} →</div>${p.cols.map((k) => `<div class="rp-td num" role="columnheader">${esc(k)}</div>`).join('')}<div class="rp-td num" role="columnheader">Total</div></div>
      ${p.rows.map((r) => `<div class="rp-tr" role="row" style="grid-template-columns:${tc}"><div class="rp-td" role="rowheader">${esc(r.key)}</div>${r.cells.map((v) => `<div class="rp-td num" role="cell">${v == null ? '–' : esc(fmtMeasure(c, def, v))}</div>`).join('')}<div class="rp-td num db-b" role="cell">${esc(fmtMeasure(c, def, r.total))}</div></div>`).join('')}
      <div class="rp-tr db-tot" role="row" style="grid-template-columns:${tc}"><div class="rp-td" role="rowheader">Total</div>${p.colTotals.map((v) => `<div class="rp-td num" role="cell">${esc(fmtMeasure(c, def, v))}</div>`).join('')}<div class="rp-td num" role="cell">${esc(fmtMeasure(c, def, p.grand))}</div></div></div>
      ${p.moreRows || p.moreCols ? `<p class="rp-more">Showing the first ${p.rows.length} rows and ${p.cols.length} columns.</p>` : ''}` };
  }
  // table and grouped table
  const cols = (def.columns || []).filter((r) => fieldOf(c, r));
  if (!cols.length) return { caption, html: `<p class="rp-empty">Add columns in the report’s settings.</p>` };
  const sort = D.sorts[key] || def.sort && cols[def.sort.i] && def.sort || { i: 0, dir: 1 };
  const sref = cols[sort.i] || cols[0];
  const tc = cols.map((_, i) => (i === 0 ? 'minmax(140px,1.6fr)' : 'minmax(100px,1fr)')).join(' ');
  const head = `<div class="rp-tr rp-th" role="row" style="grid-template-columns:${tc}">${cols.map((r, i) => `<div class="rp-td${isNumRef(c, r) ? ' num' : ''}" role="columnheader" aria-sort="${sort.i === i ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-d="tsort" data-k="${esc(key)}" data-v="${i}">${esc(refLabel(c, r, def.form))}${sort.i === i ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></div>`).join('')}</div>`;
  const row = (rec) => `<div class="rp-tr" role="row" style="grid-template-columns:${tc}" data-d="openrec" data-v="${esc(rec.id)}">${cols.map((r) => { const t = cellText(c, r, rec); return `<div class="rp-td${isNumRef(c, r) ? ' num' : ''}" role="cell" title="${esc(t)}">${esc(t || '–')}</div>`; }).join('')}</div>`;
  if (def.type === 'grouped') {
    const groups = groupRows(c, def, def.group, list);
    if (!groups.length) return { caption, html: `<p class="rp-empty">Choose what to group by in the report’s settings.</p>` };
    const gl = fieldOf(c, def.group)?.label || 'Group';
    return { caption, html: `<div class="rp-table" role="table">${head}${groups.map((g) => {
      const rs = sortRecs(c, g.rows, sref, sort.dir).slice(0, 10);
      return `<div class="rp-tr db-grp" role="row"><div class="rp-td" role="rowheader"><b>${esc(g.key)}</b> <span class="db-gn">${esc(gl)} · ${g.rows.length}</span></div><div class="rp-td num" role="cell">${esc(fmtMeasure(c, def, g.value))}</div></div>${rs.map(row).join('')}${g.rows.length > rs.length ? `<p class="rp-more db-gm">and ${g.rows.length - rs.length} more</p>` : ''}`;
    }).join('')}<div class="rp-tr db-grp db-tot" role="row"><div class="rp-td" role="rowheader">Total · ${list.length}</div><div class="rp-td num" role="cell">${esc(fmtMeasure(c, def, measureOf(c, def, list)))}</div></div></div>` };
  }
  const sorted = sortRecs(c, list, sref, sort.dir);
  const shown = sorted.slice(0, 50);
  return { caption, html: `<div class="rp-table" role="table">${head}${shown.map(row).join('')}</div>${sorted.length > shown.length ? `<p class="rp-more">Showing the first ${shown.length} of ${sorted.length}.</p>` : ''}` };
}

/* ---------- the Reports list ---------- */

export function viewReportsList() {
  maybeMigrate();
  const c = ctx();
  const list = reportsVisible();
  const own = list.filter((r) => r.ownerId === me()), shared = list.filter((r) => r.ownerId !== me());
  const typeName = (t) => (TYPES.find((x) => x[0] === t) || ['', 'Report'])[1];
  const card = (r) => {
    const f = c.formById(r.def?.form);
    const on = usedOn(dashesVisible(), r.id);
    return `<button class="card" data-d="openrep" data-v="${esc(r.id)}"><b>${esc(r.name)}</b><div class="meta"><span>${esc(typeName(r.def?.type))}${f ? ' · ' + esc(f.name) : ''}</span>${on.length ? `<span>On ${on.map((d) => esc(d.name)).join(', ')}</span>` : ''}${r.ownerId !== me() ? `<span>By ${esc(nameOf(r.ownerId))}</span>` : r.shared ? '<span>Shared</span>' : ''}</div></button>`;
  };
  return `
  <div class="head"><div class="ttl"><div><h1>Reports</h1><p class="sub">Each report is one chart, table, pivot or number. Put it on as many dashboards as you like; changing it changes it everywhere.</p></div></div>
    <div class="actions"><button class="btn" data-d="nav-dashes">Dashboards</button><button class="btn primary" data-d="newrep">+ New report</button></div></div>
  <section class="section"><div class="section-h"><h2>Your reports <span class="count">${own.length}</span></h2></div>
    <div class="panel">${own.length ? `<div class="cards" style="display:flex">${own.map(card).join('')}</div>` : `<p class="note">No reports yet. Press <b>New report</b> to make one.</p>`}</div></section>
  ${shared.length ? `<section class="section"><div class="section-h"><h2>Shared with you <span class="count">${shared.length}</span></h2></div><div class="panel"><div class="cards" style="display:flex">${shared.map(card).join('')}</div></div></section>` : ''}`;
}

/* ---------- the report editor ---------- */

export function reportName(id) { if (D.rid === id && D.draft) return D.draft.name || 'Report'; return reportById(id)?.name || 'Report'; }
export function reportDirty(id) { return !!(D.draft && D.draft.dirty && D.rid === id); }
export function dashDirty(id) { return !!(D.edit && D.edit.dirty && D.did === id); }
export function counts() { return { dashboards: dashesVisible().length, reports: reportsVisible().length }; }

function ensureDraft(id) {
  const src = reportById(id);
  if (D.rid !== id || !D.draft) {
    if (!src) return null;
    D.rid = id; D.confirm = null;
    D.draft = { id, name: src.name, ownerId: src.ownerId, shared: !!src.shared, groups: (src.groups || []).slice(), def: normalizeDef(ctx(), src.def), createdAt: src.createdAt, isNew: false, dirty: false, updatedAt: src.updatedAt };
  } else if (src && !D.draft.dirty && src.updatedAt !== D.draft.updatedAt) {
    D.draft = { ...D.draft, name: src.name, shared: !!src.shared, groups: (src.groups || []).slice(), def: normalizeDef(ctx(), src.def), updatedAt: src.updatedAt };
  }
  return D.draft;
}

function startNewReport(formId) {
  const c = ctx();
  const form = formId ? c.formById(formId) : c.forms[0];
  if (!form) { toast('There are no forms you can see yet.'); return; }
  const id = uid('rd');
  const def = newDef(c, form.id);
  D.rid = id; D.confirm = null;
  D.draft = { id, name: form.name + ' report', ownerId: me(), shared: false, groups: [], def, createdAt: Date.now(), isNew: true, dirty: true };
  H.go({ name: 'report', reportId: id });
  setTimeout(() => { const n = document.getElementById('db-name'); if (n) { n.focus(); n.select(); } }, 50);
}

export function viewReport(id) {
  const d = D.rid === id && D.draft && D.draft.isNew ? D.draft : ensureDraft(id);
  if (!d) return `<div class="panel empty"><h2>That report isn’t available</h2><p>It may have been deleted, or it isn’t shared with you.</p><button class="btn" data-d="nav-reports">All reports</button></div>`;
  const c = ctx();
  const ro = !(d.isNew || canChange(d));
  const def = d.def;
  const on = usedOn(dashesVisible(), d.id);
  const { html, caption } = bodyHTML(c, def, {}, 'r:' + d.id);
  const typeBtns = TYPES.map(([k, l]) => `<button type="button" class="db-ty${def.type === k ? ' on' : ''}" aria-pressed="${def.type === k}" data-d="type" data-v="${k}"${ro ? ' disabled' : ''}>${l}</button>`).join('');
  return `<div id="dbx" class="db-ed">
  <div class="db-head">
    <input id="db-name" class="db-name" value="${esc(d.name)}" aria-label="Report name" data-dv="name"${ro ? ' readonly' : ''}>
    <span class="db-used">${on.length ? 'On ' + on.map((x) => `<button type="button" class="db-link" data-d="opendash" data-v="${esc(x.id)}">${esc(x.name)}</button>`).join('') + (on.length > 1 ? ' · changes show on all of them' : '') : 'Not on a dashboard yet'}</span>
    <span class="grow"></span>
    ${ro ? `<span class="chip">View only · by ${esc(nameOf(d.ownerId))}</span><button class="btn" data-d="copyrep">Make a copy</button>` : `
      ${d.isNew ? '' : `<button class="btn danger${D.confirm === 'del' ? ' armed' : ''}" data-d="delrep">${D.confirm === 'del' ? 'Tap again to delete' : 'Delete'}</button>`}
      <button class="btn" data-d="addto"${d.isNew ? ' disabled title="Save it first"' : ''}>Add to dashboard</button>
      <button class="btn primary" data-d="saverep"${d.dirty ? '' : ' disabled'}>${d.dirty ? 'Save report' : 'Saved'}</button>`}
  </div>
  ${D.confirm === 'addto' ? addToHTML(d) : ''}
  <div class="db-types" role="group" aria-label="Report type">${typeBtns}</div>
  <div class="db-body">
    <section class="panel db-prev" aria-label="Preview"><div class="db-ph"><h2>${esc(d.name)}</h2><span class="rp-cap">${esc(caption)}</span></div><div class="db-pb db-t-${def.type}">${html}</div></section>
    <aside class="db-side"><fieldset class="fset"${ro ? ' disabled' : ''}>${settingsHTML(c, d)}</fieldset></aside>
  </div></div>`;
}

function addToHTML(d) {
  const ds = dashesVisible().filter((x) => canChange(x));
  return `<div class="panel db-addto"><b>Add “${esc(d.name)}” to</b><div class="db-chips">${ds.map((x) => { const has = (x.tiles || []).some((t) => t.report === d.id); return `<button type="button" class="db-chip" data-d="addtodash" data-v="${esc(x.id)}"${has ? ' disabled' : ''}>${esc(x.name)}${has ? ' ✓' : ''}</button>`; }).join('')}<button type="button" class="db-chip" data-d="addtonew">+ New dashboard</button></div></div>`;
}

function opt(v, label, cur) { return `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`; }

function settingsHTML(c, d) {
  const def = d.def;
  const fields = chainFields(c, def.form);
  const lab = (x) => (x.ref.form === def.form ? x.f.label : x.form.name + ' › ' + x.f.label);
  const sel = (dv, list, cur, extra = '') => `<select class="in" data-dv="${dv}"${extra}>${list}</select>`;
  const groupable = fields.filter((x) => (x.kind === 'group' || x.kind === 'key') && x.f.type !== 'color');
  const nums = fields.filter((x) => x.kind === 'num');
  const dates = fields.filter((x) => x.kind === 'date');
  const t = def.type;
  let h = `<div class="db-sec"><label class="db-lab" for="db-form">Data from</label>${sel('form', c.forms.map((f) => opt(f.id, f.name, def.form)).join(''), '', ' id="db-form"')}
    ${chainOf(c, def.form).length > 1 ? `<p class="help">Can also use fields of ${chainOf(c, def.form).slice(1).map((id) => esc(c.formById(id)?.name || '')).join(', ')}.</p>` : ''}</div>`;
  if (t !== 'table') {
    const m = def.measure || { fn: 'count' };
    const cur = m.fn === 'count' || !m.ref ? 'count' : m.fn + '|' + refKey(m.ref);
    h += `<div class="db-sec"><label class="db-lab">Value</label>${sel('measure', opt('count', 'Count of records', cur) + nums.map((x) => opt('sum|' + refKey(x.ref), 'Total ' + lab(x), cur) + opt('avg|' + refKey(x.ref), 'Average ' + lab(x), cur)).join(''), '')}</div>`;
  }
  if (['bar', 'donut', 'grouped', 'pivot'].includes(t)) {
    h += `<div class="db-sec"><label class="db-lab">${t === 'pivot' ? 'Rows' : t === 'donut' ? 'Slices' : 'Group by'}</label>${sel('group', groupable.map((x) => opt(refKey(x.ref), lab(x), refKey(def.group))).join(''), '')}</div>`;
  }
  if (t === 'pivot') h += `<div class="db-sec"><label class="db-lab">Columns</label>${sel('col', groupable.filter((x) => refKey(x.ref) !== refKey(def.group)).map((x) => opt(refKey(x.ref), lab(x), refKey(def.col))).join(''), '')}</div>`;
  if (t === 'line' || t === 'area') {
    h += `<div class="db-sec"><label class="db-lab">Over time, by</label>${sel('time', dates.map((x) => opt(refKey(x.ref), lab(x), refKey(def.time))).join(''), '')}
      <div class="db-seg" role="group" aria-label="Interval">${[['week', 'Weeks'], ['month', 'Months']].map(([k, l]) => `<button type="button" class="${(def.interval || 'month') === k ? 'on' : ''}" aria-pressed="${(def.interval || 'month') === k}" data-d="interval" data-v="${k}">${l}</button>`).join('')}</div></div>`;
  }
  if (t === 'table' || t === 'grouped') {
    const cols = def.columns || [];
    const left = fields.filter((x) => x.kind !== 'none' && !cols.some((r) => refKey(r) === refKey(x.ref)));
    h += `<div class="db-sec"><span class="db-lab">Columns</span>${cols.map((r, i) => `<div class="db-colrow"><span>${esc(refLabel(c, r, def.form))}</span>
      <button type="button" class="ibtn" data-d="colmove" data-v="${i}" data-dir="-1" aria-label="Move left"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="ibtn" data-d="colmove" data-v="${i}" data-dir="1" aria-label="Move right"${i === cols.length - 1 ? ' disabled' : ''}>↓</button><button type="button" class="ibtn" data-d="coldel" data-v="${i}" aria-label="Remove ${esc(refLabel(c, r, def.form))}">✕</button></div>`).join('')}
      ${left.length && cols.length < 12 ? sel('addcol', opt('', '+ Add a column', '') + left.map((x) => opt(refKey(x.ref), lab(x), '')).join(''), '', ' aria-label="Add a column"') : ''}</div>`;
  }
  if (t === 'kpi') h += `<div class="db-sec"><label class="switch"><input type="checkbox" data-dv="compare"${def.compare ? ' checked' : ''}><span class="tr"></span><span>Compare with the period before</span></label><p class="help">On a dashboard it compares with the period before the one picked there; here, this month with last month.</p></div>`;
  if (!['line', 'area'].includes(t)) {
    h += `<div class="db-sec"><label class="db-lab">Date for periods</label>${sel('dateRef', dates.map((x) => opt(refKey(x.ref), lab(x), refKey(dateRefOf(c, def)))).join(''), '')}<p class="help">Which date a dashboard’s period (This month, This year…) looks at.</p></div>`;
  }
  // conditions
  const conds = def.conditions || [];
  const condFields = fields.filter((x) => x.kind === 'group' || x.kind === 'key');
  h += `<div class="db-sec"><span class="db-lab">Only records where</span>${conds.map((cd, i) => {
    const f = fieldOf(c, cd.ref);
    const vals = f ? valuesFor(c, cd.ref) : [];
    return `${i ? `<div class="db-join">${sel('join', opt('and', 'and', def.join) + opt('or', 'or', def.join), '', ` data-i="${i}" aria-label="And or or"`)}</div>` : ''}<div class="db-cond">
      ${sel('cfield', condFields.map((x) => opt(refKey(x.ref), lab(x), refKey(cd.ref))).join(''), '', ` data-i="${i}" aria-label="Field"`)}
      ${sel('cop', opt('is', 'is', cd.op) + opt('not', 'is not', cd.op), '', ` data-i="${i}" aria-label="Condition"`)}
      ${vals.length ? sel('cval', opt('', 'Choose…', String(cd.value ?? '')) + vals.map((v) => opt(v, v, String(cd.value ?? ''))).join(''), '', ` data-i="${i}" aria-label="Value"`) : `<input class="in" data-dv="cval" data-i="${i}" value="${esc(cd.value ?? '')}" aria-label="Value">`}
      <button type="button" class="ibtn" data-d="cdel" data-v="${i}" aria-label="Remove condition">✕</button></div>`;
  }).join('')}<button type="button" class="btn sm" data-d="cadd">+ Add condition</button></div>`;
  if (admin()) h += sharingHTML(d, 'rep');
  return h;
}

function sharingHTML(item, kind) {
  const gs = item.groups || [];
  return `<div class="db-sec"><label class="switch"><input type="checkbox" data-dv="${kind}-shared"${item.shared ? ' checked' : ''}><span class="tr"></span><span>Share</span></label>
    ${item.shared ? `<p class="help">Shows in the lists of ${gs.length ? 'these groups' : 'everyone'}. Each person sees numbers from the records they’re allowed to see.</p><div class="db-chips">${store.groups.map((g) => `<label class="db-chip"><input type="checkbox" data-dv="${kind}-group" value="${esc(g.id)}"${gs.includes(g.id) ? ' checked' : ''}>${esc(g.name)}</label>`).join('')}</div>${store.groups.length ? '<p class="help">No groups ticked means everyone.</p>' : ''}` : ''}</div>`;
}

/** Values to offer for a field: its options, else what the records hold (at most 200). */
function valuesFor(c, ref) {
  const f = fieldOf(c, ref);
  if (!f) return [];
  if (f.type === 'checkbox') return ['Yes', 'No'];
  if (f.options && f.options.length) return f.options.slice();
  const set = new Set();
  c.records.filter((r) => r.formId === ref.form).forEach((r) => keysOf(c, f, valueOf(c, r, ref)).forEach((k) => { if (k !== '(blank)') set.add(k); }));
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 200);
}

function changeDef(fn) { const d = D.draft; if (!d) return; fn(d.def); d.def = normalizeDef(ctx(), d.def); d.dirty = true; repaint(); }

async function saveDraft() {
  const d = D.draft; if (!d) return;
  const name = (d.name || '').trim() || 'Untitled report';
  const data = { name: name.slice(0, 120), ownerId: d.ownerId, shared: admin() ? !!d.shared : false, groups: admin() && d.shared ? d.groups : [], def: clone(d.def), createdAt: d.createdAt || Date.now(), updatedAt: Date.now() };
  try { await saveReportDef(d.id, data); }
  catch (e) { console.error(e); toast(e?.code === 'permission-denied' ? 'You can’t change this report.' : 'Saving failed. Check your connection and try again.'); return; }
  const wasNew = d.isNew;
  Object.assign(d, { name, isNew: false, dirty: false, updatedAt: data.updatedAt });
  toast('Report saved');
  if (wasNew && D.returnTo) { const did = D.returnTo; D.returnTo = null; await addTile(did, d.id); H.go({ name: 'dashboard', dashboardId: did }); return; }
  repaint();
}

async function addTile(did, reportId, text) {
  const editing = D.edit && D.did === did;
  const x = editing ? D.edit : dashById(did); if (!x) return;
  const tiles = (x.tiles || []).slice();
  const r = reportById(reportId) || (D.draft && D.draft.id === reportId ? D.draft : null);
  const t = r?.def?.type;
  tiles.push(text ? { id: uid('t'), text: { title: 'Notes', body: '' }, cols: 4, rows: 1 } : { id: uid('t'), report: reportId, cols: t === 'kpi' ? 3 : ['table', 'grouped', 'pivot'].includes(t) ? 12 : 6, rows: t === 'kpi' ? 1 : ['table', 'grouped', 'pivot'].includes(t) ? 3 : 2 });
  if (editing) { D.edit.tiles = tiles; D.edit.dirty = true; repaint(); return; }
  try { await saveDashboard(did, { ...dashData(x), tiles, updatedAt: Date.now() }); toast('Added to ' + x.name); }
  catch (e) { toast('Couldn’t change that dashboard.'); }
}

function dashData(x) {
  return { name: x.name, ownerId: x.ownerId, shared: !!x.shared, groups: x.groups || [], tiles: clone(x.tiles || []), filters: clone(x.filters || { period: 'all', fields: [] }), createdAt: x.createdAt || Date.now(), updatedAt: x.updatedAt || Date.now() };
}

/* ---------- the Dashboards list ---------- */

export function viewDashboards() {
  maybeMigrate();
  const list = dashesVisible();
  const home = homeId();
  const card = (x) => `<div class="db-dcard${x.id === home ? ' home' : ''}"><button class="card" data-d="opendash" data-v="${esc(x.id)}"><b>${esc(x.name)}</b><div class="meta"><span>${(x.tiles || []).length} item${(x.tiles || []).length === 1 ? '' : 's'}</span>${x.ownerId !== me() ? `<span>By ${esc(nameOf(x.ownerId))}</span>` : x.shared ? `<span>Shared${(x.groups || []).length ? ' with ' + (x.groups || []).map((g) => esc(store.groups.find((y) => y.id === g)?.name || 'a group')).join(', ') : ''}</span>` : ''}</div></button>
    ${x.id === home ? `<button class="db-home on" data-d="sethome" data-v="" aria-pressed="true" title="Opens when you start Formwright">Home</button>` : `<button class="db-home" data-d="sethome" data-v="${esc(x.id)}" aria-pressed="false">Set as home</button>`}</div>`;
  return `
  <div class="head"><div class="ttl"><div><h1>Dashboards</h1><p class="sub">Saved reports and notes on one page, with a period and filters across the top. Your home dashboard opens when you start Formwright.</p></div></div>
    <div class="actions"><button class="btn" data-d="nav-reports">Reports</button><button class="btn primary" data-d="newdash">+ New dashboard</button></div></div>
  <div class="panel">${list.length ? `<div class="db-dlist">${list.map(card).join('')}</div>` : `<p class="note">No dashboards yet. Press <b>New dashboard</b>, then add reports to it.</p>`}</div>`;
}

/* ---------- one dashboard ---------- */

export function dashName(id) { return (D.edit && D.did === id ? D.edit.name : dashById(id)?.name) || 'Dashboard'; }

function filterState(x) {
  const fv = D.fv[x.id] || (D.fv[x.id] = { period: x.filters?.period || 'all', fields: {} });
  return fv;
}
function extraFor(x, fv) {
  const range = periodRange(fv.period, Date.now());
  return {
    periodKey: fv.period,
    range: range ? { from: range.from, to: range.to } : null,
    fields: (x.filters?.fields || []).map((ref) => ({ ref, values: fv.fields[refKey(ref)] ? [fv.fields[refKey(ref)]] : [] })),
  };
}

export function viewDashboard(id) {
  maybeMigrate();
  const src = dashById(id);
  if (D.did !== id) { D.did = id; D.edit = null; D.picker = false; }
  const x = D.edit && D.did === id ? D.edit : src;
  if (!x || !visibleTo(src || x, store.me, me())) {
    if (!store.dashReady) return `<div class="loading">Loading…</div>`;
    return `<div class="panel empty"><h2>That dashboard isn’t available</h2><p>It may have been deleted, or it isn’t shared with you.</p><button class="btn" data-d="nav-dashes">All dashboards</button></div>`;
  }
  const c = ctx();
  const edit = !!D.edit;
  const may = canChange(src);
  const fv = filterState(x);
  const extra = extraFor(x, fv);
  const pos = layout(x.tiles || []);
  const home = homeId() === x.id;
  const tiles = (x.tiles || []).map((t) => tileHTML(c, x, t, pos[t.id], extra, edit)).join('');
  const fieldFilters = (x.filters?.fields || []).map((ref) => {
    const f = fieldOf(c, ref);
    if (!f) return '';
    const k = refKey(ref);
    return `<label class="db-ff"><span>${esc(refLabel(c, ref, ''))}</span><select class="in" data-df="${esc(k)}"><option value="">All</option>${valuesFor(c, ref).map((v) => opt(v, v, fv.fields[k] || '')).join('')}</select>${edit ? `<button type="button" class="ibtn" data-d="ffdel" data-v="${esc(k)}" aria-label="Remove this filter">✕</button>` : ''}</label>`;
  }).join('');
  let addFilter = '';
  if (edit) {
    const forms = new Set();
    (x.tiles || []).forEach((t) => { const r = reportById(t.report); if (r) chainOf(c, r.def.form).forEach((fid) => forms.add(fid)); });
    const cands = [];
    forms.forEach((fid) => { const form = c.formById(fid); if (form) chainFields(c, fid).filter((y) => y.ref.form === fid && (y.kind === 'group' || y.kind === 'key') && y.f.type !== 'color').forEach((y) => cands.push(y)); });
    const have = new Set((x.filters?.fields || []).map(refKey));
    const left = cands.filter((y) => !have.has(refKey(y.ref)));
    if (left.length) addFilter = `<select class="in db-addf" data-dv="addfilter" aria-label="Add a filter"><option value="">+ Filter by…</option>${left.map((y) => opt(refKey(y.ref), y.form.name + ' › ' + y.f.label, '')).join('')}</select>`;
  }
  return `<div id="dbx" class="db-dash rp${edit ? ' can-edit' : ''}">
  <div class="db-head">
    ${edit ? `<input id="db-name" class="db-name" value="${esc(x.name)}" aria-label="Dashboard name" data-dv="dname">` : `<h1 class="db-title">${esc(x.name)}</h1>`}
    <button type="button" class="db-home${home ? ' on' : ''}" data-d="sethome" data-v="${home ? '' : esc(x.id)}" aria-pressed="${home}">${home ? 'Home' : 'Set as home'}</button>
    ${x.shared ? `<span class="chip">Shared${(x.groups || []).length ? ' with ' + (x.groups || []).map((g) => esc(store.groups.find((y) => y.id === g)?.name || 'a group')).join(', ') : ''}</span>` : ''}
    <span class="grow"></span>
    ${edit ? `${D.confirm === 'deldash' ? `<button class="btn danger armed" data-d="deldash">Tap again to delete</button>` : `<button class="btn danger" data-d="deldash">Delete</button>`}
      <button class="btn" data-d="addtext">+ Text block</button><button class="btn${D.picker ? ' on' : ''}" data-d="picker">+ Add report</button>
      <button class="btn ghost" data-d="canceledit">Cancel</button><button class="btn primary" data-d="savedash">Save dashboard</button>`
      : may ? `<button class="btn" data-d="editdash">Edit dashboard</button>` : `<span class="chip">View only</span>`}
  </div>
  ${edit && admin() ? `<div class="panel db-sharebar">${sharingHTML(x, 'dash')}</div>` : ''}
  ${edit && D.picker ? pickerHTML(x) : ''}
  <div class="db-filters" role="group" aria-label="Dashboard filters">
    <span class="db-lab">Period</span><div class="db-seg">${PERIODS.map(([k, l]) => `<button type="button" class="${fv.period === k ? 'on' : ''}" aria-pressed="${fv.period === k}" data-d="period" data-v="${k}">${l}</button>`).join('')}</div>
    ${fieldFilters}${addFilter}
    ${edit ? `<span class="help">The period you pick here is saved as the dashboard’s starting period.</span>` : ''}
  </div>
  ${(x.tiles || []).length ? `<div class="rp-grid db-grid">${tiles}</div>` : `<div class="panel empty"><h2>Nothing here yet</h2><p>${may ? 'Add saved reports or a text block.' : 'The owner hasn’t added anything yet.'}</p>${may && !edit ? '<button class="btn primary" data-d="editdash">Add reports</button>' : ''}</div>`}
  </div>`;
}

function pickerHTML(x) {
  const c = ctx();
  const have = new Set((x.tiles || []).map((t) => t.report).filter(Boolean));
  const list = reportsVisible();
  return `<div class="panel db-picker"><div class="db-ph"><b>Add a saved report</b><span class="grow"></span><button class="btn sm" data-d="newrepfor">+ New report</button></div>
    ${list.length ? `<div class="db-plist">${list.map((r) => `<button type="button" class="db-pick" data-d="pick" data-v="${esc(r.id)}"${have.has(r.id) ? ' disabled' : ''}><b>${esc(r.name)}</b><small>${esc((TYPES.find((t) => t[0] === r.def?.type) || ['', ''])[1])}${c.formById(r.def?.form) ? ' · ' + esc(c.formById(r.def.form).name) : ''}${have.has(r.id) ? ' · already here' : ''}</small></button>`).join('')}</div>` : '<p class="note">No saved reports yet. Make one with <b>New report</b>.</p>'}</div>`;
}

function tileHTML(c, x, t, pos, extra, edit) {
  if (!pos) return '';
  const style = `grid-column:${pos.c0 + 1} / span ${pos.c};grid-row:${pos.r0 + 1} / span ${pos.h}`;
  const ctl = edit ? `<div class="db-tctl">
    <select class="in" data-dz="w" data-v="${esc(t.id)}" aria-label="Width">${WIDTHS.map((w) => opt(String(w), widthName(w), String(pos.c))).join('')}</select>
    <select class="in" data-dz="h" data-v="${esc(t.id)}" aria-label="Height">${Array.from({ length: MAX_ROWS }, (_, i) => opt(String(i + 1), heightName(i + 1), String(pos.h))).join('')}</select>
    <button type="button" class="ibtn" data-d="tmove" data-v="${esc(t.id)}" data-dir="-1" aria-label="Move earlier">←</button><button type="button" class="ibtn" data-d="tmove" data-v="${esc(t.id)}" data-dir="1" aria-label="Move later">→</button>
    <button type="button" class="ibtn" data-d="tdel" data-v="${esc(t.id)}" aria-label="Remove from this dashboard">✕</button></div>` : '';
  if (t.text) {
    const body = edit ? `<input class="in db-tt" data-dt="title" data-v="${esc(t.id)}" value="${esc(t.text.title || '')}" aria-label="Heading"><textarea class="in db-tb" data-dt="body" data-v="${esc(t.id)}" aria-label="Text" rows="3">${esc(t.text.body || '')}</textarea>`
      : `<h3>${esc(t.text.title || '')}</h3>${String(t.text.body || '').split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}`;
    return `<article class="rp-w h${pos.h} db-text" style="${style}" aria-label="${esc(t.text.title || 'Text')}">${ctl}<div class="rp-wb">${body}</div></article>`;
  }
  const r = reportById(t.report);
  if (!r) return `<article class="rp-w h${pos.h}" style="${style}">${ctl}<p class="rp-empty">This report was deleted or isn’t shared with you.</p></article>`;
  const def = normalizeDef(c, r.def);
  const { html, caption } = bodyHTML(c, def, extra, 't:' + x.id + ':' + t.id);
  const others = usedOn(dashesVisible(), r.id).filter((d) => d.id !== x.id);
  return `<article class="rp-w h${pos.h} db-t-${def.type}" style="${style}" aria-label="${esc(r.name)}">
    ${ctl}<div class="rp-wh"><div class="rp-wt"><h3>${esc(r.name)}</h3><div class="rp-cap">${esc(caption)}${others.length ? ' · also on ' + others.map((d) => esc(d.name)).join(', ') : ''}</div></div>${edit ? '' : `<button type="button" class="db-link" data-d="openrep" data-v="${esc(r.id)}">Open</button>`}</div>
    <div class="rp-wb">${html}</div></article>`;
}

/** After a tile's width changes, shrink or grow the others in its row so the row still fits. */
function fitRow(tiles, id) {
  const before = layout(tiles.map((t) => (t.id === id ? { ...t, cols: 3 } : t)), id);
  const me_ = tiles.find((t) => t.id === id); if (!me_ || !before[id]) return tiles;
  const mates = tiles.filter((t) => t.id !== id && before[t.id] && before[t.id].row === before[id].row);
  const room = 12 - me_.cols;
  if (!mates.length || room < 3 * mates.length) return tiles;
  const total = mates.reduce((a, t) => a + before[t.id].c, 0) || 1;
  let left = room;
  const sizes = mates.map((t, i) => { const c = i === mates.length - 1 ? left : Math.max(3, Math.round((before[t.id].c / total) * room)); left -= c; return [t.id, c]; });
  if (sizes.some(([, c]) => c < 3)) return tiles;
  const m = new Map(sizes);
  return tiles.map((t) => (m.has(t.id) ? { ...t, cols: m.get(t.id) } : t));
}

function editTiles(fn) { if (!D.edit) return; const tiles = clone(D.edit.tiles || []); fn(tiles); D.edit.tiles = tiles; D.edit.dirty = true; repaint(); }

async function saveEdit() {
  const x = D.edit; if (!x) return;
  const fv = filterState(x);
  const data = { ...dashData(x), name: (x.name || '').trim().slice(0, 120) || 'Dashboard', shared: admin() ? !!x.shared : false, groups: admin() && x.shared ? x.groups || [] : [], filters: { period: fv.period, fields: clone(x.filters?.fields || []) }, updatedAt: Date.now() };
  try { await saveDashboard(x.id, data); } catch (e) { console.error(e); toast(e?.code === 'permission-denied' ? 'You can’t change this dashboard.' : 'Saving failed. Check your connection and try again.'); return; }
  D.edit = null; D.picker = false; D.confirm = null; toast('Dashboard saved'); repaint();
}

async function newDashboard() {
  const id = uid('db');
  const data = { name: 'New dashboard', ownerId: me(), shared: false, groups: [], tiles: [], filters: { period: 'all', fields: [] }, createdAt: Date.now(), updatedAt: Date.now() };
  try { await saveDashboard(id, data); } catch (e) { toast('Couldn’t create the dashboard. Try again.'); return null; }
  D.did = id; D.edit = { id, ...clone(data), dirty: false }; D.picker = true;
  H.go({ name: 'dashboard', dashboardId: id });
  setTimeout(() => { const n = document.getElementById('db-name'); if (n) { n.focus(); n.select(); } }, 50);
  return id;
}

/** True while typing in a report or dashboard field, so live data doesn't redraw under the cursor. */
export function reportBusy() {
  const a = document.activeElement;
  return !!(a && a.closest && a.closest('#dbx') && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox');
}
export function leaveReport() { /* reports save explicitly; app.js guards unsaved changes */ }
export function forgetDrafts() { D.draft = null; D.rid = null; D.edit = null; D.did = null; D.picker = false; D.confirm = null; }

/* ---------- events ---------- */

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-d]');
  if (!el) return;
  const a = el.dataset.d, v = el.dataset.v;
  if (a !== 'delrep' && a !== 'deldash' && D.confirm && D.confirm !== 'addto') D.confirm = null;
  const d = D.draft;
  switch (a) {
    case 'nav-reports': H.go({ name: 'reports' }); break;
    case 'nav-dashes': H.go({ name: 'dashboards' }); break;
    case 'openrep': H.go({ name: 'report', reportId: v }); break;
    case 'opendash': H.go({ name: 'dashboard', dashboardId: v }); break;
    case 'openrec': if (!e.target.closest('button')) H.openRecord?.(v); break;
    case 'newrep': startNewReport(); break;
    case 'tsort': { e.stopPropagation(); const k = el.dataset.k, i = +v; const s = D.sorts[k] || { i: 0, dir: 1 }; D.sorts[k] = { i, dir: s.i === i ? -s.dir : 1 }; repaint(); break; }
    case 'type': changeDef((def) => { def.type = v; }); break;
    case 'interval': changeDef((def) => { def.interval = v; }); break;
    case 'colmove': changeDef((def) => { const i = +v, j = i + +el.dataset.dir; if (j < 0 || j >= def.columns.length) return; [def.columns[i], def.columns[j]] = [def.columns[j], def.columns[i]]; }); break;
    case 'coldel': changeDef((def) => { def.columns.splice(+v, 1); if (!def.columns.length) toast('A table needs at least one column, so the starting ones are back.'); }); break;
    case 'cadd': {
      const c = ctx(); const f = chainFields(c, d.def.form).find((x) => x.kind === 'group' && x.f.options?.length) || chainFields(c, d.def.form).find((x) => x.kind === 'group' || x.kind === 'key');
      if (!f) { toast('This form has nothing to filter on yet.'); return; }
      changeDef((def) => { def.conditions = (def.conditions || []).concat({ ref: f.ref, op: 'is', value: '' }); }); break;
    }
    case 'cdel': changeDef((def) => { def.conditions.splice(+v, 1); }); break;
    case 'saverep': saveDraft(); break;
    case 'delrep': {
      if (D.confirm !== 'del') { D.confirm = 'del'; repaint(); return; }
      D.confirm = null;
      try {
        for (const x of store.dashboards.filter((y) => y.ownerId === me() && (y.tiles || []).some((t) => t.report === d.id))) await saveDashboard(x.id, { ...dashData(x), tiles: x.tiles.filter((t) => t.report !== d.id), updatedAt: Date.now() });
        await deleteReportDef(d.id); D.draft = null; D.rid = null; toast('Report deleted'); H.go({ name: 'reports' });
      } catch (err) { toast('Couldn’t delete the report. Try again.'); }
      break;
    }
    case 'copyrep': {
      if (!d) return; const id = uid('rd');
      D.rid = id; D.draft = { ...clone(d), id, name: d.name + ' (copy)', ownerId: me(), shared: false, groups: [], isNew: true, dirty: true, createdAt: Date.now() };
      H.go({ name: 'report', reportId: id }); break;
    }
    case 'addto': D.confirm = D.confirm === 'addto' ? null : 'addto'; repaint(); break;
    case 'addtodash': await addTile(v, d.id); D.confirm = null; repaint(); break;
    case 'addtonew': { D.confirm = null; const rid = d.id; const id = await newDashboard(); if (id) { D.edit.tiles = []; await addTile(id, rid); } break; }
    case 'sethome': try { await setHomeDashboard(v); toast(v ? 'This dashboard now opens when you start Formwright' : 'Home dashboard cleared'); } catch (err) { toast('Couldn’t save that. Try again.'); } break;
    case 'newdash': newDashboard(); break;
    case 'editdash': { const x = dashById(D.did); if (!x) return; D.edit = { id: x.id, ...dashData(x), dirty: false }; D.picker = !(x.tiles || []).length; repaint(); break; }
    case 'canceledit': D.edit = null; D.picker = false; D.fv[D.did] = null; repaint(); break;
    case 'savedash': saveEdit(); break;
    case 'deldash': {
      if (D.confirm !== 'deldash') { D.confirm = 'deldash'; repaint(); return; }
      D.confirm = null; const id = D.did;
      try { await deleteDashboard(id); if (homeId() === id) await setHomeDashboard(''); D.edit = null; toast('Dashboard deleted. Its reports are kept.'); H.go({ name: 'dashboards' }); } catch (err) { toast('Couldn’t delete the dashboard.'); }
      break;
    }
    case 'picker': D.picker = !D.picker; repaint(); break;
    case 'pick': await addTile(D.did, v); break;
    case 'addtext': await addTile(D.did, null, true); break;
    case 'newrepfor': D.returnTo = D.did; if (D.edit?.dirty) await saveEdit(); D.edit = null; startNewReport(); break;
    case 'tmove': editTiles((tiles) => { const i = tiles.findIndex((t) => t.id === v), j = i + +el.dataset.dir; if (i < 0 || j < 0 || j >= tiles.length) return; [tiles[i], tiles[j]] = [tiles[j], tiles[i]]; }); break;
    case 'tdel': editTiles((tiles) => { const i = tiles.findIndex((t) => t.id === v); if (i >= 0) tiles.splice(i, 1); }); break;
    case 'ffdel': { if (!D.edit) return; D.edit.filters = { ...(D.edit.filters || {}), fields: (D.edit.filters?.fields || []).filter((r) => refKey(r) !== v) }; D.edit.dirty = true; const fv = D.fv[D.did]; if (fv) delete fv.fields[v]; repaint(); break; }
    case 'period': { const x = D.edit && D.did ? D.edit : dashById(D.did); if (!x) return; filterState(x).period = v; if (D.edit) D.edit.dirty = true; repaint(); break; }
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.closest || !t.closest('#dbx')) return;
  const d = D.draft;
  if (t.dataset.df != null) { const x = D.edit || dashById(D.did); if (!x) return; filterState(x).fields[t.dataset.df] = t.value; repaint(); return; }
  if (t.dataset.dz) {
    if (!D.edit) return;
    const tiles = D.edit.tiles || [], id = t.dataset.v, pos = layout(tiles)[id]; if (!pos) return;
    const cols = t.dataset.dz === 'w' ? +t.value : pos.c, rows = t.dataset.dz === 'h' ? +t.value : pos.h;
    D.edit.tiles = settle(fitRow(resize(tiles, id, cols, rows), id), id); D.edit.dirty = true;
    repaint(() => document.querySelector(`[data-dz="${t.dataset.dz}"][data-v="${CSS.escape(id)}"]`)?.focus());
    return;
  }
  if (t.dataset.dt) { editTiles((tiles) => { const tile = tiles.find((y) => y.id === t.dataset.v); if (tile && tile.text) tile.text[t.dataset.dt] = t.value.slice(0, t.dataset.dt === 'title' ? 120 : 2000); }); return; }
  const k = t.dataset.dv; if (!k) return;
  switch (k) {
    case 'name': if (d) { d.name = t.value.slice(0, 120); d.dirty = true; repaint(); } break;
    case 'dname': if (D.edit) { D.edit.name = t.value.slice(0, 120); D.edit.dirty = true; } break;
    case 'form': changeDef((def) => { const keep = def.type; const n = newDef(ctx(), t.value); Object.keys(def).forEach((x) => delete def[x]); Object.assign(def, n, { type: keep }); }); break;
    case 'measure': changeDef((def) => { if (t.value === 'count') def.measure = { fn: 'count' }; else { const [fn, ...rest] = t.value.split('|'); def.measure = { fn, ref: refOf(rest.join('|')) }; } }); break;
    case 'group': changeDef((def) => { def.group = refOf(t.value); }); break;
    case 'col': changeDef((def) => { def.col = refOf(t.value); }); break;
    case 'time': changeDef((def) => { def.time = refOf(t.value); }); break;
    case 'dateRef': changeDef((def) => { def.dateRef = refOf(t.value); }); break;
    case 'addcol': if (t.value) changeDef((def) => { def.columns = (def.columns || []).concat(refOf(t.value)); }); break;
    case 'compare': changeDef((def) => { def.compare = t.checked; }); break;
    case 'join': changeDef((def) => { def.join = t.value === 'or' ? 'or' : 'and'; }); break;
    case 'cfield': changeDef((def) => { const c = def.conditions[+t.dataset.i]; if (c) { c.ref = refOf(t.value); c.value = ''; } }); break;
    case 'cop': changeDef((def) => { const c = def.conditions[+t.dataset.i]; if (c) c.op = t.value === 'not' ? 'not' : 'is'; }); break;
    case 'cval': changeDef((def) => { const c = def.conditions[+t.dataset.i]; if (c) c.value = t.value; }); break;
    case 'rep-shared': if (d) { d.shared = t.checked; d.dirty = true; repaint(); } break;
    case 'rep-group': if (d) { d.groups = t.checked ? [...new Set([...(d.groups || []), t.value])] : (d.groups || []).filter((g) => g !== t.value); d.dirty = true; repaint(); } break;
    case 'dash-shared': if (D.edit) { D.edit.shared = t.checked; D.edit.dirty = true; repaint(); } break;
    case 'dash-group': if (D.edit) { D.edit.groups = t.checked ? [...new Set([...(D.edit.groups || []), t.value])] : (D.edit.groups || []).filter((g) => g !== t.value); D.edit.dirty = true; repaint(); } break;
    case 'addfilter': if (D.edit && t.value) { D.edit.filters = { ...(D.edit.filters || { period: 'all' }), fields: (D.edit.filters?.fields || []).concat(refOf(t.value)) }; D.edit.dirty = true; repaint(); } break;
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'db-name' && t.dataset.dv === 'name' && D.draft) { D.draft.name = t.value.slice(0, 120); if (!D.draft.dirty) { D.draft.dirty = true; const b = document.querySelector('[data-d="saverep"]'); if (b) { b.disabled = false; b.textContent = 'Save report'; } } }
});
