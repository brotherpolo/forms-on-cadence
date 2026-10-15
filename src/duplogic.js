// Duplicate a record: which values carry over to the copy. Pure functions: no DOM, no Firebase.

// Never copied: a new number is given on save; a signature belongs to one record; calculations
// are worked out again.
export const NOT_COPIED = new Set(['autonumber', 'signature', 'formula', 'heading']);

/**
 * The values a copy starts with. The title (when it's typed text) gets " (copy)" added, so the
 * copy is easy to tell apart until it's renamed.
 */
export function copyValues(form, values, { titleId = null, suffix = ' (copy)' } = {}) {
  const out = {};
  (form?.fields || []).forEach((f) => {
    if (NOT_COPIED.has(f.type)) return;
    const v = values?.[f.id];
    if (v === undefined || v === null || v === '') return;
    out[f.id] = JSON.parse(JSON.stringify(v));
  });
  const tf = (form?.fields || []).find((f) => f.id === titleId);
  if (suffix && tf && tf.type === 'text' && typeof out[tf.id] === 'string' && out[tf.id].trim() && !out[tf.id].endsWith(suffix.trim())) out[tf.id] += suffix;
  return out;
}

/** A copied grid row's "Link to record" fields that pointed at the original record are cleared (they'll point at the copy once it's saved). */
export function relinkRow(rowForm, values, parentFormId, originalId) {
  const out = { ...values };
  (rowForm?.fields || []).forEach((f) => {
    if (f.type === 'relation' && f.relForm === parentFormId && out[f.id] === originalId) delete out[f.id];
  });
  return out;
}
