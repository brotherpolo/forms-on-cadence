// Report builder screens: the Reports list and one report's canvas.
// Drag fields onto the canvas (or tap them) to make widgets; drag widgets to move them and
// their corner to resize. Owners' changes save automatically; shared reports are view-only
// for everyone else. All numbers are worked out here, in the viewer's browser, from the
// records the viewer is allowed to see (store.records already holds only those).
import './reports.css';
import { store, saveReport, deleteReport } from './store.js';
import { canViewForm, isAdmin } from './access.js';
import { esc, uid, clone, toast, badge } from './ui.js';
import {
  reportFields, fieldOf, kindOf, glyphOf, chainOf, valueOf, timeOf, textOf, rowsOf, measureOf, groupsOf, bucketsOf,
  niceStep, autoTitle, refLabel, joinedForms, filterValues, widgetFor, dropField, changeType, layout, settle,
  resize, snapCols, widthName, heightName, move, WIDTHS, MAX_ROWS,
} from './reportlogic.js';

let H = { fmt: null, valOf: null, recTitle: null, go: null }; // helpers from app.js

const R = {
  id: null, draft: null, sel: null, tab: 'fields', open: {}, dirty: false, rev: 0, saving: false,
  saveT: null, status: '', confirm: false, drag: null, rs: null,
};

export function initReports(helpers) { H = { ...H, ...helpers }; }

/* ---------- data access ---------- */

let ctxCache = null;
function ctx() {
  const forms = store.forms.filter((f) => canViewForm(store.me, f.id));
  if (ctxCache && ctxCache.recordsRef === store.records && ctxCache.formsRef === store.forms && ctxCache.me === store.me) return ctxCache.c;
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
  ctxCache = { recordsRef: store.records, formsRef: store.forms, me: store.me, c };
  return c;
}

const mine = (rep) => !!rep && rep.ownerId === store.user?.uid;
const canEdit = () => mine(R.draft);
const nameOf = (uid_) => store.profiles[uid_]?.displayName || (uid_ === store.user?.uid ? 'you' : 'someone');
const when = (t) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

/** Keep the open report in R.draft; follow the saved copy unless there are unsaved edits. */
function ensureDraft(id) {
  const src = store.reports.find((r) => r.id === id);
  if (R.id !== id) {
    R.id = id; R.draft = src ? clone(src) : null; R.sel = null; R.tab = 'fields';
    R.dirty = false; R.confirm = false; R.status = '';
  } else if (src && !R.dirty && !R.saving && (!R.draft || src.updatedAt !== R.draft.updatedAt)) {
    R.draft = clone(src);
  }
  if (R.draft && !Array.isArray(R.draft.widgets)) R.draft.widgets = [];
  return R.draft;
}

/* ---------- saving ---------- */

function change(fn, { repaint = true } = {}) {
  if (!R.draft || !canEdit()) return;
  fn(R.draft);
  R.dirty = true; R.rev++;
  setStatus('Unsaved changes');
  if (repaint) paint();
  clearTimeout(R.saveT);
  R.saveT = setTimeout(save, 700);
}
async function save() {
  clearTimeout(R.saveT);
  if (!R.draft || !R.dirty || !canEdit()) return;
  const rev = R.rev, draft = clone(R.draft);
  R.saving = true; setStatus('Saving…');
  try {
    await saveReport(draft);
    if (R.rev === rev) { R.dirty = false; setStatus('Saved'); }
  } catch (e) {
    console.error('[formwright] report save', e);
    setStatus('Not saved. Check your connection.');
    toast('Couldn’t save the report. It will try again when you make another change.');
  }
  R.saving = false;
}
function setStatus(t) { R.status = t; const el = document.getElementById('rp-status'); if (el) el.textContent = t; }

/** Called when leaving a report: save anything pending straight away. */
export function leaveReport() { if (R.dirty) save(); }
/** True while dragging or resizing, so live data doesn't redraw the page under the pointer. */
export function reportBusy() {
  const a = document.activeElement;
  const typing = a && a.closest && a.closest('#rp') && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox';
  return !!(R.drag || R.rs || typing);
}

/* ---------- the Reports list ---------- */

