// Folding sections on a record page: Section Heading fields, sub-form grids and child
// sections. What's folded is remembered per user and per form (not per record), so folding
// Notes on one invoice folds it on every invoice. Pure functions; app.js keeps the state.
//   folds: { <formId>: { <key>: 1 } }   keys: 'h:<headingFieldId>' | 'g:<childFormId>' | 'c:<childFormId>'

/** Which heading each field sits under: { fieldId: headingId | null }. */
export function headingOf(fields) {
  const m = {};
  let h = null;
  for (const f of fields || []) {
    if (f.type === 'heading') { h = f.id; continue; }
    m[f.id] = h;
  }
  return m;
}

/** Saved folds, or {} when there are none or they can't be read. */
export function readFolds(raw) {
  try {
    const o = JSON.parse(raw || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (e) { return {}; }
}

export function isFolded(folds, formId, key) { return !!(folds && folds[formId] && folds[formId][key]); }

/** A copy with one section folded (on) or opened (off). Opened sections leave no trace. */
export function setFold(folds, formId, key, on) { return setFolds(folds, formId, [key], on); }

export function setFolds(folds, formId, keys, on) {
  const out = { ...(folds || {}) };
  const mine = { ...(out[formId] || {}) };
  keys.forEach((k) => { if (on) mine[k] = 1; else delete mine[k]; });
  if (Object.keys(mine).length) out[formId] = mine; else delete out[formId];
  return out;
}

/** Every foldable section on a record of this form. */
export function foldKeys(form, gridFormIds, childFormIds) {
  return [
    ...(form?.fields || []).filter((f) => f.type === 'heading').map((f) => 'h:' + f.id),
    ...gridFormIds.map((id) => 'g:' + id),
    ...childFormIds.map((id) => 'c:' + id),
  ];
}
