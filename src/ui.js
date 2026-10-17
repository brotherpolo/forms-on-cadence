// DOM helpers and small presentational pieces shared by the app and admin screens.
import { esc } from './util.js';

export { esc, uid, clone, isEmpty } from './util.js';

export const $ = (s) => document.querySelector(s);

export const COLORS = ['#3346c8', '#0f7b6c', '#b4531a', '#8a3fb8', '#b42367', '#3d6b1f', '#56607a', '#0b6aa2'];

export const colorOf = (f) => COLORS[(f.color ?? 0) % COLORS.length];

export const itemName = (f) =>
  (f.itemName || '').trim() || (f.name || 'Record').replace(/s$/i, '') || 'Record';

export const badge = (f, lg) =>
  `<span class="badge${lg ? ' lg' : ''}" style="background:${colorOf(f)}">${esc(
    (f.name || '?').trim().charAt(0).toUpperCase() || '?'
  )}</span>`;

/*
 * Pop-up messages at the bottom of the screen, styled like Cadence's: a dark rounded pill that
 * slides up, with an optional action button (Open, Show, Undo…) and a × to close. Up to three
 * stack; each goes after 3.6 s (or opts.duration), and waits while the pointer is on it.
 *   toast('Form saved')
 *   toast('<b>Bea</b> mentioned you…', { html: true, action: 'Open', onAction: () => …, duration: 8000 })
 * #toast (hidden) always holds the newest message as plain text, for tests and tools.
 */
let mirrorTimer;
const X_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
export function toast(message, opts = {}) {
  let root = document.getElementById('toasts');
  if (!root) { root = document.createElement('div'); root.id = 'toasts'; root.className = 'toasts'; document.body.appendChild(root); }
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="toast-msg"></span>${opts.action ? `<button type="button" class="toast-btn">${esc(opts.action)}</button>` : ''}<button type="button" class="toast-x" aria-label="Dismiss">${X_ICON}</button>`;
  const msg = el.querySelector('.toast-msg');
  if (opts.html) msg.innerHTML = message; else msg.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  let gone = false, timer = null;
  const close = () => {
    if (gone) return; gone = true; clearTimeout(timer);
    el.classList.remove('in');
    setTimeout(() => el.remove(), 250);
  };
  const wait = () => { clearTimeout(timer); timer = setTimeout(close, opts.duration || 3600); };
  wait();
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', wait);
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('focusout', wait);
  if (opts.action) el.querySelector('.toast-btn').addEventListener('click', () => { close(); opts.onAction && opts.onAction(); });
  el.querySelector('.toast-x').addEventListener('click', close);
  while (root.children.length > 3) root.firstElementChild.remove();
  const m = $('#toast');
  if (m) {
    m.className = 'toast-mirror';
    m.textContent = msg.textContent;
    m.hidden = false;
    clearTimeout(mirrorTimer);
    mirrorTimer = setTimeout(() => (m.hidden = true), opts.duration || 3600);
  }
  return close;
}

/* ---------- a page opened before an update ----------
   Parts of Formwright load when first needed (Word templates, PDFs). After an update those files
   have new names, so a page left open from before can't load them: say so, and offer a reload. */
let staleShown = false;
export const isStaleImport = (e) => /dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css|failed to load module script/i.test(String((e && (e.message || e)) || ''));
export function staleNotice() {
  if (staleShown) return;
  staleShown = true;
  toast('Formwright was updated since this page opened. Reload to use the new version.', { action: 'Reload', onAction: () => location.reload(), duration: 60000 });
}
/** Load a part of Formwright; if the page is from before an update, explain instead of a vague error. */
export async function lazy(load) {
  try { return await load(); } catch (e) {
    if (isStaleImport(e)) { staleNotice(); const err = new Error('Formwright was updated since this page opened. Reload the page (pull down, or press Reload), then try again.'); err.stale = true; err.cause = e; throw err; }
    throw e;
  }
}
if (typeof window !== 'undefined') window.addEventListener('vite:preloadError', (ev) => { ev.preventDefault?.(); staleNotice(); });