export function viewReportsList() {
  const me = store.user?.uid;
  const own = store.reports.filter((r) => r.ownerId === me);
  const shared = store.reports.filter((r) => r.ownerId !== me);
  const card = (r) => `<button class="card" data-r="open" data-v="${esc(r.id)}"><b>${esc(r.name || 'Untitled report')}</b><div class="meta"><span>${(r.widgets || []).length} widget${(r.widgets || []).length === 1 ? '' : 's'}</span>${r.ownerId === me ? '' : `<span>Shared by ${esc(nameOf(r.ownerId))}</span>`}${r.ownerId === me && r.shared ? '<span>Shared with everyone</span>' : ''}<span>Edited ${esc(when(r.updatedAt))}</span></div></button>`;
  return `
  <div class="head"><div class="ttl"><div><h1>Reports</h1><p class="sub">Charts and tables built from your forms. Everyone sees numbers from the records they're allowed to see.</p></div></div>
    <button class="btn primary" data-r="new">+ New report</button></div>
  <section class="section"><div class="section-h"><h2>Your reports <span class="count">${own.length}</span></h2></div>
    <div class="panel">${own.length ? `<div class="cards" style="display:flex">${own.map(card).join('')}</div>` : `<p class="note">You haven't made a report yet. Press <b>New report</b>, then drag fields onto the canvas.</p>`}</div></section>
  ${shared.length ? `<section class="section"><div class="section-h"><h2>Shared with you <span class="count">${shared.length}</span></h2></div><div class="panel"><div class="cards" style="display:flex">${shared.map(card).join('')}</div></div></section>` : ''}`;
}

export function reportName(id) { const r = (R.id === id && R.draft) || store.reports.find((x) => x.id === id); return r ? r.name || 'Untitled report' : 'Report'; }

/* ---------- one report ---------- */

export function viewReport(id) {
  const d = ensureDraft(id);
  if (!d) return `<div class="panel empty"><h2>That report isn't available</h2><p>It may have been deleted, or it hasn't been shared with you.</p><button class="btn" data-r="list">Back to reports</button></div>`;
  return `<div id="rp" class="rp${canEdit() ? ' can-edit' : ''}">${inner()}</div>`;
}

function paint() {
  const el = document.getElementById('rp');
  if (!el) return;
  const y = window.scrollY;
  const side = el.querySelector('.rp-side .rp-scroll');
  const sy = side ? side.scrollTop : 0;
  el.className = 'rp' + (canEdit() ? ' can-edit' : '');
  el.innerHTML = inner();
  const side2 = el.querySelector('.rp-side .rp-scroll');
  if (side2) side2.scrollTop = sy;
  window.scrollTo(0, y);
}

function inner() {
  const d = R.draft, c = ctx(), edit = canEdit();
  if (R.sel && !d.widgets.some((w) => w.id === R.sel)) R.sel = null;
  const L = layout(d.widgets, R.rs ? R.rs.id : null);
  const empty = !d.widgets.length;
  const top = `
  <div class="crumbs"><button data-r="list">Reports</button><span>›</span></div>
  <div class="rp-top">
    ${edit ? `<label class="sr" for="rp-name">Report name</label><input id="rp-name" class="in rp-name" value="${esc(d.name || '')}" maxlength="120" placeholder="Report name">`
           : `<h1 class="rp-h1">${esc(d.name || 'Untitled report')}</h1>`}
    ${edit ? `<span class="rp-status" id="rp-status" role="status">${esc(R.status)}</span>` : ''}
    <span class="grow"></span>
    ${edit ? `<label class="switch"><input type="checkbox" data-r="share"${d.shared ? ' checked' : ''}><span class="tr"></span><span>Share with everyone</span></label>` : ''}
    <button class="btn sm" data-r="copy">Make a copy</button>
    ${edit || isAdmin(store.me) ? `<button class="btn sm danger${R.confirm ? ' armed' : ''}" data-r="delete">${R.confirm ? 'Tap again to delete' : 'Delete'}</button>` : ''}
  </div>
  ${edit ? '' : `<p class="help rp-viewnote">Shared by ${esc(nameOf(d.ownerId))}. The numbers come from the records you can see. Make a copy to change it.</p>`}`;
  const widgets = d.widgets.map((w) => widgetHTML(c, w, L[w.id], edit)).join('');
  const newZone = edit ? `<div class="rp-new${empty ? ' big' : ''}" data-rnew style="grid-column:1 / -1;grid-row:${L._rows + 1} / span ${empty ? 2 : 1}"><div><b>${empty ? 'Start your report' : 'New widget'}</b>${empty ? 'Drag a field here from the panel, or tap a field. Numbers become totals, choices become bar charts, dates become charts over time.' : 'Drop a field here to start another widget, or drop a widget here to move it to the end.'}</div></div>` : '';
  const canvas = `<div class="rp-canvas"><div class="rp-grid">${widgets}${newZone}</div>${!edit && empty ? '<div class="panel empty"><p>This report has no widgets yet.</p></div>' : ''}</div>`;
  return top + `<div class="rp-body">${canvas}${edit ? sideHTML(c) : ''}</div>`;
}

/* ---------- widgets ---------- */

function fmtMeasure(c, w, v) {
  const m = w.measure || { fn: 'count' };
  if (v == null || (typeof v === 'number' && isNaN(v))) return '–';
  const f = m.fn !== 'count' && m.ref ? fieldOf(c, m.ref) : null;
  if (!f) return Math.round(v).toLocaleString();
  if (f.type === 'rating') return (Math.round(v * 10) / 10).toLocaleString() + ' ★';
  const val = m.fn === 'avg' ? Math.round(v * 100) / 100 : v;
  const money = f.type === 'currency' || (f.type === 'formula' && f.format === 'currency');
  if (money) {
    // whole dollars for totals and bars; cents only for small amounts
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(f.currency || 'USD').toUpperCase(), maximumFractionDigits: Math.abs(val) >= 100 ? 0 : 2 }).format(val); } catch (e) { return String(val); }
  }
  if (f.type === 'number') return Number(val).toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (f.type === 'range') return (Math.round(val * 10) / 10) + (f.suffix || '');
  const t = textOf(c, f, val);
  return t || String(val);
}
function fmtShort(c, w, v) {
  const m = w.measure || {};
  const f = m.fn !== 'count' && m.ref ? fieldOf(c, m.ref) : null;
  const cur = f && (f.type === 'currency' || (f.type === 'formula' && f.format === 'currency')) ? '$' : '';
  const a = Math.abs(v);
  if (a >= 1e6) return cur + (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return cur + (v / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return cur + (Math.round(v * 10) / 10).toLocaleString();
}

function captionOf(c, w, n) {
  const form = c.formById(w.form);
  const parts = [n + ' ' + (n === 1 ? (form?.itemName || form?.name || 'record').toLowerCase().replace(/s$/, '') : (form?.name || 'records').toLowerCase())];
  if (w.filter) parts.push(refLabel(c, w.filter.ref, w.form) + (w.filter.op === 'not' ? ' is not ' : ' is ') + w.filter.value);
  const j = joinedForms(w).map((id) => c.formById(id)?.name).filter(Boolean);
  if (j.length) parts.push('with ' + j.join(', '));
  return parts.join(' · ');
}

function widgetHTML(c, w, pos, edit) {
  const form = c.formById(w.form);
  const title = w.title || autoTitle(c, w);
  const cls = 'rp-w h' + pos.h + (R.sel === w.id ? ' sel' : '') + (R.rs && R.rs.id === w.id ? ' resizing' : '');
  const style = `grid-column:${pos.c0 + 1} / span ${pos.c};grid-row:${pos.r0 + 1} / span ${pos.h}`;
  let body, caption = '';
  if (!form) {
    body = `<p class="rp-empty">You don't have access to the form this widget uses.</p>`;
  } else {
    const list = rowsOf(c, w);
    caption = captionOf(c, w, list.length);
    body = bodyHTML(c, w, list);
  }
  return `<article class="${cls}" data-rwidget="${esc(w.id)}"${edit ? ' draggable="true"' : ''} style="${style}" aria-label="${esc(title)}">
    <div class="rp-wh">${edit ? '<span class="rp-grip" aria-hidden="true" title="Drag to move">⋮⋮</span>' : ''}<div class="rp-wt"><h3>${esc(title)}</h3><div class="rp-cap">${esc(caption)}</div></div></div>
    ${edit ? `<button type="button" class="rp-rz" data-rz="${esc(w.id)}" aria-label="${esc('Resize ' + title + ', now ' + widthName(pos.c).toLowerCase() + ' and ' + heightName(pos.h).toLowerCase())}" title="Drag to resize, or use the arrow keys"></button>` : ''}
    <div class="rp-badge" data-rbadge="${esc(w.id)}"${R.rs && R.rs.id === w.id ? '' : ' hidden'}>${esc(widthName(pos.c) + ' · ' + heightName(pos.h))}</div>
    <div class="rp-wb">${body}</div></article>`;
}

