// Ctrl K (⌘K on a Mac), or the "Ctrl K" button by Search forms: one box to jump to a page,
// open a form's list, start a new record, or open any record you can see.
import { esc, badge, itemName } from './ui.js';
import { paletteResults } from './palettelogic.js';

let H = null; // { store, formById, recTitle, canView(f), canCreate(id), isAdmin(), go(v), home(), newRecord(formId), openRecord(id), searchable() }
let P = null; // { q, i, list }

const PAGES = [
  { id: 'home', label: 'Home', glyph: '⌂' },
  { id: 'mywork', label: 'My work', glyph: '☰' },
  { id: 'dashboards', label: 'Dashboards', glyph: '▦' },
  { id: 'reports', label: 'Reports', glyph: '▤' },
];
const ADMIN_PAGES = [
  { id: 'designer', label: 'Form designer', glyph: '⚙' },
  { id: 'users', label: 'Users', glyph: '☺' },
  { id: 'groups', label: 'Security groups', glyph: '◫' },
  { id: 'automations', label: 'Automations', glyph: '↯' },
  { id: 'audit', label: 'Audit trail', glyph: '⌕' },
  { id: 'imports', label: 'Import history', glyph: '⇪' },
  { id: 'exports', label: 'PDF exports', glyph: '⇩' },
];

export function initPalette(helpers) {
  H = helpers;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.code === 'KeyK' || String(e.key).toLowerCase() === 'k')) {
      if (!H.store.ready) return;
      if (!P && e.target.closest?.('[contenteditable="true"], .rte')) return; // Ctrl K adds a link in rich text
      e.preventDefault(); e.stopPropagation();
      if (P) close(); else open();
      return;
    }
    if (!P) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Enter' && e.target.id === 'pal-q') { e.preventDefault(); run(P.list[P.i]); }
  }, true);
  document.addEventListener('input', (e) => { if (P && e.target.id === 'pal-q') { P.q = e.target.value; P.i = 0; paintList(); } }, true);
  document.addEventListener('click', (e) => {
    if (!P) return;
    const opt = e.target.closest?.('#pal-root [data-pal]');
    if (opt) { e.stopPropagation(); run(P.list[+opt.dataset.pal]); return; }
    if (e.target.closest?.('#pal-root') && !e.target.closest('.pal')) { e.stopPropagation(); close(); }
  }, true);
}

function items() {
  const s = H.store, out = [];
  PAGES.concat(H.isAdmin() ? ADMIN_PAGES : []).forEach((p) => out.push({ kind: 'page', id: p.id, label: p.label, sub: 'Page', glyph: p.glyph }));
  H.searchable().forEach((f) => {
    out.push({ kind: 'form', id: f.id, label: f.name || 'Untitled form', sub: 'Form', form: f });
    if (H.canCreate(f.id)) out.push({ kind: 'new', id: f.id, label: 'New ' + itemName(f).toLowerCase(), sub: f.name, form: f });
  });
  s.records.forEach((r) => {
    const f = H.formById(r.formId); if (!f || !H.canView(f)) return;
    out.push({ kind: 'record', id: r.id, label: H.recTitle(r, f), sub: f.name, at: r.updatedAt || r.createdAt || 0, form: f });
  });
  return out;
}

const root = () => { let r = document.getElementById('pal-root'); if (!r) { r = document.createElement('div'); r.id = 'pal-root'; document.body.appendChild(r); } return r; };

export function open() {
  P = { q: '', i: 0, list: [], back: document.activeElement };
  root().innerHTML = `<div class="pal-scrim"><div class="pal" role="dialog" aria-modal="true" aria-label="Search everything">
    <div class="pal-in"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
      <input id="pal-q" type="text" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" autocomplete="off" placeholder="Search forms, records and pages…" aria-label="Search forms, records and pages"><kbd>Esc</kbd></div>
    <div id="pal-list" class="pal-list" role="listbox" aria-label="Results"></div>
    <p class="pal-foot">↑ ↓ choose · Enter opens · Esc closes</p></div></div>`;
  paintList();
  setTimeout(() => document.getElementById('pal-q')?.focus(), 0);
}
export function close() {
  const back = P?.back; P = null; root().innerHTML = '';
  if (back && back.isConnected) back.focus?.({ preventScroll: true });
}
export const isOpen = () => !!P;

function icon(it) {
  if (it.kind === 'page') return `<span class="pal-g" aria-hidden="true">${esc(it.glyph || '•')}</span>`;
  if (it.kind === 'new') return `<span class="pal-g pal-new" aria-hidden="true">＋</span>`;
  return badge(it.form);
}
const KIND = { page: 'Page', form: 'Form · list', new: 'New record', record: 'Record' };
function paintList() {
  if (!P) return;
  P.list = paletteResults(items(), P.q, 12);
  P.i = Math.min(P.i, Math.max(0, P.list.length - 1));
  const box = document.getElementById('pal-list'); if (!box) return;
  box.innerHTML = P.list.length ? P.list.map((it, i) => `<button type="button" role="option" id="pal-o${i}" class="pal-opt${i === P.i ? ' hi' : ''}" aria-selected="${i === P.i}" data-pal="${i}" tabindex="-1">${icon(it)}<span class="pal-t"><b>${esc(it.label)}</b>${it.kind === 'record' || it.kind === 'new' ? `<small>${esc(it.sub)}</small>` : ''}</span><span class="pal-k">${KIND[it.kind]}</span></button>`).join('')
    : `<p class="pal-none">Nothing matches “${esc(P.q)}”.</p>`;
  const q = document.getElementById('pal-q');
  if (q) { if (P.list.length) q.setAttribute('aria-activedescendant', 'pal-o' + P.i); else q.removeAttribute('aria-activedescendant'); }
  box.querySelector('.pal-opt.hi')?.scrollIntoView({ block: 'nearest' });
}
function move(d) { if (!P || !P.list.length) return; P.i = (P.i + d + P.list.length) % P.list.length; paintList(); }
function run(it) {
  if (!it) return;
  close();
  if (it.kind === 'page') { if (it.id === 'home') H.home(); else H.go({ name: it.id }); }
  else if (it.kind === 'form') H.go({ name: 'records', formId: it.id });
  else if (it.kind === 'new') H.newRecord(it.id);
  else if (it.kind === 'record') H.openRecord(it.id);
}
