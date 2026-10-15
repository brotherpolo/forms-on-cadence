// Reports and dashboards.
//   Reports (#/reports, #/report/<id>): one saved chart, table, pivot or KPI each.
//   Dashboards (#/dashboards, #/dashboard/<id>): saved reports and text blocks laid out on a
//   gap-free grid, with a period and field filters across the top. A report placed on
//   several dashboards is one report: editing it changes it everywhere.
// Every number is worked out here, in the viewer's browser, from the records the viewer is
// allowed to see (store.records already holds only those).
import './reports.css';
import './dash.css';
import { store, saveReportDef, deleteReportDef, saveDashboard, deleteDashboard, setHomeDashboard, setDefaultHome, writeMigration } from './store.js';
import { linkInfo, linkChoices, linkFromKey, linkKey, visibleTiles, homeDashboardId, LINK_SIZE } from './homelogic.js';
import { canViewForm, canCreate, isAdmin } from './access.js';
import { esc, uid, clone, toast, badge, colorOf } from './ui.js';
import { REPORT_COLS, REPORT_DEFAULT, DASH_COLS, DASH_DEFAULT, readCols, saveCols, toggleCol, moveCol, searchRows, sortRows, nextSort } from './catalog.js';
import {
  fieldOf, valueOf, textOf, kindOf, chainOf, measureOf, bucketsOf, niceStep, refLabel, autoTitle, titleFieldOf, parentsOf,
} from './reportlogic.js';
import {
  TYPES, PERIODS, chainFields, rowsFor, periodRange, kpiOf, slicesOf, groupRows, pivotOf, sortRecs, normalizeDef,
  newDef, migrateLegacy, visibleTo, usedOn, filterReaches, dateRefOf, keysOf, groupable as canSplit, groupLabel, BYS,
  drillRows, drillLabel, bucketOf, nounOf, shareOf,
  canvasTiles, gridTiles, resolveCanvas, placeTile, canvasHeight, tileSize, readingOrder, CANVAS_COLS, GRID, MIN_W, minH,
} from './dashlogic.js';

let H = { fmt: null, valOf: null, recTitle: null, go: null, openRecord: null, renderMain: null, openLink: null, linkEnv: () => ({}), starterForms: () => [] };
export function initReports(helpers) { H = { ...H, ...helpers }; }

const D = {
  rid: null, draft: null, confirm: null, // report editor
  did: null, edit: null, picker: false,   // dashboard (edit = working copy while editing)
  fv: {},                                 // filter choices per dashboard: { period, fields: { key: value } }
  sorts: {},                              // table sorts per tile/report
  returnTo: null,                         // dashboard to add a new report to after its first save
  migrating: false, migrated: new Set(),
  drill: null,                            // the records behind a clicked bar, slice, cell or number
  hintFor: null, hintOn: false,           // the touch tip under the filters
};
const DRAWN = new Map();                  // report body key -> { def, extra } it was last drawn from

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
/** The dashboard Home shows for this person: their own home, else the default an admin chose. */
export const effectiveHome = () => homeDashboardId(homeId(), store.homeDefault || '', (id) => { if (id === homeId() || !store.dashReady) return true; const d = dashById(id); return !!d && visibleTo(d, store.me, me()); }); // your own choice always; the default only if you can see it
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
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(f.currency || 'CAD').toUpperCase(), maximumFractionDigits: Math.abs(val) >= 100 ? 0 : 2 }).format(val); } catch (e) { return String(val); }
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
/** A number written out in full, plus a short form (CA$91.5k) a cramped dashboard tile switches to. */
function both(c, def, v) {
  const full = fmtMeasure(c, def, v);
  if (v == null || typeof v !== 'number' || Math.abs(v) < 1000) return esc(full);
  return `<span class="v-full">${esc(full)}</span><span class="v-short">${esc(fmtShort(c, def, v))}</span>`;
}
function measureLabel(c, def) {
  const m = def.measure || { fn: 'count' };
  const form = c.formById(def.form);
  if (m.fn === 'count' || !m.ref) return 'Number of ' + (form ? nounOf(form, 2) : 'records');
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
  const parts = [n.toLocaleString() + ' ' + nounOf(form, n)];
  const conds = (def.conditions || []).filter((x) => x.ref && fieldOf(c, x.ref) && x.value !== '');
  if (conds.length) parts.push(conds.map((x) => refLabel(c, x.ref, def.form) + (x.op === 'not' ? ' is not ' : ' is ') + x.value).join(def.join === 'or' ? ' or ' : ' and '));
  const blocked = (extra?.fields || []).filter((ff) => ff.values?.length && !filterReaches(c, def, ff.ref));
  if (blocked.length) parts.push(blocked.map((ff) => (fieldOf(c, ff.ref)?.label || 'filter')).join(', ') + ' filter doesn’t reach this report');
  return parts.join(' · ');
}