function bodyHTML(c, w, list) {
  if (w.type === 'kpi') {
    const v = measureOf(c, w, list);
    const m = w.measure || { fn: 'count' };
    const sub = m.fn === 'count' || !m.ref ? 'records' : (m.fn === 'avg' ? 'average across ' : 'total across ') + list.length + ' ' + (c.formById(w.form)?.name || '').toLowerCase();
    return `<div class="rp-kpi">${esc(fmtMeasure(c, w, v))}</div><div class="rp-kpisub">${esc(sub)}</div>`;
  }
  if (!list.length) return `<p class="rp-empty">No records match this widget yet.</p>`;
  if (w.type === 'bar') {
    if (!fieldOf(c, w.group)) return `<p class="rp-empty">Choose what to group by in the widget's settings.</p>`;
    const items = groupsOf(c, w, list);
    const max = Math.max(0, ...items.map((x) => x.value)) || 1;
    return `<div class="rp-bars" role="list">${items.map((x) => {
      const t = fmtMeasure(c, w, x.value);
      return `<div class="rp-bar" role="listitem" title="${esc(x.key + ': ' + t)}"><span class="rp-bl">${esc(x.key)}</span><span class="rp-bt"><span class="rp-bf" style="width:${Math.max(0.5, (x.value / max) * 100).toFixed(1)}%"></span></span><span class="rp-bv">${esc(t)}</span></div>`;
    }).join('')}</div>`;
  }
  if (w.type === 'line') {
    if (!fieldOf(c, w.time)) return `<p class="rp-empty">Choose a date field in the widget's settings.</p>`;
    const weeks = (w.interval || 'week') === 'week';
    const b = bucketsOf(c, w, list, Date.now());
    const n = b.length;
    const step = niceStep(Math.max(0, ...b.map((x) => x.value)) / 4);
    const top = step * 4;
    const X = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);
    const Y = (v) => (v / top) * 100;
    const path = b.map((x, i) => (i ? 'L' : 'M') + X(i).toFixed(2) + ' ' + (100 - Y(x.value)).toFixed(2)).join(' ');
    const label = (x) => x.date.toLocaleDateString(undefined, weeks ? { month: 'short', day: 'numeric' } : { month: 'short' });
    const every = weeks ? 5 : 2;
    return `<div class="rp-ln"><div class="rp-plot">
      ${[0, 1, 2, 3, 4].map((k) => `<div class="rp-gl" style="bottom:${k * 25}%"><span>${esc(fmtShort(c, w, step * k))}</span></div>`).join('')}
      <svg class="rp-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="rp-area" d="${path} L100 100 L0 100 Z"></path><path class="rp-path" d="${path}"></path></svg>
      ${b.map((x, i) => { const tip = (weeks ? 'Week of ' : '') + label(x) + ' · ' + fmtMeasure(c, w, x.value); return `<button type="button" class="rp-pt" style="left:${X(i).toFixed(2)}%;bottom:${Y(x.value).toFixed(2)}%" aria-label="${esc(tip)}"><i></i><span class="rp-tip">${esc(tip)}</span></button>`; }).join('')}
    </div><div class="rp-xax">${b.map((x, i) => ((n - 1 - i) % every === 0 ? `<span style="left:${X(i).toFixed(2)}%">${esc(label(x))}</span>` : '')).join('')}</div></div>`;
  }
  if (w.type === 'table') {
    const cols = (w.columns || []).filter((r) => fieldOf(c, r));
    if (!cols.length) return `<p class="rp-empty">Drag fields onto this table to add columns.</p>`;
    const sort = w.sort && cols[w.sort.i] ? w.sort : { i: 0, dir: 1 };
    const sref = cols[sort.i];
    const sf = fieldOf(c, sref);
    const key = (r) => { const v = valueOf(c, r, sref); if (['date', 'datetime'].includes(sf.type) || sref.id === '_created' || sref.id === '_updated') return timeOf(v); if (typeof v === 'number') return v; const t = textOf(c, sf, v); return t ? t.toLowerCase() : null; };
    const sorted = list.slice().sort((a, b) => { const x = key(a), y = key(b); if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
    const isNum = (f) => kindOf(f) === 'num';
    const tcols = cols.map((_, i) => (i === 0 ? 'minmax(140px,1.6fr)' : 'minmax(100px,1fr)')).join(' ');
    const head = cols.map((r, i) => { const f = fieldOf(c, r); return `<div class="rp-td${isNum(f) ? ' num' : ''}" role="columnheader"><button type="button" data-r="tsort" data-w="${esc(w.id)}" data-v="${i}">${esc(refLabel(c, r, w.form))}${sort.i === i ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></div>`; }).join('');
    const shown = sorted.slice(0, 50);
    const rows = shown.map((rec) => `<div class="rp-tr" role="row" style="grid-template-columns:${tcols}" data-r="openrec" data-v="${esc(rec.id)}">${cols.map((r) => { const f = fieldOf(c, r); let v = valueOf(c, rec, r); let t = f.type === 'relation' ? (c.recById(v) ? c.recTitle(c.recById(v)) : '') : textOf(c, f, v); return `<div class="rp-td${isNum(f) ? ' num' : ''}" role="cell" title="${esc(t)}">${esc(t || '–')}</div>`; }).join('')}</div>`).join('');
    return `<div class="rp-table" role="table"><div class="rp-tr rp-th" role="row" style="grid-template-columns:${tcols}">${head}</div>${rows}</div>${sorted.length > shown.length ? `<p class="rp-more">Showing the first ${shown.length} of ${sorted.length}.</p>` : ''}`;
  }
  return '';
}

/* ---------- side panel ---------- */

function sideHTML(c) {
  const w = R.draft.widgets.find((x) => x.id === R.sel);
  const tab = w ? R.tab : 'fields';
  return `<aside class="panel rp-side" aria-label="Report tools">
    <div class="tabs rp-tabs" role="tablist">
      <button class="tab${tab === 'fields' ? ' on' : ''}" role="tab" aria-selected="${tab === 'fields'}" data-r="tab" data-v="fields">Fields</button>
      <button class="tab${tab === 'widget' ? ' on' : ''}" role="tab" aria-selected="${tab === 'widget'}" data-r="tab" data-v="widget"${w ? '' : ' disabled'}>Widget</button>
    </div>
    <div class="rp-scroll">${tab === 'widget' && w ? settingsHTML(c, w) : fieldsHTML(c, w)}</div></aside>`;
}

function fieldsHTML(c, w) {
  if (!c.forms.length) return `<p class="help">No forms are shared with you yet, so there's nothing to report on.</p>`;
  const hint = w
    ? `<div class="rp-target"><span>Tapping a field changes <b>${esc(w.title || autoTitle(c, w))}</b>.</span><button type="button" class="btn sm" data-r="deselect">Start a new widget</button></div>`
    : '<p class="help rp-hint">Drag a field onto the canvas, or tap it to start a widget.</p>';
  return hint + c.forms.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)).map((f, i) => {
    const open = R.open[f.id] ?? i < 3;
    const parents = chainOf(c, f.id).slice(1).map((id) => c.formById(id)?.name).filter(Boolean);
    return `<section class="rp-form"><button type="button" class="rp-formh" data-r="toggle" data-v="${esc(f.id)}" aria-expanded="${open}"><span class="rp-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>${badge(f)}<span class="t">${esc(f.name)}</span><span class="count">${c.records.filter((r) => r.formId === f.id).length}</span></button>
      ${open ? `<div class="rp-chips">${reportFields(f).map((fl) => `<button type="button" class="rp-chip${fl.system ? ' sys' : ''}" draggable="true" data-rfield="${esc(f.id + '|' + fl.id)}" title="${esc(fl.label + ' (' + f.name + ')')}"><span class="rp-gl" aria-hidden="true">${esc(glyphOf(fl))}</span>${esc(fl.label)}</button>`).join('')}</div>
      ${parents.length ? `<p class="rp-via">Linked to ${esc(parents.join(', '))}: their fields work on ${esc(f.name.toLowerCase())} widgets too.</p>` : ''}` : ''}</section>`;
  }).join('');
}

