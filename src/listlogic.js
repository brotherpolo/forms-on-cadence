// Records list: columns, saved views, filters, sorting and CSV. Pure functions (no DOM,
// no Firestore) so they can be tested in Node. lists.js draws the screen.
//
// A list "config" is { cols, sort, filters, density }:
//   cols     column keys in order (the record title is always first and isn't listed)
//              f:<fieldId>                 a field of this form
//              parent                      the record it belongs to
//              p:<parentFormId>:<fieldId>  a field of that parent record
//              kids:<childFormId>          how many child records of that form it has
//              sys:updated | sys:created | sys:by
//   sort     { key, dir: 'asc' | 'desc' }  key is 'title' or a column key
//   filters  { <fieldId>: [option, …] }    choice fields only; a record matches any ticked option
//   density  'cozy' | 'compact'

import { titleFieldOf } from './reportlogic.js';

export const NOCOL = new Set(['heading', 'signature']);
export const NUMERIC = new Set(['number', 'decimal', 'currency', 'percent', 'range', 'rating']);
export const FILTERABLE = new Set(['select', 'radio', 'multiselect', 'checkbox']);
export const SETTABLE = new Set(['select', 'radio', 'checkbox']);
export const DEFAULT_PREFIX = 'dflt-';
export const MAX_COLS = 30;
const SUMMABLE = new Set(['number', 'decimal', 'currency']);
const DENSITIES = new Set(['cozy', 'compact']);

export const defaultViewId = (formId) => DEFAULT_PREFIX + formId;
export const isDefaultViewId = (id) => typeof id === 'string' && id.startsWith(DEFAULT_PREFIX);

const fieldsOf = (form) => (form?.fields || []).filter((f) => f.type !== 'heading');
const fieldIn = (form, id) => (form?.fields || []).find((f) => f.id === id) || null;
const isNumField = (f) => !!f && (NUMERIC.has(f.type) || (f.type === 'formula' && f.format !== 'text'));

/** The options a choice field offers for filtering or setting. */
export function optionsOf(f) {
  if (!f) return [];
  if (f.type === 'checkbox') return ['Yes', 'No'];
  return (f.options || []).map((o) => String(o)).filter((o) => o !== '');
}

/**
 * Every column this form's list can show, grouped for the column picker.
 * ctx: { form, titleField, parents: [form], children: [form] }
 */
export function columnCatalog(ctx) {
  const { form, titleField } = ctx;
  const out = [];
  const own = form.name || 'This form';
  fieldsOf(form)
    .filter((f) => !NOCOL.has(f.type) && f.id !== titleField?.id)
    .forEach((f) => out.push({ key: 'f:' + f.id, label: f.label || 'Untitled field', group: own + ' fields', src: f.type === 'formula' ? 'Calculation' : 'Field', num: isNumField(f), field: f, sum: SUMMABLE.has(f.type) || (f.type === 'formula' && ['number', 'decimal', 'currency'].includes(f.format)) }));
  const parents = ctx.parents || [];
  if (parents.length) {
    out.push({ key: 'parent', label: 'Belongs to', group: 'Parent record', src: 'Parent', num: false });
    parents.forEach((pf) =>
      fieldsOf(pf)
        .filter((f) => !NOCOL.has(f.type))
        .forEach((f) => out.push({ key: `p:${pf.id}:${f.id}`, label: `${pf.name} › ${f.label || 'Untitled field'}`, group: 'From ' + pf.name, src: pf.name, num: isNumField(f), field: f, form: pf }))
    );
  }
  (ctx.children || []).forEach((cf) => out.push({ key: 'kids:' + cf.id, label: cf.name, group: 'Counts', src: 'Count', num: true, sum: true, form: cf }));
  out.push({ key: 'sys:updated', label: 'Last updated', group: 'Record info', src: 'Record', num: false, sys: true });
  out.push({ key: 'sys:created', label: 'Created', group: 'Record info', src: 'Record', num: false, sys: true });
  out.push({ key: 'sys:by', label: 'Created by', group: 'Record info', src: 'Record', num: false, sys: true });
  out.push({ key: 'sys:owner', label: 'Owner', group: 'Record info', src: 'Record', num: false, sys: true });
  return out;
}

/** The list a form shows before anyone saves a view: its "Show as list column" fields. */
export function defaultConfig(ctx) {
  const { form, titleField } = ctx;
  const cols = [];
  if ((ctx.parents || []).length) cols.push('parent');
  fieldsOf(form)
    .filter((f) => f.inList && !NOCOL.has(f.type) && f.id !== titleField?.id)
    .slice(0, 5)
    .forEach((f) => cols.push('f:' + f.id));
  return { cols, sort: { key: 'sys:updated', dir: 'desc' }, filters: {}, density: 'cozy' };
}

