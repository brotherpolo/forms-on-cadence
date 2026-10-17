// The person picker: a searchable list of people with their initials, email, how many open tasks
// they have, and why someone can't be picked yet. Used by Reassign (My work) and the task pop-up.
// The host keeps the chosen uid and the search text; rows are buttons with data-pk="pick" data-v.
import { esc } from './ui.js';
import { avatarColor, initials } from './commentlogic.js';
import { pickRows, pickMatch, pickText } from './pickerlogic.js';

const av = (p) => p.icon
  ? `<span class="cm-av sm pk-ic" aria-hidden="true">${esc(p.icon)}</span>`
  : `<span class="cm-av sm" style="background:${avatarColor(p.uid)}" aria-hidden="true">${esc(initials(p.av || p.name || p.email || '?'))}</span>`;

function opt(p, sel, q, counts, pin) {
  const on = p.uid === sel, dis = !p.ok && !on;
  const right = !p.ok ? '<span class="pk-why">Can’t be given tasks yet</span>' : counts && !p.icon ? `<span class="pk-n">${counts[p.uid] || 0} open</span>` : p.sub ? `<span class="pk-n">${esc(p.sub)}</span>` : '';
  return `<button type="button" role="option" class="pk-opt${pin === 'role' ? ' pk-role' : pin ? ' pk-pin' : ''}${on ? ' on' : ''}" data-pk="pick" data-v="${esc(p.uid)}" data-s="${esc(pickText(p))}" aria-selected="${on}"${dis ? ' disabled' : ''}${pickMatch(p, q) ? '' : ' hidden'}>
    <span class="pk-radio" aria-hidden="true"></span>${av(p)}<span class="pk-nm"><b>${esc(p.name || p.email || 'Someone')}</b>${p.email && !p.icon ? `<small>${esc(p.email)}</small>` : ''}</span>${right}</button>`;
}

/** { people, pinned, roles, exclude, sel, q, counts, label, id } → HTML. roles: [{ uid: 'role:…', name, icon, sub }] listed last under "Roles". */
export function pickerHTML(o) {
  const { pinned, rows, search: s0 } = pickRows(o.people, { pinned: o.pinned || [], exclude: o.exclude || [] });
  const roles = (o.roles || []).filter((r) => !(o.exclude || []).includes(r.uid));
  const search = s0 || pinned.length + rows.length + roles.length >= 6;
  const q = search ? o.q || '' : '';
  const any = [...pinned, ...rows, ...roles].some((p) => pickMatch(p, q));
  const blocked = rows.some((p) => !p.ok);
  return `<div class="pk" data-pk-root="${esc(o.id || 'pk')}">
    ${search ? `<input class="in pk-q" type="search" data-pk-q="1" value="${esc(q)}" placeholder="${roles.length ? 'Search people and roles…' : 'Search people…'}" aria-label="${roles.length ? 'Search people and roles' : 'Search people'}" autocomplete="off">` : ''}
    <div class="pk-list" role="listbox" aria-label="${esc(o.label || 'People')}">
      ${pinned.map((p) => opt(p, o.sel, q, null, true)).join('')}
      ${pinned.length && rows.length ? `<div class="pk-sep" role="presentation"${pinned.every((p) => !pickMatch(p, q)) ? ' hidden' : ''}></div>` : ''}
      ${rows.map((p) => opt(p, o.sel, q, o.counts)).join('')}
      ${roles.length ? `<div class="pk-sep pk-rh" role="presentation"${roles.every((p) => !pickMatch(p, q)) ? ' hidden' : ''}><span>Roles: anyone in it can do it</span></div>${roles.map((p) => opt(p, o.sel, q, null, 'role')).join('')}` : ''}
      <p class="pk-none help"${any ? ' hidden' : ''}>No one matches “<span>${esc(q)}</span>”.</p>
    </div>
    ${blocked ? '<p class="help pk-foot">Greyed-out people need Cadence switched on (an administrator does that in Users), then to sign in to Formwright or Cadence once.</p>' : ''}
  </div>`;
}

/** Typing in the search box: show matching rows without redrawing (keeps the cursor where it is). */
export function pickerFilter(input) {
  const box = input.closest('.pk'); if (!box) return;
  const q = input.value;
  let any = false;
  box.querySelectorAll('.pk-opt').forEach((b) => { const m = pickMatch({ name: b.dataset.s }, q); b.hidden = !m; if (m) any = true; });
  const none = box.querySelector('.pk-none'); if (none) { none.hidden = any; none.querySelector('span').textContent = q; }
  const sep = box.querySelector('.pk-sep:not(.pk-rh)'); if (sep) sep.hidden = ![...box.querySelectorAll('.pk-opt.pk-pin')].some((b) => !b.hidden);
  const rh = box.querySelector('.pk-rh'); if (rh) rh.hidden = ![...box.querySelectorAll('.pk-opt.pk-role')].some((b) => !b.hidden);
}

/** Arrow keys move between rows (and from the search box into the list). true when handled. */
export function pickerKey(e) {
  const el = e.target; const box = el.closest?.('.pk'); if (!box) return false;
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
  const opts = [...box.querySelectorAll('.pk-opt')].filter((b) => !b.hidden && !b.disabled);
  if (!opts.length) return false;
  e.preventDefault();
  const i = opts.indexOf(el);
  if (el.dataset.pkQ) { if (e.key === 'ArrowDown') opts[0].focus(); return true; }
  if (e.key === 'ArrowDown') opts[Math.min(i + 1, opts.length - 1)].focus();
  else if (i <= 0) (box.querySelector('.pk-q') || opts[0]).focus();
  else opts[i - 1].focus();
  return true;
}
/** After a redraw, put focus back on the chosen row (or the search box). */
export function pickerFocus(root, sel, toSearch) {
  const box = root?.querySelector('.pk'); if (!box) return;
  const q = toSearch && box.querySelector('.pk-q');
  if (q) { q.focus(); const n = q.value.length; try { q.setSelectionRange(n, n); } catch (e) { /* fine */ } return; }
  (box.querySelector(`.pk-opt[data-v="${CSS.escape(sel || '')}"]`) || box.querySelector('.pk-opt:not([disabled]):not([hidden])'))?.focus();
}