function opt(label, on, act, v, extra = '') {
  return `<button type="button" class="rp-opt${on ? ' on' : ''}" aria-pressed="${!!on}" data-r="${act}" data-v="${esc(v)}"${extra}>${esc(label)}</button>`;
}

function settingsHTML(c, w) {
  const fields = [];
  chainOf(c, w.form).forEach((fid) => { const form = c.formById(fid); if (form) reportFields(form).forEach((f) => fields.push({ key: fid + '|' + f.id, ref: { form: fid, id: f.id }, f, kind: kindOf(f, form) })); });
  const lab = (x) => refLabel(c, x.ref, w.form);
  const same = (a, b) => a && b && a.form === b.form && a.id === b.id;
  const m = w.measure || { fn: 'count' };
  const form = c.formById(w.form);
  const j = joinedForms(w).map((id) => c.formById(id)?.name).filter(Boolean);
  let h = `<p class="help">Based on <b>${esc(form?.name || '?')}</b>${j.length ? ', joined to ' + esc(j.join(' and ')) : ''}</p>
    <label class="rp-lab" for="rp-wtitle">Title</label>
    <input id="rp-wtitle" class="in" data-r="wtitle" value="${esc(w.title || '')}" placeholder="${esc(autoTitle(c, w))}" maxlength="120">
    <p class="rp-lab">Show as</p><div class="rp-opts">${[['kpi', 'Number'], ['bar', 'Bar chart'], ['line', 'Over time'], ['table', 'Table']].map(([t, l]) => opt(l, w.type === t, 'type', t)).join('')}</div>`;
  if (w.type !== 'table') {
    h += `<p class="rp-lab">Value</p><div class="rp-opts">${opt('Count of ' + (form?.name || 'records').toLowerCase(), m.fn === 'count' || !m.ref, 'measure', '')}${fields.filter((x) => x.kind === 'num').map((x) => opt(lab(x), m.fn !== 'count' && same(m.ref, x.ref), 'measure', x.key)).join('')}</div>`;
    if (m.fn !== 'count' && m.ref) h += `<div class="rp-opts" style="margin-top:6px">${opt('Total', m.fn === 'sum', 'agg', 'sum')}${opt('Average', m.fn === 'avg', 'agg', 'avg')}</div>`;
  }
  if (w.type === 'bar') h += `<p class="rp-lab">Group by</p><div class="rp-opts">${fields.filter((x) => x.kind === 'group' || x.kind === 'key').map((x) => opt(lab(x), same(w.group, x.ref), 'group', x.key)).join('')}</div>`;
  if (w.type === 'line') {
    h += `<p class="rp-lab">Over time, by</p><div class="rp-opts">${fields.filter((x) => x.kind === 'date').map((x) => opt(lab(x), same(w.time, x.ref), 'time', x.key)).join('')}</div>
      <div class="rp-opts" style="margin-top:6px">${opt('Week', (w.interval || 'week') === 'week', 'interval', 'week')}${opt('Month', w.interval === 'month', 'interval', 'month')}</div>`;
  }
  if (w.type === 'table') {
    h += `<p class="rp-lab">Columns</p>${(w.columns || []).map((r, i) => `<div class="rp-colrow"><span>${esc(refLabel(c, r, w.form))}</span><button type="button" class="rp-x" data-r="delcol" data-v="${i}" aria-label="${esc('Remove column ' + refLabel(c, r, w.form))}">✕</button></div>`).join('')}
      <p class="help" style="margin-top:4px">Drag fields onto the table, or tap them in Fields, to add columns.</p>`;
  }
  h += `<p class="rp-lab">Filter</p>`;
  if (w.filter && fieldOf(c, w.filter.ref)) {
    const f = fieldOf(c, w.filter.ref);
    h += `<div class="rp-colrow"><span><b>${esc(refLabel(c, w.filter.ref, w.form))}</b></span><button type="button" class="rp-x" data-r="nofilter" aria-label="Remove filter">✕</button></div>
      <div class="rp-opts">${opt('is', w.filter.op !== 'not', 'fop', 'is')}${opt('is not', w.filter.op === 'not', 'fop', 'not')}</div>
      <div class="rp-opts" style="margin-top:6px">${filterValues(f).map((v) => opt(v, w.filter.value === v, 'fval', v)).join('')}</div>`;
  } else {
    const fl = fields.filter((x) => ['select', 'radio', 'multiselect', 'checkbox'].includes(x.f.type));
    h += fl.length ? `<div class="rp-opts">${fl.map((x) => `<button type="button" class="rp-opt" data-r="filter" data-v="${esc(x.key)}">+ ${esc(lab(x))}</button>`).join('')}</div>` : `<p class="help">Add a choice or yes/no field to a form to filter by it.</p>`;
  }
  const L = layout(R.draft.widgets, null)[w.id];
  h += `<p class="rp-lab">Width</p><div class="rp-opts">${WIDTHS.map((n) => opt(widthName(n), L.c === n, 'width', n)).join('')}</div>
    <p class="rp-lab">Height</p><div class="rp-opts">${[1, 2, 3, 4].map((n) => opt(heightName(n), L.h === n, 'height', n)).join('')}</div>
    <p class="help" style="margin-top:6px">Widgets in a row share its height, and each row fills the width.</p>
    <div class="rp-acts2"><button type="button" class="btn sm" data-r="dup">Duplicate</button><button type="button" class="btn sm danger" data-r="delw">Remove widget</button></div>`;
  return h;
}