/** A config with anything that no longer exists on the form taken out. */
export function cleanConfig(cfg, catalog, form) {
  const keys = new Set(catalog.map((c) => c.key));
  const seen = new Set();
  const cols = (Array.isArray(cfg?.cols) ? cfg.cols : []).filter((k) => typeof k === 'string' && keys.has(k) && !seen.has(k) && seen.add(k)).slice(0, MAX_COLS);
  const sk = cfg?.sort?.key;
  const sort = sk === 'title' || keys.has(sk) ? { key: sk, dir: cfg.sort.dir === 'asc' ? 'asc' : 'desc' } : { key: 'sys:updated', dir: 'desc' };
  const filters = {};
  Object.entries(cfg?.filters || {}).forEach(([fid, vals]) => {
    const f = fieldIn(form, fid);
    if (!f || !FILTERABLE.has(f.type) || !Array.isArray(vals)) return;
    const opts = new Set(optionsOf(f));
    const keep = vals.filter((v) => opts.has(v));
    if (keep.length) filters[fid] = keep;
  });
  return { cols, sort, filters, density: DENSITIES.has(cfg?.density) ? cfg.density : 'cozy' };
}

export function sameConfig(a, b) {
  const norm = (c) => JSON.stringify({ cols: c.cols, sort: c.sort, filters: Object.keys(c.filters).sort().map((k) => [k, [...c.filters[k]].sort()]), density: c.density });
  return norm(a) === norm(b);
}

export function filterCount(cfg) {
  return Object.values(cfg.filters || {}).reduce((n, v) => n + (v.length ? 1 : 0), 0);
}

/* ---------- values ---------- */

const shortDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

/** A "Link to record" value sorts by the linked record's title value. */
function relSort(f, v, h) {
  if (!f || f.type !== 'relation' || !v || !h.recById) return undefined;
  const t = h.recById(v);
  return t ? titleSortOf(t, h.formById ? h.formById(t.formId) : null, h) : null;
}

export function sortValueOf(f, v, text) {
  if (v == null || v === '') return null;
  if (f && (NUMERIC.has(f.type) || f.type === 'formula') && typeof v === 'number') return v;
  if (f && f.type === 'checkbox') return v ? 1 : 0;
  if (f && (f.type === 'date' || f.type === 'datetime' || f.type === 'time')) return String(v);
  return text ? text.toLowerCase() : null;
}

/**
 * A record's title as a sort key: its title field's real value, so a date title sorts by
 * calendar and a number title by size, not by the text shown. Blank titles sort last.
 * h: { valOf, fmt, recTitle }
 */
export function titleSortOf(rec, form, h, depth = 0) {
  if (!rec || !form || depth > 4) return null;
  const tf = titleFieldOf(form);
  if (tf) {
    const v = h.valOf(tf, rec, form);
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null;
    if (tf.type === 'relation') { const t = h.recById?.(v); return titleSortOf(t, t && h.formById?.(t.formId), h, depth + 1); }
    const k = sortValueOf(tf, v, h.fmt(tf, v));
    if (k != null) return k;
  }
  const t = h.recTitle(rec, form);
  return t ? t.toLowerCase() : null;
}

/**
 * One cell: { text, sort, num, field }.
 * h: { form, recById, valOf(f, rec, form), fmt(f, v), recTitle(rec, form), kids(recId, formId), nameOf(uid) }
 */
/** Long text shows on one line in a list (the full text is on the record). */
const oneLine = (f, t) => (f.type === 'textarea' ? String(t ?? '').replace(/\s*\n\s*/g, ' ').trim() : t);

export function cellOf(key, rec, h) {
  if (key === 'title') {
    const t = h.recTitle(rec, h.form);
    return { text: t, sort: titleSortOf(rec, h.form, h), num: false };
  }
  if (key === 'parent') {
    const p = rec.parentId ? h.recById(rec.parentId) : null;
    const t = p ? h.recTitle(p) : '';
    return { text: t, sort: p ? titleSortOf(p, h.formById ? h.formById(p.formId) : null, h) : null, num: false };
  }
  if (key.startsWith('f:')) {
    const f = fieldIn(h.form, key.slice(2));
    if (!f) return { text: '', sort: null, num: false };
    const v = h.valOf(f, rec, h.form);
    const text = oneLine(f, h.fmt(f, v));
    return { text, sort: relSort(f, v, h) ?? sortValueOf(f, v, text), num: isNumField(f), field: f, value: v, long: f.type === 'textarea' };
  }
  if (key.startsWith('p:')) {
    const [, pfId, fid] = key.split(':');
    const p = rec.parentId ? h.recById(rec.parentId) : null;
    if (!p || p.formId !== pfId) return { text: '', sort: null, num: false };
    const pf = h.formById ? h.formById(pfId) : null;
    const f = fieldIn(pf, fid);
    if (!f) return { text: '', sort: null, num: false };
    const v = h.valOf(f, p, pf);
    const text = oneLine(f, h.fmt(f, v));
    return { text, sort: relSort(f, v, h) ?? sortValueOf(f, v, text), num: isNumField(f), field: f, value: v, long: f.type === 'textarea' };
  }
  if (key.startsWith('kids:')) {
    const n = h.kids(rec.id, key.slice(5));
    return { text: String(n), sort: n, num: true, value: n };
  }
  if (key === 'sys:updated') return { text: shortDate(rec.updatedAt), sort: rec.updatedAt || null, num: false };
  if (key === 'sys:created') return { text: shortDate(rec.createdAt), sort: rec.createdAt || null, num: false };
  if (key === 'sys:owner') {
    const t = rec.ownerId ? h.nameOf(rec.ownerId) : '';
    return { text: t, sort: t ? t.toLowerCase() : null, num: false };
  }
  if (key === 'sys:by') {
    const t = rec.createdBy ? h.nameOf(rec.createdBy) : '';
    return { text: t, sort: t ? t.toLowerCase() : null, num: false };
  }
  return { text: '', sort: null, num: false };
}

