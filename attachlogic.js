// Attaching existing records to a parent, and detaching them. Pure functions; attach.js
// draws the windows and app.js / lists.js save the changes.

const lc = (s) => String(s || '').trim().toLowerCase();
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

/** The parent a record is on, or null when it has none (or its parent was deleted). */
export function parentOf(rec, recById) {
  if (!rec?.parentId) return null;
  return recById(rec.parentId) || null;
}

/**
 * Records of the child form that can be attached to one parent.
 * opts: { records, childFormId, parentId (null for a parent not saved yet), exclude: Set of ids
 * already shown under the parent, others: include records on another parent, canEdit(rec),
 * recById, text(rec) for searching, q, keep(rec): any other filter }.
 * Returns [{ rec, from }] newest first; `from` is the other parent a record would move from.
 */
export function attachCandidates(opts) {
  const { records, childFormId, parentId = null, exclude = new Set(), others = false, canEdit = () => true, recById, text = () => '', q = '', keep = () => true } = opts;
  const words = lc(q).split(/\s+/).filter(Boolean);
  const out = [];
  for (const rec of records) {
    if (rec.formId !== childFormId || exclude.has(rec.id) || rec.id === parentId || !canEdit(rec)) continue;
    const p = parentOf(rec, recById);
    const from = p && p.id !== parentId ? p : null;
    if (from && !others) continue;
    if (!keep(rec)) continue;
    if (words.length) { const t = lc(text(rec)); if (!words.every((w) => t.includes(w))) continue; }
    out.push({ rec, from });
  }
  return out.sort((a, b) => (b.rec.createdAt || 0) - (a.rec.createdAt || 0));
}

/** Child fields that match a parent field by label and type (what "Copy matching fields" fills). */
export function matchingFields(parentForm, childForm) {
  const out = [];
  (childForm?.fields || []).forEach((f) => {
    if (f.type === 'formula' || f.type === 'heading') return;
    const m = (parentForm?.fields || []).find((p) => p.type === f.type && lc(p.label) === lc(f.label));
    if (m) out.push([f.id, m.id]);
  });
  return out;
}

/** Values to fill on a child from its parent: matching fields that are empty on the child only. */
export function copyPatch(parentForm, childForm, parentValues, childValues) {
  const patch = {};
  matchingFields(parentForm, childForm).forEach(([cid, pid]) => {
    const pv = parentValues?.[pid];
    if (!empty(pv) && empty(childValues?.[cid])) patch[cid] = structuredClone(pv);
  });
  return patch;
}

/**
 * "Link to record" fields on the child that point at the parent's form: on attach they point
 * at the new parent when empty or still pointing at the old one; on detach (newId null) the
 * ones pointing at the parent being left are cleared.
 */
export function linkPatch(childForm, parentFormId, newId, oldId, childValues) {
  const patch = {};
  (childForm?.fields || []).forEach((f) => {
    if (f.type !== 'relation' || f.relForm !== parentFormId) return;
    const v = childValues?.[f.id];
    if (newId) { if (empty(v) || (oldId && v === oldId)) { if (v !== newId) patch[f.id] = newId; } }
    else if (oldId && v === oldId) patch[f.id] = null;
  });
  return patch;
}

/** The change attaching one record makes: { id, parentId, parentFormId, set } (set = field values). */
export function attachChange(rec, parent, parentForm, childForm, copy) {
  const set = { ...(copy ? copyPatch(parentForm, childForm, parent.values, rec.values) : {}), ...linkPatch(childForm, parentForm.id, parent.id, rec.parentId || null, rec.values) };
  return { id: rec.id, parentId: parent.id, parentFormId: parentForm.id, set };
}

/** The change detaching one record makes. */
export function detachChange(rec, childForm, parentFormId = rec.parentFormId) {
  return { id: rec.id, parentId: null, parentFormId: null, set: linkPatch(childForm, parentFormId, null, rec.parentId, rec.values) };
}

/** "2 move from other invoices: INV-1, INV-4" style summary of where picked records come from. */
export function movesFrom(picked, titleOf) {
  const names = [];
  let n = 0;
  picked.forEach((x) => { if (x.from) { n++; const t = titleOf(x.from); if (!names.includes(t)) names.push(t); } });
  return { n, names };
}

/* ---------- suggested matches and filters ---------- */

// Fields whose values can tie a child to its parent ("Invoice #" on both).
const KEYABLE = new Set(['text', 'email', 'phone', 'url', 'number', 'decimal', 'currency', 'percent', 'select', 'radio', 'date', 'datetime', 'time', 'formula']);
const KEY_RANK = { text: 0, email: 0, phone: 0, url: 0, number: 0, decimal: 0, currency: 0, percent: 0, formula: 0, date: 1, datetime: 1, time: 1, select: 2, radio: 2 };

/** A value as a comparable key: numbers and text compare as trimmed, lower-case text (1 and "1" match). */
export function keyOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? String(v) : null;
  if (typeof v === 'string') { const t = v.trim().toLowerCase(); return t || null; }
  return null;
}