/* ---------- actions ---------- */

const refOf = (key) => { const [form, id] = String(key).split('|'); return form && id ? { form, id } : null; };
const selW = () => R.draft?.widgets.find((w) => w.id === R.sel);
function updW(id, fn) { change((d) => { const i = d.widgets.findIndex((w) => w.id === id); if (i >= 0) { const w = clone(d.widgets[i]); fn(w); d.widgets[i] = w; } }); }

function addField(ref) {
  const c = ctx(), w = selW();
  if (w) return dropOn(w.id, ref);
  const nw = widgetFor(c, ref, uid('w'));
  change((d) => { d.widgets.push(nw); });
  R.sel = nw.id; R.tab = 'widget'; paint();
  toast('Added a widget from ' + (fieldOf(c, ref)?.label || 'that field').toLowerCase() + '.');
}
function dropOn(wid, ref) {
  const c = ctx();
  const w = R.draft.widgets.find((x) => x.id === wid);
  if (!w) return;
  const res = dropField(c, w, ref);
  if (!res.widget) { toast(res.message); return; }
  change((d) => { const i = d.widgets.findIndex((x) => x.id === wid); d.widgets[i] = res.widget; });
  R.sel = wid; paint();
  toast(res.message);
}
function setSize(id, cols, rows) {
  change((d) => { d.widgets = settle(resize(d.widgets, id, cols, rows), id); });
}

