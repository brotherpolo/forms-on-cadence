// Dashboard shortcut tiles: small tiles that open part of Formwright (a form's list, a new
// record, My work, Reports, or an administration screen). Pure functions, unit-tested.
//
// tile.link = { to: 'list', form, view? }   a form's records list (optionally a saved view)
//           | { to: 'new', form }            a new record
//           | { to: 'page', page }           a screen: see PAGES

export const PAGES = [
  { key: 'home', title: 'Home', glyph: '⌂', desc: 'Your home dashboard.' },
  { key: 'mywork', title: 'My work', glyph: '☰', desc: 'Records waiting on you in a workflow.', needs: 'workflow' },
  { key: 'dashboards', title: 'Dashboards', glyph: '▦', desc: 'Every dashboard you can see.' },
  { key: 'reports', title: 'Reports', glyph: '▤', desc: 'Saved charts and tables.' },
  { key: 'designer', title: 'Form designer', glyph: '⚙', desc: 'Build and change forms.', admin: true },
  { key: 'groups', title: 'Security groups', glyph: '◫', desc: 'Who can see and edit what.', admin: true },
  { key: 'users', title: 'Users', glyph: '☺', desc: 'People and their groups.', admin: true },
  { key: 'imports', title: 'Import history', glyph: '⇪', desc: 'Imports and rule changes, with Undo.', admin: true },
  { key: 'exports', title: 'PDF exports', glyph: '⇩', desc: 'Company name and logo on PDFs.', admin: true },
  { key: 'automations', title: 'Automations', glyph: '↯', desc: 'When this happens, do that.', admin: true },
  { key: 'audit', title: 'Audit trail', glyph: '⌕', desc: 'Every change, by whom and when.', admin: true },
];
export const pageOf = (key) => PAGES.find((p) => p.key === key) || null;

/** A shortcut's size when it's added: a quarter of the width, two cells tall. */
export const LINK_SIZE = { w: 6, h: 2 };

/** A link's key, for the picker and to compare links. */
export const linkKey = (l) => (!l ? '' : l.to === 'page' ? 'page:' + l.page : `${l.to}:${l.form}${l.view ? ':' + l.view : ''}`);
export function linkFromKey(k) {
  const [to, a, b] = String(k || '').split(':');
  if (to === 'page' && pageOf(a)) return { to, page: a };
  if ((to === 'list' || to === 'new') && a) return b && to === 'list' ? { to, form: a, view: b } : { to, form: a };
  return null;
}

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * What a shortcut shows and where it goes, for this person:
 * { title, sub, desc, glyph, form (for its colour badge), admin, ok (they may use it), go (a view) } or null if it points at nothing.
 * env: { formById, canView(id), canCreate(id), isAdmin, count(formId), viewById(id), noun(form, n), item(form),
 *        hasWorkflow, counts: { dashboards, reports, mywork } }
 */
export function linkInfo(link, env) {
  if (!link) return null;
  if (link.to === 'page') {
    const p = pageOf(link.page); if (!p) return null;
    const c = env.counts || {};
    const sub = p.admin ? 'Administration'
      : p.key === 'dashboards' ? plural(c.dashboards || 0, 'dashboard', 'dashboards')
      : p.key === 'reports' ? plural(c.reports || 0, 'report', 'reports')
      : p.key === 'mywork' ? `${(c.mywork || 0).toLocaleString()} waiting on you`
      : 'Your dashboard';
    const ok = (!p.admin || !!env.isAdmin) && (p.needs !== 'workflow' || !!env.hasWorkflow);
    return { title: p.title, sub, desc: p.desc, glyph: p.glyph, form: null, admin: !!p.admin, ok, go: { name: p.key } };
  }
  const form = env.formById(link.form);
  if (!form) return null;
  if (link.to === 'new') {
    return { title: `New ${env.item(form).toLowerCase()}`, sub: form.name, desc: `Opens a blank ${env.item(form).toLowerCase()} to fill in.`, glyph: '+', form, admin: false, ok: !!env.canCreate(form.id), go: { name: 'new', formId: form.id } };
  }
  const v = link.view ? env.viewById(link.view) : null;
  const usable = v && v.formId === form.id ? v : null; // a deleted view: the plain list
  const n = env.count(form.id);
  return { title: usable ? `${form.name} · ${usable.name}` : form.name, sub: plural(n, env.noun(form, 1), env.noun(form, 2)), desc: usable ? `Opens the “${usable.name}” view of ${form.name.toLowerCase()}.` : `Opens the ${form.name.toLowerCase()} list.`, glyph: null, form, admin: false, ok: !!env.canView(form.id), go: { name: 'records', formId: form.id, viewId: usable ? usable.id : null } };
}

/** The shortcuts this person can't use (admin screens for others, forms they can't see) are left out. */
export function visibleTiles(tiles, env) {
  return (tiles || []).filter((t) => !t.link || !!linkInfo(t.link, env)?.ok);
}

/** The picker's choices: [{ title, items: [{ key, title, sub, glyph, form, admin }] }]. Admin screens only for admins. */
export function linkChoices(env, forms) {
  const item = (link) => { const i = linkInfo(link, env); return i && i.ok ? { key: linkKey(link), ...i } : null; };
  const groups = [
    { title: 'Forms', items: forms.flatMap((f) => [item({ to: 'list', form: f.id }), item({ to: 'new', form: f.id })]).filter(Boolean) },
    { title: 'Insights', items: PAGES.filter((p) => !p.admin).map((p) => item({ to: 'page', page: p.key })).filter(Boolean) },
  ];
  if (env.isAdmin) groups.push({ title: 'Administration', admin: true, items: PAGES.filter((p) => p.admin).map((p) => item({ to: 'page', page: p.key })).filter(Boolean) });
  return groups.filter((g) => g.items.length);
}

/** Which dashboard Home shows: your own home if you can see it, else the default an admin chose, else none. */
export function homeDashboardId(ownHome, defaultHome, canSee) {
  if (ownHome && canSee(ownHome)) return ownHome;
  if (defaultHome && canSee(defaultHome)) return defaultHome;
  return '';
}
