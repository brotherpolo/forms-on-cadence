// The order of the sections under a record's fields: sub-form grids, child forms and Tasks.
// Saved on the form as sectionOrder: [childFormId | 'tasks', ...]. A key names the child
// form, not how it's shown, so switching a child between grid and separate records keeps
// its place. Fields always come first (for now); a later layout can add positions without
// changing what's stored here.

export const TASKS = 'tasks';

/** The default order: grids, then Tasks, then separate child forms (how records looked before). */
export function defaultSections(form) {
  const kids = form?.children || [];
  return [...kids.filter((c) => c.display === 'grid').map((c) => c.formId), TASKS, ...kids.filter((c) => c.display !== 'grid').map((c) => c.formId)];
}

/** The order to show: the saved order for what still exists, then anything new in its default place. */
export function sectionOrder(form) {
  const avail = defaultSections(form);
  const saved = (Array.isArray(form?.sectionOrder) ? form.sectionOrder : []).filter((k, i, a) => avail.includes(k) && a.indexOf(k) === i);
  const out = saved.slice();
  avail.forEach((k, i) => {
    if (out.includes(k)) return;
    // put a newcomer after the nearest earlier default neighbour that is already placed
    let at = out.length;
    for (let j = i - 1; j >= 0; j--) { const p = out.indexOf(avail[j]); if (p >= 0) { at = p + 1; break; } }
    if (!saved.length) at = out.length;
    out.splice(at, 0, k);
  });
  return out;
}

/** Move one section up (-1) or down (+1); returns the new order. */
export function moveSection(order, key, dir) {
  const out = order.slice();
  const i = out.indexOf(key), j = i + dir;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