async function newReport() {
  const id = uid('r');
  const draft = { id, name: 'Untitled report', ownerId: store.user.uid, shared: false, widgets: [], createdAt: Date.now(), updatedAt: Date.now() };
  R.id = id; R.draft = draft; R.sel = null; R.tab = 'fields'; R.dirty = true; R.rev++; R.status = '';
  H.go({ name: 'report', reportId: id });
  await save();
  setTimeout(() => document.getElementById('rp-name')?.select(), 30);
}
async function copyReport() {
  const id = uid('r'), src = clone(R.draft);
  const draft = { id, name: (src.name || 'Report') + ' (copy)', ownerId: store.user.uid, shared: false, widgets: src.widgets || [], createdAt: Date.now(), updatedAt: Date.now() };
  if (R.dirty) await save();
  R.id = id; R.draft = draft; R.sel = null; R.tab = 'fields'; R.dirty = true; R.rev++; R.status = '';
  H.go({ name: 'report', reportId: id });
  await save();
  toast('Copied. This copy is yours to change.');
}
async function removeReport() {
  if (!R.confirm) { R.confirm = true; paint(); setTimeout(() => { if (R.confirm) { R.confirm = false; paint(); } }, 4000); return; }
  const id = R.id;
  R.confirm = false; R.dirty = false; clearTimeout(R.saveT);
  try { await deleteReport(id); toast('Report deleted'); R.id = null; R.draft = null; H.go({ name: 'reports' }); }
  catch (e) { toast('Couldn’t delete the report. Try again.'); }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-r]');
  if (!el) {
    const card = e.target.closest('#rp [data-rwidget]');
    if (card && canEdit() && !e.target.closest('.rp-pt')) { const id = card.dataset.rwidget; if (R.sel !== id) { R.sel = id; R.tab = 'widget'; paint(); } }
    return;
  }
  const a = el.dataset.r, v = el.dataset.v;
  const w = selW();
  switch (a) {
    case 'new': newReport(); break;
    case 'list': H.go({ name: 'reports' }); break;
    case 'open': H.go({ name: 'report', reportId: v }); break;
    case 'copy': copyReport(); break;
    case 'delete': removeReport(); break;
    case 'share': break; // handled on change
    case 'tab': if (v === 'fields' || w) { R.tab = v; paint(); } break;
    case 'deselect': R.sel = null; R.tab = 'fields'; paint(); break;
    case 'toggle': R.open[v] = !(R.open[v] ?? ctx().forms.findIndex((f) => f.id === v) < 3); paint(); break;
    case 'tsort': { e.stopPropagation(); const i = +v; if (canEdit()) updW(el.dataset.w, (x) => { const s = x.sort || { i: 0, dir: 1 }; x.sort = { i, dir: s.i === i ? -s.dir : 1 }; }); else { const x = R.draft.widgets.find((q) => q.id === el.dataset.w); if (x) { const s = x.sort || { i: 0, dir: 1 }; x.sort = { i, dir: s.i === i ? -s.dir : 1 }; paint(); } } break; }
    case 'openrec': if (!e.target.closest('button')) H.openRecord?.(v); break;
    case 'type': if (w) change((d) => { const i = d.widgets.findIndex((x) => x.id === w.id); d.widgets[i] = changeType(ctx(), w, v); }); break;
    case 'measure': if (w) updW(w.id, (x) => { const ref = refOf(v); x.measure = ref ? { fn: x.measure && x.measure.fn !== 'count' ? x.measure.fn : 'sum', ref } : { fn: 'count' }; }); break;
    case 'agg': if (w) updW(w.id, (x) => { x.measure.fn = v; }); break;
    case 'group': if (w) updW(w.id, (x) => { x.group = refOf(v); }); break;
    case 'time': if (w) updW(w.id, (x) => { x.time = refOf(v); }); break;
    case 'interval': if (w) updW(w.id, (x) => { x.interval = v; }); break;
    case 'delcol': if (w) updW(w.id, (x) => { x.columns = (x.columns || []).filter((_, i) => i !== +v); x.sort = null; }); break;
    case 'filter': if (w) { const ref = refOf(v), f = fieldOf(ctx(), ref); updW(w.id, (x) => { x.filter = { ref, op: 'is', value: filterValues(f)[0] || '' }; }); } break;
    case 'nofilter': if (w) updW(w.id, (x) => { delete x.filter; }); break;
    case 'fop': if (w) updW(w.id, (x) => { x.filter.op = v; }); break;
    case 'fval': if (w) updW(w.id, (x) => { x.filter.value = v; }); break;
    case 'width': if (w) { const L = layout(R.draft.widgets)[w.id]; setSize(w.id, +v, L.h); } break;
    case 'height': if (w) { const L = layout(R.draft.widgets)[w.id]; setSize(w.id, L.c, +v); } break;
    case 'dup': if (w) { const cpy = { ...clone(w), id: uid('w') }; change((d) => { const i = d.widgets.findIndex((x) => x.id === w.id); d.widgets.splice(i + 1, 0, cpy); }); R.sel = cpy.id; paint(); } break;
    case 'delw': if (w) { change((d) => { d.widgets = d.widgets.filter((x) => x.id !== w.id); }); R.sel = null; R.tab = 'fields'; paint(); } break;
  }
});

