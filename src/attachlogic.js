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
 * recById, text(rec) for searching, q }.
 * Returns [{ rec, from }] newest first; `from` is the other parent a record would move from.
 */
export function attachCandidates(opts) {
  const { records, childFormId, parentId = null, exclude = new Set(), others = false, canEdit = () => true, recById, text = () => '', q = '' } = opts;
  const words = lc(q).split(/\s+/).filter(Boolean);
  const out = [];
  for (const rec of records) {
    if (rec.formId !== childFormId || exclude.has(rec.id) || rec.id === parentId || !canEdit(rec)) continue;
    const p = parentOf(rec, recById);
    const from = p && p.id !== parentId ? p : null;
    if (from && !others) continue;
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