function bodyHTML(c, def, extra, key) {
  DRAWN.set(key, { def, extra });
  const form = c.formById(def.form);
  if (!form) return { html: `<p class="rp-empty">You don’t have access to the form this report uses.</p>`, caption: '' };
  const time = ['line', 'area'].includes(def.type);
  const ex = extra;
  if (def.type === 'kpi') {
    const k = kpiOf(c, def, ex, Date.now());
    let cmp = '';
    if (def.compare) {
      if (k.delta == null) cmp = `<div class="db-kd">Nothing in ${esc(k.prevLabel)} to compare with</div>`;
      else { const up = k.delta >= 0; cmp = `<div class="db-kd"><span aria-hidden="true">${up ? '▲' : '▼'}</span> ${up ? '+' : ''}${Math.round(k.delta)}% vs ${esc(k.prevLabel)} <span class="db-kp">(${esc(fmtMeasure(c, def, k.prev))})</span></div>`; }
    }
    return { html: `<button type="button" class="rp-kpi db-dr" data-d="drill" data-k="${esc(key)}" title="See the records behind this number">${both(c, def, k.value)}</button><div class="rp-kpisub">${esc(measureLabel(c, def))}${def.compare && !extra?.range ? ' · ' + esc(k.label) : ''}</div>${cmp}`, caption: captionOf(c, def, k.n, extra) };
  }
  const list = rowsFor(c, def, ex);
  const caption = captionOf(c, def, list.length, extra);
  if (!list.length) return { html: `<p class="rp-empty">No records match this report${extra?.range || (extra?.fields || []).some((x) => x.values?.length) ? ' with these filters' : ''}.</p>`, caption };
  if (def.type === 'bar') {
    const items = slicesOf(c, def, list);
    const max = Math.max(0, ...items.map((x) => x.value)) || 1;
    return { caption, html: `<div class="rp-bars" role="list">${items.map((x, i) => { const t = fmtMeasure(c, def, x.value); return `<button type="button" class="rp-bar db-dr" role="listitem" data-d="drill" data-k="${esc(key)}" data-i="${i}" title="${esc(x.key + ': ' + t)}"><span class="rp-bl">${esc(x.key)}</span><span class="rp-bt"><span class="rp-bf" style="width:${Math.max(0.5, (x.value / max) * 100).toFixed(1)}%"></span></span><span class="rp-bv">${esc(t)}</span></button>`; }).join('')}</div>` };
  }
  if (def.type === 'donut') {
    const items = slicesOf(c, def, list).filter((x) => x.value > 0);
    const total = items.reduce((a, b) => a + b.value, 0) || 1;
    let acc = 0;
    const segs = items.map((x, i) => { const a = acc, b = acc + (x.value / total) * 100; acc = b; const gap = Math.min(0.6, (b - a) / 3); return `var(--dc${(i % COLORS) + 1}) ${a.toFixed(2)}% ${(b - gap).toFixed(2)}%, var(--surface) ${(b - gap).toFixed(2)}% ${b.toFixed(2)}%`; }).join(', ');
    return { caption, html: `<div class="db-donut${items.length > 10 ? ' many' : ''}"><div class="db-ring db-dr" data-d="drillring" data-k="${esc(key)}" data-cuts="${esc(cutsOf(items))}" style="background:conic-gradient(${segs})" role="img" aria-label="${esc(items.map((x) => x.key + ' ' + Math.round((x.value / total) * 100) + '%').join(', '))}"><div class="db-ringc">${esc(fmtShort(c, def, total))}<small>total</small></div></div>
      <div class="db-leg" role="list">${items.map((x, i) => `<button type="button" class="db-li db-dr" role="listitem" data-d="drill" data-k="${esc(key)}" data-i="${i}"><span class="db-sw" style="background:var(--dc${(i % COLORS) + 1})"></span><span class="db-lk">${esc(x.key)}</span><span class="db-lv">${esc(fmtMeasure(c, def, x.value))}</span><span class="db-lp">${Math.round((x.value / total) * 100)}%</span></button>`).join('')}</div></div>` };
  }
  if (time) {
    if (!fieldOf(c, def.time)) return { caption, html: `<p class="rp-empty">Choose a date field in the report’s settings.</p>` };
    const iv = def.interval || 'month';
    const b = bucketsOf(c, def, list, Date.now(), ex?.range);
    const n = b.length;
    const step = niceStep(Math.max(0, ...b.map((x) => x.value)) / 4);
    const top = step * 4;
    const X = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);
    const Y = (v) => (v / top) * 100;
    const path = b.map((x, i) => (i ? 'L' : 'M') + X(i).toFixed(2) + ' ' + (100 - Y(x.value)).toFixed(2)).join(' ');
    const years = n > 1 && b[0].date.getFullYear() !== b[n - 1].date.getFullYear();
    const yy = (d) => (years ? ' ’' + String(d.getFullYear()).slice(2) : '');
    const label = (x) => (iv === 'week' ? x.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + yy(x.date)
      : iv === 'month' ? x.date.toLocaleDateString(undefined, { month: 'short' }) + yy(x.date)
      : iv === 'quarter' ? 'Q' + (Math.floor(x.date.getMonth() / 3) + 1) + ' ’' + String(x.date.getFullYear()).slice(2)
      : String(x.date.getFullYear()));
    const every = Math.max(1, Math.ceil(n / 8));
    return { caption, html: `<div class="rp-ln"><div class="rp-plot">
      ${[0, 1, 2, 3, 4].map((k) => `<div class="rp-gl" style="bottom:${k * 25}%"><span>${esc(fmtShort(c, def, step * k))}</span></div>`).join('')}
      <svg class="rp-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${def.type === 'area' ? `<path class="rp-area" d="${path} L100 100 L0 100 Z"></path>` : ''}<path class="rp-path" d="${path}"></path></svg>
      ${b.map((x, i) => { const tip = bucketOf(x.start, iv).k + ' · ' + fmtMeasure(c, def, x.value); return `<button type="button" class="rp-pt${X(i) > 85 ? ' end' : X(i) < 15 ? ' start' : ''}" data-d="drill" data-k="${esc(key)}" data-i="${i}" style="left:${X(i).toFixed(2)}%;bottom:${Y(x.value).toFixed(2)}%" aria-label="${esc(tip)}"><i></i><span class="rp-tip">${esc(tip)}</span></button>`; }).join('')}
    </div><div class="rp-xax">${b.map((x, i) => ((n - 1 - i) % every === 0 ? `<span style="left:${X(i).toFixed(2)}%${X(i) > 92 ? ';transform:translateX(-100%)' : X(i) < 8 ? ';transform:none' : ''}">${esc(label(x))}</span>` : '')).join('')}</div></div>` };
  }
  if (def.type === 'pivot') {
    const p = pivotOf(c, def, list);
    if (!p) return { caption, html: `<p class="rp-empty">Choose rows and columns in the report’s settings.</p>` };
    const tc = `minmax(70px,1.6fr) ${p.cols.map(() => 'minmax(0,1fr)').join(' ')} minmax(0,1fr)`;
    const rl = groupLabel(c, def.group) || 'Rows', cl = groupLabel(c, def.col) || 'Columns';
    return { caption, html: `<div class="rp-table db-pivot" role="table" data-fitk="${esc(key)}" data-n="${list.length}"><div class="rp-tr rp-th" role="row" style="grid-template-columns:${tc}"><div class="rp-td" role="columnheader">${esc(rl)}<span class="db-pvc"> ↓ · ${esc(cl)} →</span></div>${p.cols.map((k, j) => `<div class="rp-td num" role="columnheader"><button type="button" class="db-cellb" data-d="drill" data-k="${esc(key)}" data-c="${j}">${esc(k)}</button></div>`).join('')}<div class="rp-td num" role="columnheader">Total</div></div>
      ${p.rows.map((r, i) => `<div class="rp-tr" role="row" style="grid-template-columns:${tc}"><div class="rp-td" role="rowheader"><button type="button" class="db-cellb" data-d="drill" data-k="${esc(key)}" data-r="${i}">${esc(r.key)}</button></div>${r.cells.map((v, j) => `<div class="rp-td num" role="cell">${v == null ? '–' : `<button type="button" class="db-cellb" data-d="drill" data-k="${esc(key)}" data-r="${i}" data-c="${j}" aria-label="${esc(r.key + ', ' + p.cols[j] + ': ' + fmtMeasure(c, def, v))}">${both(c, def, v)}</button>`}</div>`).join('')}<div class="rp-td num db-b" role="cell"><button type="button" class="db-cellb" data-d="drill" data-k="${esc(key)}" data-r="${i}">${both(c, def, r.total)}</button></div></div>`).join('')}
      <div class="rp-tr db-tot" role="row" style="grid-template-columns:${tc}"><div class="rp-td" role="rowheader">Total</div>${p.colTotals.map((v, j) => `<div class="rp-td num" role="cell"><button type="button" class="db-cellb" data-d="drill" data-k="${esc(key)}" data-c="${j}">${both(c, def, v)}</button></div>`).join('')}<div class="rp-td num" role="cell"><button type="button" class="db-cellb" data-d="drill" data-k="${esc(key)}">${both(c, def, p.grand)}</button></div></div></div>
      ${p.moreRows || p.moreCols ? `<p class="rp-more">Showing the first ${p.rows.length} rows and ${p.cols.length} columns.</p>` : ''}` };
  }
  // table and grouped table
  const cols = (def.columns || []).filter((r) => fieldOf(c, r));
  if (!cols.length) return { caption, html: `<p class="rp-empty">Add columns in the report’s settings.</p>` };
  const sort = D.sorts[key] || def.sort && cols[def.sort.i] && def.sort || { i: 0, dir: 1 };
  const sref = cols[sort.i] || cols[0];
  const tc = cols.map((_, i) => (i === 0 ? 'minmax(80px,1.6fr)' : 'minmax(56px,1fr)')).join(' ');
  const head = `<div class="rp-tr rp-th" role="row" style="grid-template-columns:${tc}">${cols.map((r, i) => `<div class="rp-td${isNumRef(c, r) ? ' num' : ''}" role="columnheader" aria-sort="${sort.i === i ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-d="tsort" data-k="${esc(key)}" data-v="${i}">${esc(refLabel(c, r, def.form))}${sort.i === i ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></div>`).join('')}</div>`;
  const row = (rec) => `<div class="rp-tr" role="row" style="grid-template-columns:${tc}" data-d="openrec" data-v="${esc(rec.id)}">${cols.map((r) => { const t = cellText(c, r, rec); return `<div class="rp-td${isNumRef(c, r) ? ' num' : ''}" role="cell" title="${esc(t)}">${esc(t || '–')}</div>`; }).join('')}</div>`;
  if (def.type === 'grouped') {
    const groups = groupRows(c, def, def.group, list);
    if (!groups.length) return { caption, html: `<p class="rp-empty">Choose what to group by in the report’s settings.</p>` };
    const gl = groupLabel(c, def.group) || 'Group';
    return { caption, html: `<div class="rp-table" role="table" data-fitk="${esc(key)}" data-n="${list.length}">${head}${groups.map((g, gi) => {
      const rs = sortRecs(c, g.rows, sref, sort.dir).slice(0, 10);
      return `<div class="rp-tr db-grp" role="row"><div class="rp-td" role="rowheader"><button type="button" class="db-cellb db-grpb" data-d="drill" data-k="${esc(key)}" data-i="${gi}"><b>${esc(g.key)}</b> <span class="db-gn">${esc(gl)} · ${g.rows.length}</span></button></div><div class="rp-td num" role="cell">${esc(fmtMeasure(c, def, g.value))}</div></div>${rs.map(row).join('')}${g.rows.length > rs.length ? `<p class="rp-more db-gm"><button type="button" class="db-link" data-d="drill" data-k="${esc(key)}" data-i="${gi}">and ${g.rows.length - rs.length} more</button></p>` : ''}`;
    }).join('')}<div class="rp-tr db-grp db-tot" role="row"><div class="rp-td" role="rowheader">Total · ${list.length}</div><div class="rp-td num" role="cell">${esc(fmtMeasure(c, def, measureOf(c, def, list)))}</div></div></div>` };
  }
  const sorted = sortRecs(c, list, sref, sort.dir);
  const shown = sorted.slice(0, 50);
  return { caption, html: `<div class="rp-table" role="table" data-fitk="${esc(key)}" data-n="${list.length}">${head}${shown.map(row).join('')}</div>${sorted.length > shown.length ? `<p class="rp-more">Showing the first ${shown.length} of ${sorted.length}.</p>` : ''}` };
}

/* ---------- drilling down: the records behind a number ---------- */

const DD_PAGE = 200;
const SUMMABLE = new Set(['number', 'decimal', 'currency']);

/** Where the donut's slices end, as fractions of the circle, so a click on the ring finds its slice. */
function cutsOf(items) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  let acc = 0;
  return items.map((x) => (acc += x.value / total).toFixed(5)).join(',');
}

/** 'r:<reportId>' in the report editor, 'd:<dashboardId>' on a dashboard. */
const whereOfKey = (key) => (key.startsWith('r:') ? key : 'd:' + key.split(':')[1]);
const whereOfView = (v) => (v && v.name === 'report' ? 'r:' + v.reportId : v && v.name === 'dashboard' ? 'd:' + v.dashboardId : '');

/** Leaving for anywhere but a record (opened from the list) closes the pop-up. */
export function drillNav(v) { if (D.drill && v.name !== 'record' && whereOfView(v) !== D.drill.where) D.drill = null; }

function reportNameOf(key) {
  if (key.startsWith('r:')) return D.draft?.name || 'Report';
  const [, did, tid] = key.split(':');
  const x = D.edit && D.did === did ? D.edit : dashById(did);
  const t = (x?.tiles || []).find((y) => y.id === tid);
  return reportById(t?.report)?.name || 'Report';
}

/** Work out which records a click stands for: { def, extra, filters } or null. */
function drillPick(data) {
  const key = String(data.k || ''), reg = DRAWN.get(key);
  if (!reg) return null;
  const c = ctx(), def = reg.def;
  const ex = reg.extra;
  const list = () => rowsFor(c, def, ex);
  const has = (k) => data[k] != null && data[k] !== '';
  const filters = [];
  if (!has('i') && !has('r') && !has('c')) { /* the whole report */ }
  else if (def.type === 'bar' || def.type === 'donut') {
    let items = slicesOf(c, def, list());
    if (def.type === 'donut') items = items.filter((x) => x.value > 0);
    const it = items[+data.i];
    if (!it) return null;
    filters.push({ ref: def.group, keys: it.keys, title: it.key });
  } else if (def.type === 'line' || def.type === 'area') {
    const b = bucketsOf(c, def, list(), Date.now(), ex?.range)[+data.i];
    if (!b) return null;
    const k = bucketOf(b.start, def.interval || 'month').k;
    filters.push({ ref: def.time, from: b.start, to: b.end, text: k.startsWith('Week') ? 'the w' + k.slice(1) : k, title: k });
  } else if (def.type === 'pivot') {
    const p = pivotOf(c, def, list());
    if (!p) return null;
    if (has('r') && p.rows[+data.r]) filters.push({ ref: def.group, keys: [p.rows[+data.r].key], title: p.rows[+data.r].key });
    if (has('c') && p.cols[+data.c] != null) filters.push({ ref: def.col, keys: [p.cols[+data.c]], title: p.cols[+data.c] });
  } else if (def.type === 'grouped' && has('i')) {
    const g = groupRows(c, def, def.group, list())[+data.i];
    if (!g) return null;
    filters.push({ ref: def.group, keys: [g.key], title: g.key });
  }
  return { where: whereOfKey(key), def: clone(def), extra: clone(ex), filters, name: reportNameOf(key), q: '', sort: null, shown: DD_PAGE };
}

function openDrill(data) {
  if (D.edit && String(data.k).startsWith('t:')) return; // arranging the dashboard, not reading it
  const dd = drillPick(data);
  if (!dd) return;
  D.drill = dd;
  repaint(() => document.querySelector('#db-dd .db-dd-x')?.focus());
}

function drillTitle(c, dd) {
  if (dd.filters.length) return dd.filters.map((f) => f.title).join(' · ');
  const form = c.formById(dd.def.form);
  return 'All ' + (form ? form.name.toLowerCase() : 'records');
}