document.addEventListener('click', (e) => {
  const chip = e.target.closest('#rp [data-rfield]');
  if (chip && canEdit()) { const ref = refOf(chip.dataset.rfield); if (ref) addField(ref); }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!t.closest || !t.closest('#rp') || !canEdit()) return;
  if (t.id === 'rp-name') change((d) => { d.name = t.value.trim().slice(0, 120) || 'Untitled report'; }, { repaint: false });
  else if (t.dataset.r === 'share') change((d) => { d.shared = t.checked; }, { repaint: false });
  else if (t.dataset.r === 'wtitle') { const w = selW(); if (w) updW(w.id, (x) => { x.title = t.value.trim() || null; }); }
});

/* ---------- drag and drop ---------- */

function clearOver() { document.querySelectorAll('#rp .over').forEach((x) => x.classList.remove('over')); }

document.addEventListener('dragstart', (e) => {
  if (!canEdit() || !e.target.closest) return;
  const chip = e.target.closest('#rp [data-rfield]');
  const card = e.target.closest('#rp [data-rwidget]');
  if (R.rs) { e.preventDefault(); return; }
  if (chip) R.drag = { kind: 'field', ref: refOf(chip.dataset.rfield) };
  else if (card) R.drag = { kind: 'widget', id: card.dataset.rwidget };
  else return;
  try { e.dataTransfer.setData('text/plain', R.drag.kind); e.dataTransfer.effectAllowed = 'copyMove'; } catch (err) { /* older browsers */ }
});
document.addEventListener('dragover', (e) => {
  if (!R.drag) return;
  const t = e.target.closest && e.target.closest('#rp [data-rwidget], #rp [data-rnew]');
  if (!t) return;
  e.preventDefault();
  if (!t.classList.contains('over')) { clearOver(); t.classList.add('over'); }
});
document.addEventListener('drop', (e) => {
  if (!R.drag) return;
  const t = e.target.closest && e.target.closest('#rp [data-rwidget], #rp [data-rnew]');
  const d = R.drag; R.drag = null; clearOver();
  if (!t) return;
  e.preventDefault();
  if (t.dataset.rnew !== undefined) {
    if (d.kind === 'field') addNewWidget(d.ref);
    else change((dr) => { dr.widgets = move(dr.widgets, d.id, null); });
  } else {
    const id = t.dataset.rwidget;
    if (d.kind === 'field') dropOn(id, d.ref);
    else change((dr) => { dr.widgets = move(dr.widgets, d.id, id); });
  }
});
document.addEventListener('dragend', () => { if (R.drag) { R.drag = null; clearOver(); } });

