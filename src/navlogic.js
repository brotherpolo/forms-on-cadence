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