/** Records that match every filtered field (any ticked option within a field). */
export function filterRecords(recs, filters, form) {
  const active = Object.entries(filters || {}).filter(([, v]) => v && v.length);
  if (!active.length) return recs;
  const fs = active.map(([fid, vals]) => [fieldIn(form, fid), new Set(vals)]).filter(([f]) => f);
  return recs.filter((r) =>
    fs.every(([f, set]) => {
      const v = r.values?.[f.id];
      if (f.type === 'checkbox') return set.has(v ? 'Yes' : 'No');
      if (f.type === 'multiselect') return Array.isArray(v) && v.some((x) => set.has(String(x)));
      return v != null && set.has(String(v));
    })
  );
}

/** Rows whose title or any shown column contains the search text. rows: [{rec, title, cells}] */
export function searchRows(rows, q) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => (r.title + ' ' + r.cells.map((c) => c.text).join(' ')).toLowerCase().includes(q));
}

/** Sort rows by a key. Empty values always go last. rows: [{sortVal}] */
export function sortRows(rows, dir) {
  const d = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const x = a.sortVal, y = b.sortVal;
    const xe = x == null || x === '', ye = y == null || y === '';
    if (xe || ye) return xe === ye ? 0 : xe ? 1 : -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * d;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * d;
  });
}

/** The direction a column sorts in when first clicked. */
export function firstDir(col) {
  return col && (col.num || col.key === 'sys:updated' || col.key === 'sys:created') ? 'desc' : 'asc';
}

/** Total of a summable column across rows, or null. */
export function columnTotal(col, rows, idx) {
  if (!col?.sum) return null;
  let s = 0, n = 0;
  rows.forEach((r) => { const v = r.cells[idx]?.value; if (typeof v === 'number' && isFinite(v)) { s += v; n++; } });
  return n ? s : null;
}

/* ---------- views ---------- */

/** The saved fields of a view document, as a config. */
export function configOfDoc(d) {
  return { cols: d.cols || [], sort: d.sort || { key: 'sys:updated', dir: 'desc' }, filters: d.filters || {}, density: d.density || 'cozy' };
}

/**
 * The tabs for one form: the form's default ("All …") first, then shared views, then
 * this person's own. Each: { id, name, builtin, shared, ownerId, cfg, doc }.
 */
export function viewsFor(form, docs, uid, baseCfg) {
  const mine = [], shared = [];
  let dflt = null;
  (docs || []).forEach((d) => {
    if (d.formId !== form.id) return;
    if (d.id === defaultViewId(form.id)) { if (d.shared) dflt = d; return; }
    if (d.shared) shared.push(d);
    else if (d.ownerId === uid) mine.push(d);
  });
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const tab = (d) => ({ id: d.id, name: d.name, builtin: false, shared: !!d.shared, ownerId: d.ownerId, cfg: configOfDoc(d), doc: d });
  return [
    { id: defaultViewId(form.id), name: 'All ' + String(form.name || 'records').toLowerCase(), builtin: true, shared: true, ownerId: dflt?.ownerId || null, cfg: dflt ? configOfDoc(dflt) : baseCfg, doc: dflt },
    ...shared.sort(byName).map(tab),
    ...mine.sort(byName).map(tab),
  ];
}

/** Who may overwrite a view: shared ones and the default are admins'; your own are yours. */
export function canSaveView(v, uid, admin) {
  if (!v) return false;
  if (v.builtin || v.shared) return !!admin;
  return v.ownerId === uid;
}
export function canDeleteView(v, uid, admin) {
  if (!v) return false;
  if (v.builtin) return !!admin && !!v.doc; // "Reset" back to the form's list columns
  return v.ownerId === uid || !!admin;
}

/** A view document ready for Firestore. */
export function viewDoc({ formId, name, ownerId, shared, cfg, createdAt, now }) {
  return {
    formId,
    name: String(name || '').trim().slice(0, 80) || 'Untitled view',
    ownerId,
    shared: !!shared,
    cols: cfg.cols.slice(0, MAX_COLS),
    sort: { key: cfg.sort.key, dir: cfg.sort.dir },
    filters: JSON.parse(JSON.stringify(cfg.filters || {})),
    density: cfg.density,
    createdAt: createdAt || now,
    updatedAt: now,
  };
}

/* ---------- export ---------- */

export function toCsv(headers, rows) {
  const q = (s) => {
    s = String(s ?? '');
    if (/^[=@\t\r]/.test(s) || /^[+-](?![\d.])/.test(s)) s = "'" + s; // keep spreadsheets from running it as a formula
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}