function addNewWidget(ref) {
  const c = ctx();
  const nw = widgetFor(c, ref, uid('w'));
  change((d) => { d.widgets.push(nw); });
  R.sel = nw.id; R.tab = 'widget'; paint();
  toast('Added a widget from ' + (fieldOf(c, ref)?.label || 'that field').toLowerCase() + '.');
}

/* ---------- resizing (the corner handle) ---------- */

/** Move every widget to its place for the current sizes without rebuilding the page,
    so the handle under the pointer stays put while resizing. */
function placeAll() {
  const L = layout(R.draft.widgets, R.rs ? R.rs.id : null);
  document.querySelectorAll('#rp [data-rwidget]').forEach((el) => {
    const p = L[el.dataset.rwidget]; if (!p) return;
    el.style.gridColumn = `${p.c0 + 1} / span ${p.c}`;
    el.style.gridRow = `${p.r0 + 1} / span ${p.h}`;
    el.className = el.className.replace(/\bh\d\b/, 'h' + p.h);
    const b = el.querySelector('[data-rbadge]'); if (b) b.textContent = widthName(p.c) + ' · ' + heightName(p.h);
  });
  const nz = document.querySelector('#rp [data-rnew]');
  if (nz) nz.style.gridRow = `${L._rows + 1} / span ${R.draft.widgets.length ? 1 : 2}`;
}

document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest && e.target.closest('#rp [data-rz]');
  if (!h || !canEdit() || e.button > 0) return;
  e.preventDefault(); e.stopPropagation();
  const card = h.closest('[data-rwidget]'), grid = h.closest('.rp-grid');
  const g = grid.getBoundingClientRect(), cr = card.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 14;
  const rowH = parseFloat(getComputedStyle(grid).gridAutoRows) || 150;
  R.rs = { id: card.dataset.rwidget, x: e.clientX, y: e.clientY, w: cr.width, h: cr.height, gap, colW: (g.width - 11 * gap) / 12, rowH };
  R.sel = R.rs.id;
  card.classList.add('resizing', 'sel');
  const b = card.querySelector('[data-rbadge]'); if (b) b.hidden = false;
});
window.addEventListener('pointermove', (e) => {
  const r = R.rs;
  if (!r) return;
  const cols = snapCols(Math.round((r.w + (e.clientX - r.x) + r.gap) / (r.colW + r.gap)));
  const rows = Math.min(MAX_ROWS, Math.max(1, Math.round((r.h + (e.clientY - r.y) + r.gap) / (r.rowH + r.gap))));
  const w = R.draft.widgets.find((x) => x.id === r.id);
  if (!w || (w.cols === cols && w.rows === rows)) return;
  R.draft.widgets = resize(R.draft.widgets, r.id, cols, rows);
  placeAll();
});
function endResize() {
  const r = R.rs;
  if (!r) return;
  R.rs = null;
  change((d) => { d.widgets = settle(d.widgets, r.id); });
  R.tab = 'widget'; paint();
}
window.addEventListener('pointerup', endResize);
window.addEventListener('pointercancel', endResize);

document.addEventListener('keydown', (e) => {
  const h = e.target.closest && e.target.closest('#rp [data-rz]');
  if (!h || !canEdit()) return;
  const id = h.dataset.rz;
  const L = layout(R.draft.widgets)[id];
  if (!L) return;
  const i = WIDTHS.indexOf(snapCols(L.c));
  let c = L.c, hh = L.h;
  if (e.key === 'ArrowRight') c = WIDTHS[Math.min(WIDTHS.length - 1, i + 1)];
  else if (e.key === 'ArrowLeft') c = WIDTHS[Math.max(0, i - 1)];
  else if (e.key === 'ArrowDown') hh = Math.min(MAX_ROWS, L.h + 1);
  else if (e.key === 'ArrowUp') hh = Math.max(1, L.h - 1);
  else return;
  e.preventDefault();
  R.sel = id;
  setSize(id, c, hh);
  document.querySelector(`#rp [data-rz="${CSS.escape(id)}"]`)?.focus();
});