/** Columns for the list: the report's own when it's a table, else the form's list columns. */
function drillCols(c, def) {
  const form = c.formById(def.form);
  const t = form && titleFieldOf(form);
  const notTitle = (r) => !(t && r.form === def.form && r.id === t.id);
  if (['table', 'grouped'].includes(def.type) && (def.columns || []).length) return def.columns.filter((r) => fieldOf(c, r) && notTitle(r));
  const out = [];
  const parent = parentsOf(c, def.form)[0];
  if (parent) { const pt = titleFieldOf(c.formById(parent)); if (pt) out.push({ form: parent, id: pt.id }); }
  const usable = (form?.fields || []).filter((f) => !['heading', 'signature', 'file', 'image'].includes(f.type) && (!t || f.id !== t.id));
  const listed = usable.filter((f) => f.inList);
  (listed.length ? listed : usable).slice(0, 8).forEach((f) => out.push({ form: def.form, id: f.id }));
  return out;
}

function drillData(c, dd) {
  const def = dd.def;
  const cols = drillCols(c, def);
  let rows = drillRows(c, def, dd.extra, dd.filters);
  const all = rows.length;
  const q = dd.q.trim().toLowerCase();
  if (q) rows = rows.filter((rec) => [c.recTitle(rec), ...cols.map((r) => cellText(c, r, rec))].join(' ').toLowerCase().includes(q));
  if (dd.sort) {
    if (dd.sort.i < 0) { const tf = titleFieldOf(c.formById(def.form) || {}); rows = tf ? sortRecs(c, rows, { form: def.form, id: tf.id }, dd.sort.dir) : rows; }
    else rows = sortRecs(c, rows, cols[dd.sort.i] || cols[0], dd.sort.dir);
  }
  return { cols, rows, all };
}