/** Child and parent fields with the same name that can carry a matching value. */
export function namePairs(parentForm, childForm) {
  const out = [];
  (childForm?.fields || []).forEach((c) => {
    if (!KEYABLE.has(c.type)) return;
    const p = (parentForm?.fields || []).find((x) => KEYABLE.has(x.type) && lc(x.label) === lc(c.label));
    if (p) out.push({ c, p });
  });
  return out;
}

function pairOrder(a, b, titleId) {
  const t = (x) => (x.p.id === titleId ? 0 : 1);
  return t(a) - t(b) || (KEY_RANK[a.p.type] ?? 3) - (KEY_RANK[b.p.type] ?? 3);
}

/**
 * The suggested filter for attaching to one parent: a same-named field whose value on the
 * parent picks out some child records. The parent's title field wins, then text and numbers
 * before dates, then choice fields, then the narrowest match.
 * opts: { parentForm, childForm, parentValues, records (child records to look through), valOf(f, rec), titleField }
 * Returns { c, p, key, n } or null.
 */
export function suggestMatch({ parentForm, childForm, parentValues, records, valOf, titleField }) {
  const found = [];
  namePairs(parentForm, childForm).forEach((pair) => {
    const key = keyOf(parentValues?.[pair.p.id]);
    if (key == null) return;
    const n = records.filter((r) => keyOf(valOf(pair.c, r)) === key).length;
    if (n) found.push({ ...pair, key, n });
  });
  found.sort((a, b) => pairOrder(a, b, titleField?.id) || a.n - b.n);
  return found[0] || null;
}

/**
 * The suggested parent for records ticked in a list: for the best same-named field, the
 * parent record whose value matches the most of them.
 * opts: { childForm, parentForms, recs, parentsOf(formId) → records, valOf(f, rec), titleFieldOf(form) }
 * Returns { parent, form, c, p, n, total } or null.
 */
export function suggestParent({ childForm, parentForms, recs, parentsOf, valOf, titleFieldOf }) {
  let best = null;
  for (const pf of parentForms) {
    const tf = titleFieldOf(pf);
    const pairs = namePairs(pf, childForm).sort((a, b) => pairOrder(a, b, tf?.id));
    for (const pair of pairs) {
      const byKey = new Map();
      parentsOf(pf.id).forEach((pr) => { const k = keyOf(valOf(pair.p, pr)); if (k != null && !byKey.has(k)) byKey.set(k, pr); });
      const counts = new Map();
      recs.forEach((r) => { const pr = byKey.get(keyOf(valOf(pair.c, r))); if (pr) counts.set(pr, (counts.get(pr) || 0) + 1); });
      let top = null;
      counts.forEach((n, pr) => { if (!top || n > top.n) top = { parent: pr, form: pf, c: pair.c, p: pair.p, n, total: recs.length }; });
      if (top) { if (!best || top.n > best.n) best = top; break; } // this form's best field decides
    }
  }
  return best;
}

/** Fields a person can filter the attach list by. */
const NOFILTER = new Set(['heading', 'file', 'image', 'signature', 'textarea', 'location', 'color']);
export function filterFields(form) { return (form?.fields || []).filter((f) => !NOFILTER.has(f.type)); }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * The filter values one record has for a field: [{ label, sort }]. Dates go by month
 * ("Sep 2026"), multiple choice gives each choice, empty is "(blank)".
 */
export function filterValuesOf(f, v, fmt) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return [{ label: '(blank)', sort: '￿' }];
  if (f.type === 'checkbox') return [{ label: v ? 'Yes' : 'No', sort: v ? 0 : 1 }];
  if (Array.isArray(v)) return v.map((x) => ({ label: String(x), sort: String(x).toLowerCase() }));
  if ((f.type === 'date' || f.type === 'datetime') && typeof v === 'string' && /^\d{4}-\d{2}/.test(v)) {
    const y = v.slice(0, 4), m = +v.slice(5, 7);
    return [{ label: (MONTHS[m - 1] || '') + ' ' + y, sort: v.slice(0, 7) }];
  }
  let label;
  try { label = fmt ? String(fmt(f, v) ?? '') : String(v); } catch (e) { label = String(v); }
  return [{ label: label || String(v), sort: typeof v === 'number' ? v : label.toLowerCase() }];
}

/** Does a record pass a filter chip? A suggested chip matches its key exactly; others any ticked value. */
export function chipHit(chip, f, v, fmt) {
  if (chip.key != null) return keyOf(v) === chip.key;
  return filterValuesOf(f, v, fmt).some((x) => chip.labels.includes(x.label));
}

/** Natural order for filter values: numbers by size, text with numbers inside sensibly, blank last. */
export function valueOrder(a, b) {
  if (typeof a.sort === 'number' && typeof b.sort === 'number') return a.sort - b.sort;
  return String(a.sort).localeCompare(String(b.sort), undefined, { numeric: true, sensitivity: 'base' });
}

/** Every word of the search appears somewhere in the text. */
export function searchHit(text, q) {
  const words = lc(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const t = lc(text);
  return words.every((w) => t.includes(w));
}
