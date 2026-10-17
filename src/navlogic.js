// The sidebar's form search. The sidebar lists no forms; typing in "Search forms" pops up
// the matching ones. Child and sub-forms are left out unless they're switched on for the
// sidebar in the form designer, so the Sidebar switch decides what a search can find.

/** Is this form a child or sub-form of another form? */
export function isChildForm(forms, id) {
  return (forms || []).some((p) => p.id !== id && (p.children || []).some((c) => c.formId === id));
}

/** Forms a search can find: ones you can see that aren't children, plus children switched on for the sidebar. */
export function searchableForms(forms, canView) {
  return (forms || []).filter((f) => canView(f) && (f.showInSidebar || !isChildForm(forms, f.id)));
}

/**
 * Matches for what's typed: the name contains it (any case). Earlier matches first, then the
 * forms' own order. Each result carries where the match is, for underlining: { form, at, len }.
 */
export function searchForms(forms, q, canView) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return [];
  return searchableForms(forms, canView)
    .map((form, i) => ({ form, at: String(form.name || '').toLowerCase().indexOf(t), len: t.length, i }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at || (a.form.order ?? 0) - (b.form.order ?? 0) || a.i - b.i)
    .map(({ form, at, len }) => ({ form, at, len }));
}

/** Every form the sidebar search offers before anything is typed, in the forms' own order. */
export function allSearchable(forms, canView) {
  return searchableForms(forms, canView)
    .map((form, i) => ({ form, i }))
    .sort((a, b) => (a.form.order ?? 0) - (b.form.order ?? 0) || a.i - b.i)
    .map(({ form }) => ({ form, at: 0, len: 0 }));
}

/** The form designer's search: every form (children too) whose name contains what's typed, any case. */
export function designerMatch(form, q) {
  const t = String(q || '').trim().toLowerCase();
  return !t || String((form && form.name) || '').toLowerCase().includes(t);
}

/** Recently opened forms, newest first, without repeats. */
export function pushRecent(list, id, max = 8) {
  return [id, ...(list || []).filter((x) => x !== id)].slice(0, max);
}

/**
 * The sidebar's Forms list: up to n forms — the ones you opened recently, topped up with the rest
 * in their own order — shown in the forms' own order so the list doesn't jump around.
 */
export function sidebarFormList(forms, canView, recentIds, n = 6) {
  const can = searchableForms(forms, canView);
  const ord = (a, b) => (a.order ?? 0) - (b.order ?? 0) || can.indexOf(a) - can.indexOf(b);
  const byId = new Map(can.map((f) => [f.id, f]));
  const pick = (recentIds || []).map((id) => byId.get(id)).filter(Boolean).slice(0, n);
  for (const f of [...can].sort(ord)) { if (pick.length >= n) break; if (!pick.includes(f)) pick.push(f); }
  return pick.sort(ord);
}