function drillHTML(where) {
  const dd = D.drill;
  if (!dd || dd.where !== where) return '';
  const c = ctx(), def = dd.def, form = c.formById(def.form);
  if (!form) return '';
  const { cols, rows, all } = drillData(c, dd);
  const shown = rows.slice(0, dd.shown);
  const items = String(form.name || 'records').toLowerCase();
  const title = titleFieldOf(form)?.label || 'Title';
  const numCol = cols.map((r) => isNumRef(c, r));
  const sumCol = cols.map((r) => { const f = fieldOf(c, r); return !!f && (SUMMABLE.has(f.type) || (f.type === 'formula' && SUMMABLE.has(f.format))); });
  const totals = cols.map((r, i) => (sumCol[i] ? textOf(c, fieldOf(c, r), rows.reduce((a, rec) => a + (Number(valueOf(c, rec, r)) || 0), 0)) : ''));
  const arrow = (i) => (dd.sort && dd.sort.i === i ? (dd.sort.dir > 0 ? ' ↑' : ' ↓') : '');
  const aria = (i) => (dd.sort && dd.sort.i === i ? (dd.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
  // what else narrows these records, shown so the count matches what was clicked
  const ctxChips = [];
  if (dd.extra?.range && dd.extra.periodKey) ctxChips.push('Dashboard: ' + ((PERIODS.find((p) => p[0] === dd.extra.periodKey) || [])[1] || 'period'));
  else if (def.type === 'kpi' && def.compare) ctxChips.push('This month');
  (dd.extra?.fields || []).forEach((ff) => { if (ff.values?.length && filterReaches(c, def, ff.ref)) ctxChips.push(`Dashboard: ${fieldOf(c, ff.ref)?.label || 'filter'} is ${ff.values[0]}`); });
  const conds = (def.conditions || []).filter((x) => x.ref && fieldOf(c, x.ref) && x.value !== '' && x.value != null);
  if (conds.length) ctxChips.push('Report: ' + conds.map((x) => refLabel(c, x.ref, def.form) + (x.op === 'not' ? ' is not ' : ' is ') + x.value).join(def.join === 'or' ? ' or ' : ' and '));
  const m = def.measure || { fn: 'count' };
  const measure = m.fn !== 'count' && m.ref && fieldOf(c, m.ref) ? `<span>${esc(measureLabel(c, def))} <b>${esc(fmtMeasure(c, def, measureOf(c, def, rows)))}</b></span>` : '';
  const head = `<tr><th aria-sort="${aria(-1)}"><button type="button" class="db-dd-hb" data-d="ddsort" data-v="-1">${esc(title)}${arrow(-1)}</button></th>${cols.map((r, i) => `<th class="${numCol[i] ? 'num' : ''}" aria-sort="${aria(i)}"><button type="button" class="db-dd-hb" data-d="ddsort" data-v="${i}">${esc(refLabel(c, r, def.form))}${arrow(i)}</button></th>`).join('')}</tr>`;
  const body = shown.map((rec) => `<tr data-d="ddrec" data-v="${esc(rec.id)}"><td class="title"><button type="button" class="db-dd-open" data-d="ddrec" data-v="${esc(rec.id)}">${esc(c.recTitle(rec))}</button></td>${cols.map((r, i) => { const t = cellText(c, r, rec); const f = fieldOf(c, r); return `<td class="${numCol[i] ? 'num' : f?.type === 'textarea' ? 'db-dd-long' : ''}" title="${esc(t)}">${esc(t || '')}</td>`; }).join('')}</tr>`).join('');
  const one = String(form.itemName || form.name || 'record').toLowerCase();
  return `<div class="db-dd-scrim" data-d="ddclose"><div class="db-dd" id="db-dd" role="dialog" aria-modal="true" aria-labelledby="db-dd-h">
    <div class="db-dd-h">
      <div class="db-dd-top"><div class="db-dd-tt"><h2 id="db-dd-h">${esc(drillTitle(c, dd))}</h2><span class="db-dd-from">From “${esc(dd.name)}” · ${esc(form.name)}</span></div>
        <button type="button" class="ibtn db-dd-x" data-d="ddclose" aria-label="Close">✕</button></div>
      ${dd.filters.length || ctxChips.length ? `<div class="db-dd-chips">${dd.filters.map((f, i) => `<span class="db-dd-chip">${esc(drillLabel(c, f))}<button type="button" data-d="ddchip" data-v="${i}" aria-label="Remove ${esc(drillLabel(c, f))}">×</button></span>`).join('')}${ctxChips.map((t) => `<span class="db-dd-chip fixed">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="db-dd-sum"><span><b>${rows.length.toLocaleString()}</b> ${esc(rows.length === 1 ? one : items)}${rows.length !== all ? ` of ${all.toLocaleString()}` : ''}</span>${measure}</div>
    </div>
    <div class="db-dd-tools"><input id="dd-q" class="in" type="search" placeholder="Search these ${esc(items)}" aria-label="Search these ${esc(items)}" value="${esc(dd.q)}"><span class="grow"></span><button type="button" class="btn" data-d="ddcsv"${rows.length ? '' : ' disabled'}>Export CSV</button></div>
    <div class="db-dd-body">${rows.length ? `<table class="tbl db-dd-tbl"><thead>${head}</thead><tbody>${body}</tbody>${sumCol.some(Boolean) ? `<tfoot><tr><td>Total · ${rows.length.toLocaleString()}</td>${totals.map((t, i) => `<td class="${numCol[i] ? 'num' : ''}">${esc(t)}</td>`).join('')}</tr></tfoot>` : ''}</table>
      ${rows.length > shown.length ? `<div class="db-dd-more"><button type="button" class="btn sm" data-d="ddmore">Show ${Math.min(DD_PAGE, rows.length - shown.length)} more</button><span class="help">${(rows.length - shown.length).toLocaleString()} more</span></div>` : ''}`
      : `<p class="db-dd-none">${dd.q ? 'Nothing matches your search.' : 'No records here.'}</p>`}</div>
    <div class="db-dd-foot"><span class="help">Click a record to open it. Back brings you here.</span><span class="grow"></span><button type="button" class="btn primary" data-d="ddclose">Done</button></div>
  </div></div>`;
}

/** CSV of exactly what the pop-up lists. Text a spreadsheet would run as a formula is defused. */
function drillCsv() {
  const dd = D.drill; if (!dd) return;
  const c = ctx(), form = c.formById(dd.def.form);
  const { cols, rows } = drillData(c, dd);
  const q = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const lines = [[titleFieldOf(form)?.label || 'Title', ...cols.map((r) => refLabel(c, r, dd.def.form))].map(q).join(',')];
  rows.forEach((rec) => lines.push([c.recTitle(rec), ...cols.map((r) => { const f = fieldOf(c, r); const v = valueOf(c, rec, r); return f && kindOf(f) === 'num' && typeof v === 'number' ? v : cellText(c, r, rec); })].map(q).join(',')));
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = (drillTitle(c, dd) + '.csv').replace(/[\\/:*?"<>|]+/g, ' ');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Downloaded ${rows.length} ${rows.length === 1 ? 'record' : 'records'}`);
}

/** Which slice of a donut a click landed on (-1 for the hole in the middle). */
function ringSlice(el, e) {
  const r = el.getBoundingClientRect();
  const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
  if (Math.hypot(x, y) < r.width * 0.3) return -1;
  const turn = ((Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
  return String(el.dataset.cuts || '').split(',').map(Number).findIndex((cut) => turn <= cut);
}

/* ---------- fitting tables into dashboard tiles ---------- */

/**
 * A table, grouped table or pivot on a dashboard shows the rows that fit its tile, and a
 * "See all" button (which opens the drill-down list) instead of a scroll bar. Runs after
 * each redraw and when the window changes size; phones (tiles stacked, any height) skip it.
 */
export function fitTiles() {
  document.querySelectorAll('#db-cv .db-tile').forEach((tile) => {
    const wb = tile.querySelector('.rp-wb');
    if (!wb) return;
    const over = () => wb.scrollHeight > wb.clientHeight + 1;
    const loose = getComputedStyle(tile).position !== 'absolute'; // phones: tiles take the height they need
    // undo the last fitting, then fit again
    tile.classList.remove('compact', 'tight');
    tile.querySelectorAll('[data-fit-hid]').forEach((el) => { el.hidden = false; delete el.dataset.fitHid; });
    tile.querySelectorAll('.db-more').forEach((el) => el.remove());
    const hide = (el) => { if (el && !el.hidden) { el.hidden = true; el.dataset.fitHid = '1'; } };
    if (loose) { phoneCard(tile, wb, hide); return; }
    // numbers that don't fit their space switch to the short form (CA$91.5k)
    if ([...wb.querySelectorAll('.rp-kpi, .db-pivot .db-cellb')].some((e) => e.scrollWidth > e.clientWidth + 1)) tile.classList.add('compact');
    // a KPI drops its extras, smallest first
    for (const sel of ['.db-kd', '.rp-kpisub']) if (over()) hide(wb.querySelector(sel));
    // bars squeeze together, then the ones that still don't fit go behind "See all"
    const bars = wb.querySelector('.rp-bars');
    if (bars && over()) {
      tile.classList.add('tight');
      const items = [...bars.children];
      if (over()) {
        const more = moreButton(tile, items.length);
        bars.appendChild(more);
        while (over() && items.length > 1) hide(items.pop());
      }
    }
    // tables, grouped tables and pivots show the rows that fit
    const tbl = wb.querySelector('.rp-table[data-fitk]');
    if (tbl && over()) {
      const rows = [...tbl.querySelectorAll(':scope > .rp-tr:not(.rp-th):not(.db-tot), :scope > .rp-more')];
      wb.querySelectorAll(':scope > .rp-more').forEach(hide);
      tbl.insertBefore(moreButton(tile, +tbl.dataset.n || 0, tbl.dataset.fitk), tbl.querySelector(':scope > .db-tot'));
      while (over() && rows.length) hide(rows.pop());
      const last = rows[rows.length - 1];
      if (last && last.classList.contains('db-grp')) hide(last); // a group heading with no rows under it
      if (over()) hide(tbl.querySelector(':scope > .db-tot'));
    }
    // last resort: the caption under the title
    if (over()) hide(tile.querySelector('.rp-wh .rp-cap'));
  });
}

/**
 * Phones show each report as a small card: the chart without its legend, the top 5 bars,
 * the top 3 rows of a table (or groups of a grouped table, or rows of a pivot with just
 * its totals), and a "See all" that opens the drill-down. CSS does the rest.
 */
const PHONE_BARS = 5, PHONE_ROWS = 3;
function phoneCard(tile, wb, hide) {
  const bars = wb.querySelector('.rp-bars');
  if (bars) {
    const items = [...bars.children];
    if (items.length > PHONE_BARS) { items.slice(PHONE_BARS).forEach(hide); bars.appendChild(moreButton(tile, items.length)); }
  }
  const tbl = wb.querySelector('.rp-table[data-fitk]');
  if (!tbl) return;
  wb.querySelectorAll(':scope > .rp-more').forEach(hide);
  let rows;
  if (tbl.querySelector(':scope > .db-grp:not(.db-tot)')) {
    // a grouped table shows its groups, not the records inside them
    tbl.querySelectorAll(':scope > .rp-tr:not(.db-grp), :scope > .rp-more').forEach(hide);
    rows = [...tbl.querySelectorAll(':scope > .db-grp:not(.db-tot)')];
  } else rows = [...tbl.querySelectorAll(':scope > .rp-tr:not(.rp-th):not(.db-tot)')];
  if (rows.length > PHONE_ROWS) {
    rows.slice(PHONE_ROWS).forEach(hide);
    tbl.insertBefore(moreButton(tile, +tbl.dataset.n || 0, tbl.dataset.fitk), tbl.querySelector(':scope > .db-tot'));
  }
}

function moreButton(tile, n, key) {
  const k = key || tile.querySelector('[data-d="drill"][data-k]')?.dataset.k || '';
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'db-more'; b.dataset.d = 'drill'; b.dataset.k = k;
  b.textContent = n ? `See all ${n.toLocaleString()}` : 'See all';
  return b;
}
let fitTimer = null;
window.addEventListener('resize', () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitTiles, 120); });

/* ---------- the Reports list ---------- */

/* ---------- the Reports and Dashboards lists: columns you pick, one search across them ---------- */

const CT = { reports: { q: '', sort: { k: 'name', d: 1 }, pop: false }, dashes: { q: '', sort: { k: 'name', d: 1 }, pop: false } };
const CT_DEF = { reports: [REPORT_COLS, REPORT_DEFAULT], dashes: [DASH_COLS, DASH_DEFAULT] };
const ctCols = (kind) => readCols(localStorage, kind, me(), CT_DEF[kind][0], CT_DEF[kind][1]);
const shortDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const dateCell = (t) => ({ text: shortDate(t), sort: t || null });
const who = (u) => (u === me() ? 'You' : nameOf(u));
const groupNames = (ids) => (ids || []).map((g) => store.groups.find((y) => y.id === g)?.name || 'a group');
const sharingText = (x) => (x.shared ? ((x.groups || []).length ? 'Shared with ' + groupNames(x.groups).join(', ') : 'Everyone') : 'Private');
const byWord = (ref) => (ref && ref.by ? ' (by ' + ((BYS.find((b) => b[0] === ref.by) || [0, ref.by])[1]).toLowerCase() + ')' : '');

function reportRow(c, r, dashes) {
  const def = r.def || {}, t = def.type;
  const lab = (ref) => (ref ? refLabel(c, ref, def.form) : '');
  const conds = (def.conditions || []).filter((x) => x && x.ref && x.value !== undefined && x.value !== '')
    .map((x) => lab(x.ref) + (x.op === 'not' ? ' is not ' : ' is ') + (x.value === '(blank)' ? 'blank' : x.value)).join(def.join === 'or' ? ' or ' : ' and ');
  const on = usedOn(dashes, r.id).map((d) => d.name);
  return { id: r.id, name: r.name || 'Report', cells: {
    type: { text: (TYPES.find((x) => x[0] === t) || [0, 'Report'])[1] },
    form: { text: c.formById(def.form)?.name || '' },
    dashes: { text: on.join(', '), sort: on.length ? on.join(', ') : '' },
    updated: dateCell(r.updatedAt),
    value: { text: t === 'table' ? '' : measureLabel(c, def) },
    group: { text: ['grouped', 'pivot', 'bar', 'donut'].includes(t) && def.group ? lab(def.group) + byWord(def.group) : '' },
    col: { text: t === 'pivot' && def.col ? lab(def.col) + byWord(def.col) : '' },
    time: { text: ['line', 'area'].includes(t) && def.time ? lab(def.time) + ', by ' + (def.interval || 'month') : '' },
    conds: { text: conds },
    owner: { text: who(r.ownerId) },
    sharing: { text: sharingText(r) },
    created: dateCell(r.createdAt),
  } };
}
function dashRow(x, home) {
  const reps = (x.tiles || []).filter((t) => t.report).map((t) => reportById(t.report)?.name).filter(Boolean);
  return { id: x.id, name: x.name || 'Dashboard', cells: {
    count: { text: String(reps.length), sort: reps.length },
    home: { text: x.id === home ? 'Home' : x.id === store.homeDefault ? 'Everyone’s default' : '', sort: x.id === home ? 'Home' : x.id === store.homeDefault ? 'Default' : '' },
    sharing: { text: sharingText(x) },
    updated: dateCell(x.updatedAt),
    reports: { text: reps.join(', ') },
    period: { text: (PERIODS.find((p) => p[0] === (x.filters?.period || 'all')) || PERIODS[0])[1] },
    owner: { text: who(x.ownerId) },
    created: dateCell(x.createdAt),
  } };
}

/** The table: search box, Columns picker, sortable headings; each row opens its item. */
function catalogHTML(kind, rows, openAct, empty) {
  const st = CT[kind], [ALL] = CT_DEF[kind], cols = ctCols(kind);
  const colOf = (k) => ALL.find((c) => c.key === k);
  const found = sortRows(searchRows(rows, st.q, cols), st.sort.k, st.sort.d);
  const noun = kind === 'reports' ? 'report' : 'dashboard';
  const th = (k, label) => { const on = st.sort.k === k; return `<th scope="col" aria-sort="${on ? (st.sort.d > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="ct-sort${on ? ' on' : ''}" data-ct="sort" data-k="${k}" data-kind="${kind}">${esc(label)}${on ? `<span aria-hidden="true">${st.sort.d > 0 ? ' ↑' : ' ↓'}</span>` : ''}</button></th>`; };
  const pop = st.pop ? `<div class="ct-pop" role="dialog" aria-label="Columns"><p class="ct-plab">Columns to show</p><ul>${
    cols.map((k, i) => `<li><label><input type="checkbox" checked data-ct="col" data-k="${k}" data-kind="${kind}"> ${esc(colOf(k).label)}</label><span class="ct-mv"><button type="button" class="ibtn" data-ct="mv" data-k="${k}" data-dir="-1" data-kind="${kind}" aria-label="Move ${esc(colOf(k).label)} left"${i === 0 ? ' disabled' : ''}>↑</button><button type="button" class="ibtn" data-ct="mv" data-k="${k}" data-dir="1" data-kind="${kind}" aria-label="Move ${esc(colOf(k).label)} right"${i === cols.length - 1 ? ' disabled' : ''}>↓</button></span></li>`).join('')
  }${ALL.filter((c) => !cols.includes(c.key)).map((c) => `<li><label><input type="checkbox" data-ct="col" data-k="${c.key}" data-kind="${kind}"> ${esc(c.label)}</label></li>`).join('')}</ul><p class="ct-pnote">The name is always first. Your choice is kept on this device.</p><button type="button" class="btn sm" data-ct="pop" data-kind="${kind}">Done</button></div>` : '';
  const head = `<div class="ct-bar"><div class="ct-search"><svg class="fs-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input type="search" class="in" data-ksearch="ct-${kind}" data-ctq="${kind}" value="${esc(st.q)}" placeholder="Search ${noun}s" aria-label="Search ${noun}s" autocomplete="off"></div>
    <span class="help" role="status">${st.q.trim() ? `Showing ${found.length} of ${rows.length}` : `${rows.length} ${noun}${rows.length === 1 ? '' : 's'}`}</span>
    <div class="ct-colwrap"><button type="button" class="btn sm" data-ct="pop" data-kind="${kind}" aria-expanded="${st.pop}">Columns</button>${pop}</div></div>`;
  if (!rows.length) return head + `<div class="panel"><p class="note">${empty}</p></div>`;
  const body = found.length ? found.map((r) => `<tr data-d="${openAct}" data-v="${esc(r.id)}"><th scope="row" class="ct-name"><button type="button" class="ct-open" data-d="${openAct}" data-v="${esc(r.id)}">${esc(r.name)}</button></th>${
    cols.map((k) => { const c = r.cells[k] || {}; const lab = esc(colOf(k).label); return `<td data-label="${lab}"${colOf(k).num ? ' class="num"' : ''}>${k === 'home' && kind === 'dashes' ? (c.text ? `<button type="button" class="db-home on" data-d="sethome" data-v="" aria-pressed="true" title="Opens when you start Formwright">Home</button>` : `<button type="button" class="db-home" data-d="sethome" data-v="${esc(r.id)}" aria-pressed="false">Set as home</button>`) : c.text ? esc(c.text) : '<span class="ct-blank">—</span>'}</td>`; }).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length + 1}" class="ct-none">No ${noun}s match “${esc(st.q.trim())}”.</td></tr>`;
  return head + `<div class="panel ct-wrap"><table class="ct-tbl"><thead><tr>${th('name', 'Name')}${cols.map((k) => th(k, colOf(k).label)).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-ct]');
  if (!b || b.tagName === 'INPUT') { if (CT.reports.pop || CT.dashes.pop) { if (!e.target.closest('.ct-colwrap')) { CT.reports.pop = CT.dashes.pop = false; repaint(); } } return; }
  const kind = b.dataset.kind, st = CT[kind]; if (!st) return;
  const a = b.dataset.ct;
  if (a === 'pop') { st.pop = !st.pop; repaint(() => document.querySelector(st.pop ? '.ct-pop input' : `[data-ct="pop"][data-kind="${kind}"]`)?.focus()); }
  else if (a === 'sort') { st.sort = nextSort(st.sort, b.dataset.k, CT_DEF[kind][0]); repaint(); }
  else if (a === 'mv') { saveCols(localStorage, kind, me(), moveCol(ctCols(kind), b.dataset.k, +b.dataset.dir)); repaint(() => document.querySelector(`[data-ct="mv"][data-k="${b.dataset.k}"][data-dir="${b.dataset.dir}"]:not(:disabled)`)?.focus()); }
});
document.addEventListener('change', (e) => {
  const t = e.target; if (!t.dataset || t.dataset.ct !== 'col') return;
  const kind = t.dataset.kind; saveCols(localStorage, kind, me(), toggleCol(ctCols(kind), t.dataset.k));
  repaint(() => document.querySelector(`[data-ct="col"][data-k="${t.dataset.k}"]`)?.focus());
});
document.addEventListener('input', (e) => {
  const t = e.target; if (!t.dataset || !t.dataset.ctq) return;
  CT[t.dataset.ctq].q = t.value; repaint();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const t = e.target;
  if (t.dataset && t.dataset.ctq && t.value) { e.preventDefault(); CT[t.dataset.ctq].q = ''; repaint(); return; }
  for (const kind of ['reports', 'dashes']) if (CT[kind].pop) { CT[kind].pop = false; repaint(() => document.querySelector(`[data-ct="pop"][data-kind="${kind}"]`)?.focus()); return; }
});
/** Back closes the Columns pop-up first (app.js asks). */
export function closeCatalogPop() { if (!CT.reports.pop && !CT.dashes.pop) return false; CT.reports.pop = CT.dashes.pop = false; repaint(); return true; }

export function viewReportsList() {
  maybeMigrate();
  const c = ctx(), dashes = dashesVisible();
  const rows = reportsVisible().map((r) => reportRow(c, r, dashes));
  return `
  <div class="head"><div class="ttl"><div><h1>Reports</h1><p class="sub">Each report is one chart, table, pivot or number. Put it on as many dashboards as you like; changing it changes it everywhere.</p></div></div>
    <div class="actions"><button class="btn" data-d="nav-dashes">Dashboards</button><button class="btn primary" data-d="newrep">+ New report</button></div></div>
  ${catalogHTML('reports', rows, 'openrep', 'No reports yet. Press <b>New report</b> to make one.')}`;
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
  const drillPop = drillHTML('r:' + d.id);
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
  </div></div>${drillPop}`;
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
  const groupable = fields.filter(canSplit);
  const bySel = (dv, ref, label) => (ref && ref.by ? `<div class="db-by"><label class="db-lab" for="db-${dv}">${label}</label><select class="in" id="db-${dv}" data-dv="${dv}">${BYS.map(([k, l]) => opt(k, l, ref.by)).join('')}</select></div>` : '');
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
    h += `<div class="db-sec"><label class="db-lab">${t === 'pivot' ? 'Rows' : t === 'donut' ? 'Slices' : 'Group by'}</label>${sel('group', groupable.map((x) => opt(refKey(x.ref), lab(x), refKey(def.group && { form: def.group.form, id: def.group.id }))).join(''), '')}${bySel('groupby', def.group, 'Split by')}</div>`;
  }
  if (t === 'bar' || t === 'donut') {
    const cur = String(def.limit ?? 8);
    h += `<div class="db-sec"><label class="db-lab" for="db-limit">${t === 'donut' ? 'Slices shown' : 'Bars shown'}</label>${sel('limit', [['8', 'Top 8, the rest as Other'], ['12', 'Top 12, the rest as Other'], ['20', 'Top 20, the rest as Other'], ['all', 'All of them']].map(([k, l]) => opt(k, l, cur)).join(''), '', ' id="db-limit"')}${t === 'donut' && cur === 'all' ? '<p class="help">With many slices, colours repeat in order; the list beside the chart matches them up.</p>' : ''}</div>`;
  }
  if (t === 'pivot') h += `<div class="db-sec"><label class="db-lab">Columns</label>${sel('col', groupable.filter((x) => refKey(x.ref) !== refKey(def.group && { form: def.group.form, id: def.group.id }) || x.kind === 'date').map((x) => opt(refKey(x.ref), lab(x), refKey(def.col && { form: def.col.form, id: def.col.id }))).join(''), '')}${bySel('colby', def.col, 'Split by')}</div>`;
  if (t === 'line' || t === 'area') {
    h += `<div class="db-sec"><label class="db-lab">Over time, by</label>${sel('time', dates.map((x) => opt(refKey(x.ref), lab(x), refKey(def.time))).join(''), '')}
      <div class="db-seg" role="group" aria-label="Interval">${[['week', 'Weeks'], ['month', 'Months'], ['quarter', 'Quarters'], ['year', 'Years']].map(([k, l]) => `<button type="button" class="${(def.interval || 'month') === k ? 'on' : ''}" aria-pressed="${(def.interval || 'month') === k}" data-d="interval" data-v="${k}">${l}</button>`).join('')}</div></div>
      <div class="db-sec"><label class="db-lab" for="db-span">Dates shown</label>${sel('span', [['fit', 'From the first record to the last'], ['last', 'The last ' + ({ week: '26 weeks', month: '12 months', quarter: '8 quarters', year: '5 years' })[def.interval || 'month']], ['custom', 'Choose dates']].map(([k, l]) => opt(k, l, def.span || 'fit')).join(''), '', ' id="db-span"')}
        ${def.span === 'custom' ? `<div class="db-dates"><label><span class="db-lab">From</span><input class="in" type="date" data-dv="tfrom" value="${esc(def.from || '')}"></label><label><span class="db-lab">To</span><input class="in" type="date" data-dv="tto" value="${esc(def.to || '')}"></label></div><p class="help">Leave one blank to start or end with your records.</p>` : ''}
        <p class="help">On a dashboard with a period picked (This year, say), the chart shows that period instead.</p></div>`;
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

async function addTile(did, reportId, text, link) {
  const editing = D.edit && D.did === did;
  const x = editing ? D.edit : dashById(did); if (!x) return;
  const tiles = editing ? canvasTiles(x.tiles || []) : gridTiles(x.tiles || [], x.filters);
  const r = reportById(reportId) || (D.draft && D.draft.id === reportId ? D.draft : null);
  const size = link ? LINK_SIZE : tileSize(text ? 'text' : r?.def?.type);
  const at = placeTile(tiles, size.w, size.h);
  tiles.push(link ? { id: uid('t'), link, ...size, ...at } : text ? { id: uid('t'), text: { title: 'Notes', body: '' }, ...size, ...at } : { id: uid('t'), report: reportId, ...size, ...at });
  if (editing) { D.edit.tiles = tiles; D.edit.dirty = true; repaint(); return; }
  try { await saveDashboard(did, { ...dashData(x), tiles, updatedAt: Date.now() }); toast('Added to ' + x.name); }
  catch (e) { toast('Couldn’t change that dashboard.'); }
}

function dashData(x) {
  return { name: x.name, ownerId: x.ownerId, shared: !!x.shared, groups: x.groups || [], tiles: clone(gridTiles(x.tiles || [], x.filters)), filters: { ...clone(x.filters || { period: 'all', fields: [] }), grid: GRID }, createdAt: x.createdAt || Date.now(), updatedAt: x.updatedAt || Date.now() };
}

/* ---------- the Dashboards list ---------- */

export function viewDashboards() {
  maybeMigrate();
  const home = homeId();
  const rows = dashesVisible().map((x) => dashRow(x, home));
  return `
  <div class="head"><div class="ttl"><div><h1>Dashboards</h1><p class="sub">Saved reports and notes on one page, with a period and filters across the top. Your home dashboard opens when you start Formwright.</p></div></div>
    <div class="actions"><button class="btn" data-d="nav-reports">Reports</button><button class="btn primary" data-d="newdash">+ New dashboard</button></div></div>
  ${catalogHTML('dashes', rows, 'opendash', 'No dashboards yet. Press <b>New dashboard</b>, then add reports to it.')}`;
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
  let placed = edit ? canvasTiles(x.tiles || []) : gridTiles(x.tiles || [], x.filters);
  if (!edit) { // shortcuts this person can't use (admin screens, forms they can't see) are left out, and the rest close up
    const vis = visibleTiles(placed, H.linkEnv());
    if (vis.length < placed.length) placed = resolveCanvas(vis, null, true);
  }
  const home = homeId() === x.id, isDefault = (store.homeDefault || '') === x.id;
  const floatUp = !!x.filters?.floatUp;
  const tiles = readingOrder(placed).map((t) => tileHTML(c, x, t, extra, edit)).join('');
  const cvRows = Math.max(1, canvasHeight(placed) + (edit ? 6 : 0));
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
    <button type="button" class="db-home${home ? ' on' : ''}" data-d="sethome" data-v="${home ? '' : esc(x.id)}" aria-pressed="${home}">${home ? 'My home' : 'Set as my home'}</button>
    ${admin() ? `<button type="button" class="db-home${isDefault ? ' on' : ''}" data-d="setdefhome" data-v="${isDefault ? '' : esc(x.id)}" aria-pressed="${isDefault}" title="What Home shows for anyone who hasn’t chosen their own">${isDefault ? 'Everyone’s default home' : 'Make everyone’s default home'}</button>` : isDefault ? '<span class="chip">Everyone’s default home</span>' : ''}
    ${x.shared ? `<span class="chip">Shared${(x.groups || []).length ? ' with ' + (x.groups || []).map((g) => esc(store.groups.find((y) => y.id === g)?.name || 'a group')).join(', ') : ''}</span>` : ''}
    <span class="grow"></span>
    ${edit ? `${D.confirm === 'deldash' ? `<button class="btn danger armed" data-d="deldash">Tap again to delete</button>` : `<button class="btn danger" data-d="deldash">Delete</button>`}
      <button class="btn" data-d="addtext">+ Text block</button><button class="btn${D.picker === 'links' ? ' on' : ''}" data-d="linkpicker">+ Shortcut</button><button class="btn${D.picker === true ? ' on' : ''}" data-d="picker">+ Add report</button>
      <button class="btn ghost" data-d="canceledit">Cancel</button><button class="btn primary" data-d="savedash">Save dashboard</button>`
      : may ? `<button class="btn" data-d="editdash">Edit dashboard</button>` : `<span class="chip">View only</span>`}
  </div>
  ${edit && admin() ? `<div class="panel db-sharebar">${sharingHTML(x, 'dash')}</div>` : ''}
  ${edit && D.picker === 'links' ? linkPickerHTML(x) : edit && D.picker ? pickerHTML(x) : ''}
  <div class="db-filters" role="group" aria-label="Dashboard filters">
    <span class="db-lab">Period</span><div class="db-seg">${PERIODS.map(([k, l]) => `<button type="button" class="${fv.period === k ? 'on' : ''}" aria-pressed="${fv.period === k}" data-d="period" data-v="${k}">${l}</button>`).join('')}</div>
    ${fieldFilters}${addFilter}
    ${edit ? `<span class="help">The period you pick here is saved as the dashboard’s starting period.</span>` : ''}
  </div>
  ${edit ? `<div class="db-cvbar"><label class="switch db-float"><input type="checkbox" data-dv="float"${floatUp ? ' checked' : ''}><span class="tr"></span><span>Float items up</span></label><p class="help db-cvhelp">Drag an item by its handle to move it, or drag its bottom-right corner to resize it. Each dot is one step; 24 across. Items in the way move down. With a handle focused, arrow keys move the item and Shift + arrow keys resize it.</p></div>` : ''}
  ${!edit && placed.length ? holdHint(x.id) : ''}
  ${placed.length ? `<div class="db-cv${edit ? ' edit' : ''}${edit ? '' : ' can-drill'}" id="db-cv" style="--rows:${cvRows}"><div class="db-ghost" id="db-ghost" hidden></div>${tiles}</div>` : `<div class="panel empty"><h2>Nothing here yet</h2><p>${may ? 'Add saved reports, shortcuts or a text block.' : 'The owner hasn’t added anything yet.'}</p>${may && !edit ? '<button class="btn primary" data-d="editdash">Add reports</button>' : ''}</div>`}
  </div>${edit ? '' : drillHTML('d:' + x.id)}`;
}

/** Touch screens: a one-line tip under the filters, for the first three dashboards opened. */
function holdHint(id) {
  if (D.hintFor !== id) {
    D.hintFor = id;
    let n = 0;
    try { n = +localStorage.getItem('fw.holdHint') || 0; } catch (err) { n = 3; }
    D.hintOn = n < 3;
    if (D.hintOn) try { localStorage.setItem('fw.holdHint', String(n + 1)); } catch (err) { /* private mode */ }
  }
  return D.hintOn ? `<p class="db-hint">Tap a chart to see its records. Press and hold for details.</p>` : '';
}

function pickerHTML(x) {
  const c = ctx();
  const have = new Set((x.tiles || []).map((t) => t.report).filter(Boolean));
  const list = reportsVisible();
  return `<div class="panel db-picker"><div class="db-ph"><b>Add a saved report</b><span class="grow"></span><button class="btn sm" data-d="newrepfor">+ New report</button></div>
    ${list.length ? `<div class="db-plist">${list.map((r) => `<button type="button" class="db-pick" data-d="pick" data-v="${esc(r.id)}"${have.has(r.id) ? ' disabled' : ''}><b>${esc(r.name)}</b><small>${esc((TYPES.find((t) => t[0] === r.def?.type) || ['', ''])[1])}${c.formById(r.def?.form) ? ' · ' + esc(c.formById(r.def.form).name) : ''}${have.has(r.id) ? ' · already here' : ''}</small></button>`).join('')}</div>` : '<p class="note">No saved reports yet. Make one with <b>New report</b>.</p>'}</div>`;
}

/** The shortcut picker: forms (their list, or a new record), insights, and, for admins, administration. */
function linkPickerHTML(x) {
  const env = H.linkEnv();
  const forms = ctx().forms.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
  const groups = linkChoices(env, forms);
  const have = new Set((x.tiles || []).filter((t) => t.link).map((t) => linkKey(t.link)));
  return `<div class="panel db-picker db-lpick"><div class="db-ph"><b>Add a shortcut</b><span class="help">A small tile that opens part of Formwright. Resize it by its corner like any tile.</span></div>
    ${groups.map((g) => `<section><h3 class="db-lgh">${esc(g.title)}${g.admin ? ' <span class="chip warn">Only administrators see these</span>' : ''}</h3><div class="db-plist">${g.items.map((i) => `<button type="button" class="db-pick db-lp" data-d="addlink" data-v="${esc(i.key)}"${have.has(i.key) ? ' disabled' : ''}>${linkIcon(i)}<span><b>${esc(i.title)}</b><small>${esc(i.sub)}${have.has(i.key) ? ' · already here' : ''}</small></span></button>`).join('')}</div></section>`).join('')}</div>`;
}
const linkIcon = (i, big) => (i.form ? (i.glyph ? `<span class="db-lic plus" style="background:${esc(colorOf(i.form))}" aria-hidden="true">${esc(i.glyph)}</span>` : badge(i.form)) : `<span class="glyph navg db-lic" aria-hidden="true">${esc(i.glyph)}</span>`).replace('class="', `class="${big ? 'big ' : ''}`);

/* ---------- the starter Home: for anyone with no home dashboard of their own and no default ---------- */
/** Shortcuts to what this person can open: their sidebar forms, My work, Dashboards, Reports and (admins) two admin screens. */
function starterTiles() {
  const env = H.linkEnv();
  const links = [
    ...H.starterForms().slice(0, 12).map((f) => ({ to: 'list', form: f.id })),
    { to: 'page', page: 'mywork' }, { to: 'page', page: 'dashboards' }, { to: 'page', page: 'reports' },
    ...(env.isAdmin ? [{ to: 'page', page: 'designer' }, { to: 'page', page: 'users' }] : []),
  ].filter((l) => linkInfo(l, env)?.ok);
  const tiles = [];
  links.forEach((link, i) => { const at = placeTile(tiles, LINK_SIZE.w, LINK_SIZE.h); tiles.push({ id: 'st' + i, link, ...LINK_SIZE, ...at }); });
  return tiles;
}
/** The starter Home's page, or '' when there's nothing to put on it. */
export function viewStarterHome() {
  const tiles = starterTiles();
  D.starter = tiles;
  if (!tiles.length) return '';
  const x = { id: 'starter', name: 'Home', tiles };
  return `<div id="dbx" class="db-dash rp"><div class="db-head"><h1 class="db-title">Home</h1><span class="chip">Starter</span><span class="grow"></span><button type="button" class="btn primary" data-d="starterkeep">Make this my dashboard</button></div>
    <p class="help db-starter">Shortcuts to what you can open. Make it your dashboard to rearrange it, resize tiles and add reports.</p>
    <div class="db-cv can-drill" id="db-cv" style="--rows:${Math.max(1, canvasHeight(tiles))}">${readingOrder(tiles).map((t) => linkTileHTML(x, t, false)).join('')}</div></div>`;
}

/** A shortcut tile: icon, name and a live count; tall enough, a line saying where it goes. */
function linkTileHTML(x, t, edit) {
  const env = H.linkEnv();
  const i = linkInfo(t.link, env);
  const label = i ? i.title : 'Shortcut';
  const grip = edit ? `<button type="button" class="db-grip" data-cv="move" data-v="${esc(t.id)}" aria-label="Move ${esc(label)}. Arrow keys move it; Shift and arrow keys resize it." title="Drag to move"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="6" r="1.8"/><circle cx="16" cy="6" r="1.8"/><circle cx="8" cy="12" r="1.8"/><circle cx="16" cy="12" r="1.8"/><circle cx="8" cy="18" r="1.8"/><circle cx="16" cy="18" r="1.8"/></svg></button>` : '';
  const del = edit ? `<button type="button" class="ibtn" data-d="tdel" data-v="${esc(t.id)}" aria-label="Remove ${esc(label)} from this dashboard">✕</button>` : '';
  const rz = edit ? `<button type="button" class="db-rz" data-cv="rz" data-v="${esc(t.id)}" aria-label="Resize ${esc(label)}, now ${t.w} columns by ${t.h} rows" title="Drag to resize"></button><span class="db-badge" hidden></span>` : '';
  const open = `<article class="rp-w db-tile db-sc${t.h >= 4 ? ' tall' : ''}" data-tile="${esc(t.id)}" style="${tileBox(t)}" aria-label="${esc(label)}">`;
  if (!i) return `${open}<div class="rp-wh">${grip}<div class="rp-wt"><p class="rp-empty">This shortcut points at a form that was deleted.</p></div>${del}</div>${rz}</article>`;
  const body = `${linkIcon(i, t.h >= 4)}<span class="db-lt"><b>${esc(i.title)}</b><small>${esc(i.sub)}</small>${t.h >= 4 ? `<span class="db-ld">${esc(i.desc)}</span>` : ''}</span>`;
  if (!edit) return `${open}<button type="button" class="db-lgo" data-d="golink" data-v="${esc(t.id)}">${body}<span class="db-lch" aria-hidden="true">›</span></button></article>`;
  // editing: a form list can open with a saved view
  let viewPick = '';
  if (t.link.to === 'list') {
    const views = (store.listViews || []).filter((v) => v.formId === t.link.form).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (views.length) viewPick = `<label class="db-lview"><span class="sr">Open with view</span><select class="in" data-dv="linkview" data-v="${esc(t.id)}"><option value="">Open with: the usual list</option>${views.map((v) => `<option value="${esc(v.id)}"${v.id === t.link.view ? ' selected' : ''}>Open with: ${esc(v.name)}</option>`).join('')}</select></label>`;
  }
  return `${open}<div class="rp-wh">${grip}<div class="db-lbody">${body}</div>${i.admin ? '<span class="chip warn db-ladm">Admins only</span>' : ''}${del}</div>${viewPick}${rz}</article>`;
}

// Positions are in cells; CSS turns them into sizes from the canvas's width (dash.css).
function tileBox(t) { return `--x:${t.x};--y:${t.y};--w:${t.w};--h:${t.h}`; }
function setBox(el, t) { el.style.setProperty('--x', t.x); el.style.setProperty('--y', t.y); el.style.setProperty('--w', t.w); el.style.setProperty('--h', t.h); }

function tileHTML(c, x, t, extra, edit) {
  if (t.link) return linkTileHTML(x, t, edit);
  const label = t.text ? t.text.title || 'Text block' : reportById(t.report)?.name || 'Report';
  const grip = edit ? `<button type="button" class="db-grip" data-cv="move" data-v="${esc(t.id)}" aria-label="Move ${esc(label)}. Arrow keys move it; Shift and arrow keys resize it." title="Drag to move"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="6" r="1.8"/><circle cx="16" cy="6" r="1.8"/><circle cx="8" cy="12" r="1.8"/><circle cx="16" cy="12" r="1.8"/><circle cx="8" cy="18" r="1.8"/><circle cx="16" cy="18" r="1.8"/></svg></button>` : '';
  const del = edit ? `<button type="button" class="ibtn" data-d="tdel" data-v="${esc(t.id)}" aria-label="Remove ${esc(label)} from this dashboard">✕</button>` : '';
  const rz = edit ? `<button type="button" class="db-rz" data-cv="rz" data-v="${esc(t.id)}" aria-label="Resize ${esc(label)}, now ${t.w} columns by ${t.h} rows" title="Drag to resize"></button><span class="db-badge" hidden></span>` : '';
  const open = `<article class="rp-w db-tile${t.text ? ' db-text' : ''}" data-tile="${esc(t.id)}" style="${tileBox(t)}" aria-label="${esc(label)}">`;
  if (t.text) {
    const body = edit ? `<input class="in db-tt" data-dt="title" data-v="${esc(t.id)}" value="${esc(t.text.title || '')}" aria-label="Heading"><textarea class="in db-tb" data-dt="body" data-v="${esc(t.id)}" aria-label="Text" rows="3">${esc(t.text.body || '')}</textarea>`
      : `<h3>${esc(t.text.title || '')}</h3>${String(t.text.body || '').split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}`;
    return `${open}${edit ? `<div class="rp-wh">${grip}<div class="rp-wt"><div class="rp-cap">Text block</div></div>${del}</div>` : ''}<div class="rp-wb">${body}</div>${rz}</article>`;
  }
  const r = reportById(t.report);
  if (!r) return `${open}<div class="rp-wh">${grip}<div class="rp-wt"><p class="rp-empty">This report was deleted or isn’t shared with you.</p></div>${del}</div>${rz}</article>`;
  const def = normalizeDef(c, r.def);
  const { html, caption } = bodyHTML(c, def, extra, 't:' + x.id + ':' + t.id);
  const others = usedOn(dashesVisible(), r.id).filter((d) => d.id !== x.id);
  return `${open.replace('db-tile', 'db-tile db-t-' + def.type).replace('<article ', `<article data-k="${esc('t:' + x.id + ':' + t.id)}" `)}
    <div class="rp-wh">${grip}<div class="rp-wt"><h3>${esc(r.name)}</h3><div class="rp-cap">${esc(caption)}${others.length ? ' · also on ' + others.map((d) => esc(d.name)).join(', ') : ''}</div></div>${edit ? del : `<button type="button" class="db-link" data-d="openrep" data-v="${esc(r.id)}">Open</button>`}</div>
    <div class="rp-wb">${html}</div>${rz}</article>`;
}

function editTiles(fn) { if (!D.edit) return; const tiles = clone(D.edit.tiles || []); fn(tiles); D.edit.tiles = tiles; D.edit.dirty = true; repaint(); }

async function saveEdit() {
  const x = D.edit; if (!x) return;
  const fv = filterState(x);
  const data = { ...dashData(x), name: (x.name || '').trim().slice(0, 120) || 'Dashboard', shared: admin() ? !!x.shared : false, groups: admin() && x.shared ? x.groups || [] : [], filters: { period: fv.period, fields: clone(x.filters?.fields || []), floatUp: !!x.filters?.floatUp, grid: GRID }, updatedAt: Date.now() };
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
  return !!drag || !!(a && a.closest && (a.closest('#dbx') || a.closest('#db-dd')) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox');
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
    case 'drill': openDrill(el.dataset); break;
    case 'drillring': { const i = ringSlice(el, e); if (i >= 0) openDrill({ k: el.dataset.k, i }); break; }
    case 'ddclose': if (el.classList.contains('db-dd-scrim') && e.target !== el) return; D.drill = null; repaint(); break;
    case 'ddchip': if (D.drill) { D.drill.filters.splice(+v, 1); D.drill.shown = DD_PAGE; repaint(); } break;
    case 'ddsort': if (D.drill) { const i = +v, s0 = D.drill.sort; D.drill.sort = { i, dir: s0 && s0.i === i ? -s0.dir : 1 }; repaint(() => document.querySelector(`#db-dd [data-d="ddsort"][data-v="${i}"]`)?.focus()); } break;
    case 'ddmore': if (D.drill) { D.drill.shown += DD_PAGE; repaint(); } break;
    case 'ddcsv': drillCsv(); break;
    case 'ddrec': H.openRecord?.(v); break;
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
    case 'editdash': { const x = dashById(D.did); if (!x) return; D.edit = { id: x.id, ...dashData(x), dirty: false }; D.edit.tiles = resolveCanvas(D.edit.tiles, null, !!D.edit.filters?.floatUp); D.picker = !(x.tiles || []).length; repaint(); break; }
    case 'canceledit': D.edit = null; D.picker = false; D.fv[D.did] = null; repaint(); break;
    case 'savedash': saveEdit(); break;
    case 'deldash': {
      if (D.confirm !== 'deldash') { D.confirm = 'deldash'; repaint(); return; }
      D.confirm = null; const id = D.did;
      try { await deleteDashboard(id); if (homeId() === id) await setHomeDashboard(''); D.edit = null; toast('Dashboard deleted. Its reports are kept.'); H.go({ name: 'dashboards' }); } catch (err) { toast('Couldn’t delete the dashboard.'); }
      break;
    }
    case 'picker': D.picker = D.picker === true ? false : true; repaint(); break;
    case 'linkpicker': D.picker = D.picker === 'links' ? false : 'links'; repaint(); break;
    case 'addlink': { const l = linkFromKey(v); if (l) await addTile(D.did, null, false, l); break; }
    case 'golink': { const x = dashById(D.did); const t = (D.starter || []).find((y) => y.id === v && document.querySelector('.db-starter')) || (gridTiles(x?.tiles || [], x?.filters)).find((y) => y.id === v); const i = t && linkInfo(t.link, H.linkEnv()); if (i && i.ok) H.openLink(i.go); break; }
    case 'starterkeep': {
      const tiles = clone(D.starter || []); if (!tiles.length) return;
      const id = uid('db');
      const data = { name: 'My home', ownerId: me(), shared: false, groups: [], tiles: tiles.map((t) => ({ ...t, id: uid('t') })), filters: { period: 'all', fields: [], grid: GRID }, createdAt: Date.now(), updatedAt: Date.now() };
      try { await saveDashboard(id, data); await setHomeDashboard(id); } catch (err) { toast('Couldn’t save it. Try again.'); return; }
      toast('Saved as your home dashboard. Press Edit dashboard to change it.');
      H.go({ name: 'dashboard', dashboardId: id });
      break;
    }
    case 'setdefhome': {
      if (!admin()) return;
      const x = dashById(v);
      if (v && x && !x.shared) { toast('Share this dashboard with everyone first (Edit dashboard → Sharing), so others can see it.'); return; }
      try { await setDefaultHome(v); toast(v ? 'Home now shows this dashboard for anyone who hasn’t chosen their own' : 'No default home now'); } catch (err) { toast(err?.code === 'permission-denied' ? 'Saving was refused: deploy the latest Cadence security rules.' : 'Couldn’t save that. Try again.'); }
      break;
    }
    case 'pick': await addTile(D.did, v); break;
    case 'addtext': await addTile(D.did, null, true); break;
    case 'newrepfor': D.returnTo = D.did; if (D.edit?.dirty) await saveEdit(); D.edit = null; startNewReport(); break;
    case 'tdel': if (D.edit) { D.edit.tiles = resolveCanvas(canvasTiles(D.edit.tiles).filter((t) => t.id !== v), null, !!D.edit.filters?.floatUp); D.edit.dirty = true; repaint(); } break;
    case 'ffdel': { if (!D.edit) return; D.edit.filters = { ...(D.edit.filters || {}), fields: (D.edit.filters?.fields || []).filter((r) => refKey(r) !== v) }; D.edit.dirty = true; const fv = D.fv[D.did]; if (fv) delete fv.fields[v]; repaint(); break; }
    case 'period': { const x = D.edit && D.did ? D.edit : dashById(D.did); if (!x) return; filterState(x).period = v; if (D.edit) D.edit.dirty = true; repaint(); break; }
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.closest || !t.closest('#dbx')) return;
  const d = D.draft;
  if (t.dataset.df != null) { const x = D.edit || dashById(D.did); if (!x) return; filterState(x).fields[t.dataset.df] = t.value; repaint(); return; }
  if (t.dataset.dt) { editTiles((tiles) => { const tile = tiles.find((y) => y.id === t.dataset.v); if (tile && tile.text) tile.text[t.dataset.dt] = t.value.slice(0, t.dataset.dt === 'title' ? 120 : 2000); }); return; }
  const k = t.dataset.dv; if (!k) return;
  switch (k) {
    case 'name': if (d) { d.name = t.value.slice(0, 120); d.dirty = true; repaint(); } break;
    case 'dname': if (D.edit) { D.edit.name = t.value.slice(0, 120); D.edit.dirty = true; } break;
    case 'form': changeDef((def) => { const keep = def.type; const n = newDef(ctx(), t.value); Object.keys(def).forEach((x) => delete def[x]); Object.assign(def, n, { type: keep }); }); break;
    case 'measure': changeDef((def) => { if (t.value === 'count') def.measure = { fn: 'count' }; else { const [fn, ...rest] = t.value.split('|'); def.measure = { fn, ref: refOf(rest.join('|')) }; } }); break;
    case 'group': changeDef((def) => { def.group = refOf(t.value); }); break;
    case 'col': changeDef((def) => { def.col = refOf(t.value); }); break;
    case 'groupby': changeDef((def) => { if (def.group) def.group = { ...def.group, by: t.value }; }); break;
    case 'colby': changeDef((def) => { if (def.col) def.col = { ...def.col, by: t.value }; }); break;
    case 'time': changeDef((def) => { def.time = refOf(t.value); }); break;
    case 'span': changeDef((def) => { def.span = t.value; }); break;
    case 'limit': changeDef((def) => { def.limit = t.value === 'all' ? 'all' : +t.value; }); break;
    case 'tfrom': changeDef((def) => { if (t.value) def.from = t.value; else delete def.from; }); break;
    case 'tto': changeDef((def) => { if (t.value) def.to = t.value; else delete def.to; }); break;
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
    case 'float': if (D.edit) { D.edit.filters = { ...(D.edit.filters || { period: 'all', fields: [] }), floatUp: t.checked }; D.edit.tiles = resolveCanvas(canvasTiles(D.edit.tiles), null, t.checked); D.edit.dirty = true; repaint(); } break;
    case 'linkview': editTiles((tiles) => { const tile = tiles.find((y) => y.id === t.dataset.v); if (tile && tile.link) { if (t.value) tile.link = { ...tile.link, view: t.value }; else { const { view, ...rest } = tile.link; tile.link = rest; } } }); break;
    case 'addfilter': if (D.edit && t.value) { D.edit.filters = { ...(D.edit.filters || { period: 'all' }), fields: (D.edit.filters?.fields || []).concat(refOf(t.value)) }; D.edit.dirty = true; repaint(); } break;
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'dd-q' && D.drill) {
    D.drill.q = e.target.value; D.drill.shown = DD_PAGE;
    const at = e.target.selectionStart;
    repaint(() => { const q = document.getElementById('dd-q'); if (q) { q.focus(); try { q.setSelectionRange(at, at); } catch (err) { /* search inputs */ } } });
    return;
  }
  const t = e.target;
  if (t.id === 'db-name' && t.dataset.dv === 'name' && D.draft) { D.draft.name = t.value.slice(0, 120); if (!D.draft.dirty) { D.draft.dirty = true; const b = document.querySelector('[data-d="saverep"]'); if (b) { b.disabled = false; b.textContent = 'Save report'; } } }
});

/* ---------- dragging and resizing on the dashboard canvas ----------
   While the pointer moves, the page isn't redrawn: the dragged item follows the pointer,
   a dashed outline shows the cell it will land in, and the other items slide to where
   they would go. Letting go stores the new layout and redraws once. */
let drag = null;
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest && e.target.closest('#db-cv [data-cv]');
  if (!h || !D.edit || (e.button != null && e.button !== 0)) return;
  const cv = document.getElementById('db-cv'), el = h.closest('[data-tile]');
  if (!cv || !el) return;
  e.preventDefault();
  const tiles = canvasTiles(D.edit.tiles || []);
  const t0 = tiles.find((t) => t.id === h.dataset.v); if (!t0) return;
  drag = { id: t0.id, mode: h.dataset.cv === 'rz' ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, colW: cv.getBoundingClientRect().width / CANVAS_COLS, tiles, t0, el, cv, rect: el.getBoundingClientRect(), result: tiles, pid: e.pointerId, moved: false };
  try { h.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
  el.classList.add('dragging');
});
window.addEventListener('pointermove', (e) => {
  const d = drag; if (!d || e.pointerId !== d.pid) return;
  const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
  if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
  const t = { ...d.t0 };
  if (d.mode === 'move') {
    t.x = Math.max(0, Math.min(CANVAS_COLS - t.w, Math.round(d.t0.x + dx / d.colW)));
    t.y = Math.max(0, Math.round(d.t0.y + dy / d.colW));
    d.el.style.transform = `translate(${dx}px,${dy}px)`;
  } else {
    t.w = Math.max(MIN_W, Math.min(CANVAS_COLS - t.x, Math.round(d.t0.w + dx / d.colW)));
    t.h = Math.max(minH(t), Math.round(d.t0.h + dy / d.colW));
    d.el.style.width = Math.max(d.colW * MIN_W - 8, d.rect.width + dx) + 'px';
    d.el.style.height = Math.max(d.colW * minH(t) - 8, d.rect.height + dy) + 'px';
    const b = d.el.querySelector('.db-badge'); if (b) { b.hidden = false; b.textContent = t.w + ' × ' + t.h; }
  }
  d.result = resolveCanvas(d.tiles.map((x) => (x.id === d.id ? t : x)), d.id, !!D.edit?.filters?.floatUp);
  d.result.forEach((x) => { if (x.id === d.id) return; const el = d.cv.querySelector(`[data-tile="${CSS.escape(x.id)}"]`); if (el) setBox(el, x); });
  const g = document.getElementById('db-ghost'), mine = d.result.find((x) => x.id === d.id);
  if (g && mine) { g.hidden = false; setBox(g, mine); }
  d.cv.style.setProperty('--rows', canvasHeight(d.result) + 6);
});
function endDrag(e) {
  const d = drag; if (!d || (e && e.pointerId !== d.pid)) return;
  drag = null;
  if (D.edit && d.moved) { D.edit.tiles = d.result; D.edit.dirty = true; }
  const id = d.id, mode = d.mode;
  repaint(() => document.querySelector(`#db-cv [data-cv="${mode === 'move' ? 'move' : 'rz'}"][data-v="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

/* ---------- phones and tablets: tap a card to drill, press and hold for details ---------- */

const HOLD_MS = 450, HOLD_SLOP = 10;
let hold = null;          // { timer, x, y, tile, data, shown }
let eatClick = false;     // the click that ends a press-and-hold doesn't also drill

function phoneLayout(tile) { return !!tile && getComputedStyle(tile).position !== 'absolute'; }

/** Which part of a card a finger is on, as drill data ({ k } alone means the whole report). */
function holdTarget(e, tile) {
  const k = tile.dataset.k;
  const el = e.target.closest('[data-d="drill"], [data-d="drillring"]');
  if (el && tile.contains(el)) {
    if (el.dataset.d === 'drillring') { const i = ringSlice(el, e); return i >= 0 ? { k, i } : { k }; }
    const { i, r, c } = el.dataset;
    if (el.classList.contains('db-more')) return { k };
    return { k: el.dataset.k || k, i, r, c };
  }
  // a line or area chart: the point nearest the finger
  const pts = [...tile.querySelectorAll('.rp-pt[data-d="drill"]')];
  if (pts.length && e.target.closest('.rp-ln')) {
    let best = null, bd = Infinity;
    pts.forEach((p) => { const b = p.getBoundingClientRect(); const dx = Math.abs(b.left + b.width / 2 - e.clientX); if (dx < bd) { bd = dx; best = p; } });
    if (best) return { k, i: best.dataset.i };
  }
  return { k };
}

/** The bubble's words: what the part is, how many records, the measure and its share. */
function holdFacts(data) {
  const dd = drillPick(data);
  if (!dd) return null;
  const c = ctx(), def = dd.def, form = c.formById(def.form);
  const rows = drillRows(c, def, dd.extra, dd.filters);
  const m = def.measure || { fn: 'count' };
  const counted = m.fn === 'count' || !m.ref || !fieldOf(c, m.ref);
  const value = measureOf(c, def, rows);
  const lines = [rows.length.toLocaleString() + ' ' + nounOf(form, rows.length)];
  if (!counted) lines.push(measureLabel(c, def) + ' ' + fmtMeasure(c, def, value));
  if (dd.filters.length && !['line', 'area'].includes(def.type)) {
    const pct = shareOf(def, value, measureOf(c, def, drillRows(c, def, dd.extra, [])));
    if (pct != null) lines.push(pct + '% of the total');
  }
  return { title: dd.filters.length ? drillTitle(c, dd) : dd.name, lines };
}

function showHold(facts, x, y) {
  let b = document.getElementById('db-hold');
  if (!b) { b = document.createElement('div'); b.id = 'db-hold'; b.className = 'db-hold'; b.setAttribute('role', 'status'); document.body.appendChild(b); }
  b.innerHTML = `<b>${esc(facts.title)}</b>${facts.lines.map((t) => `<span>${esc(t)}</span>`).join('')}`;
  b.hidden = false;
  const r = b.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  const left = Math.max(8, Math.min(vw - r.width - 8, x - r.width / 2));
  const top = y - r.height - 28 >= 8 ? y - r.height - 28 : y + 28;
  b.style.left = left + 'px'; b.style.top = top + 'px';
}
function hideHold() { const b = document.getElementById('db-hold'); if (b) b.hidden = true; }
function endHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  if (hold.shown) { hideHold(); eatClick = true; setTimeout(() => { eatClick = false; }, 600); }
  hold = null;
}

document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || D.edit) return;
  const tile = e.target.closest && e.target.closest('#db-cv.can-drill .db-tile[data-k]');
  if (!tile) return;
  endHold();
  const data = holdTarget(e, tile);
  hold = { x: e.clientX, y: e.clientY, shown: false, pid: e.pointerId };
  hold.timer = setTimeout(() => {
    if (!hold) return;
    const facts = holdFacts(data);
    if (!facts) { hold = null; return; }
    hold.shown = true;
    showHold(facts, hold.x, hold.y);
    try { localStorage.setItem('fw.holdHint', '99'); } catch (err) { /* private mode */ }
    D.hintOn = false; document.querySelectorAll('.db-hint').forEach((h) => h.remove());
  }, HOLD_MS);
});
window.addEventListener('pointermove', (e) => {
  if (!hold || e.pointerId !== hold.pid || hold.shown) return;
  if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > HOLD_SLOP) { clearTimeout(hold.timer); hold = null; } // scrolling, not holding
});
window.addEventListener('pointerup', endHold);
window.addEventListener('pointercancel', endHold);
window.addEventListener('scroll', () => { if (hold && !hold.shown) { clearTimeout(hold.timer); hold = null; } }, true);
// no "copy / save image" menu or text selection on a held chart
document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('#db-cv.can-drill .db-tile[data-k]') && (hold || eatClick)) e.preventDefault(); });
// the click that ends a hold is swallowed; a tap on a card's empty space drills into all its records (phones)
document.addEventListener('click', (e) => {
  if (eatClick && e.target.closest && e.target.closest('#db-cv')) { eatClick = false; e.preventDefault(); e.stopImmediatePropagation(); return; }
  if (D.edit) return;
  const tile = e.target.closest && e.target.closest('#db-cv.can-drill .db-tile[data-k]');
  if (!tile || !phoneLayout(tile)) return;
  if (e.target.closest('button, a, input, select, textarea, [data-d]')) return;
  openDrill({ k: tile.dataset.k });
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && D.drill && document.getElementById('db-dd')) { D.drill = null; repaint(); return; }
  const h = e.target.closest && e.target.closest('#db-cv [data-cv="move"]');
  if (!h || !D.edit || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const tiles = canvasTiles(D.edit.tiles || []);
  const t = tiles.find((x) => x.id === h.dataset.v); if (!t) return;
  const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
  const n = e.shiftKey ? { ...t, w: Math.max(MIN_W, Math.min(CANVAS_COLS - t.x, t.w + dx)), h: Math.max(minH(t), t.h + dy) } : { ...t, x: Math.max(0, Math.min(CANVAS_COLS - t.w, t.x + dx)), y: Math.max(0, t.y + dy) };
  D.edit.tiles = resolveCanvas(tiles.map((x) => (x.id === t.id ? n : x)), t.id, !!D.edit.filters?.floatUp);
  D.edit.dirty = true;
  const id = t.id;
  repaint(() => document.querySelector(`#db-cv [data-cv="move"][data-v="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
});
