// The two "attach" windows:
//   openPickChildren — from a parent record: tick existing child records to attach to it.
//   openPickParent   — from a child form's list: pick the one parent to attach the ticked records to.
// They draw themselves into #at-root over the page; the caller decides what attaching does
// (a grid stages rows until the parent is saved; separate records and lists save straight away).
import './attach.css';
import { store } from './store.js';
import { canEditRecord } from './access.js';
import { esc, itemName } from './ui.js';
import { attachCandidates, parentOf, movesFrom } from './attachlogic.js';
import { nounOf } from './dashlogic.js';

let H = { fmt: null, valOf: null, recTitle: null, titleFieldOf: null, formById: null, recById: null };
export function initAttach(helpers) { H = { ...H, ...helpers }; }

const PAGE = 50;
const NOCOL = new Set(['heading', 'signature', 'file', 'image', 'textarea', 'formula']);
let A = null; // the open window's state
let back = null; // what had focus before it opened

function listCols(form, n) {
  const t = H.titleFieldOf(form);
  const usable = (form.fields || []).filter((f) => !NOCOL.has(f.type) && f.id !== t?.id);
  const listed = usable.filter((f) => f.inList);
  return (listed.length ? listed : usable).slice(0, n);
}
const cellText = (f, rec, form) => { try { return H.fmt(f, H.valOf(f, rec, form)) || ''; } catch (e) { return ''; } };
const titleOf = (rec) => H.recTitle(rec, H.formById(rec.formId));
const searchText = (rec, form, cols) => [titleOf(rec), ...cols.map((f) => cellText(f, rec, form))].join(' ');

/**
 * Pick existing child records for one parent.
 * o: { parentForm, parentId (null when not saved yet), parentTitle, childForm, exclude: Set, onPick(recs) }
 */
export function openPickChildren(o) {
  back = document.activeElement;
  A = { kind: 'kids', ...o, q: '', others: false, picked: new Set(), shown: PAGE, busy: false };
  paint('#at-q');
}

/**
 * Pick the parent for records ticked in a list.
 * o: { childForm, recs (the ticked records), skipped (ticked but not editable), parentForms, onPick(parent, parentForm) }
 */
export function openPickParent(o) {
  back = document.activeElement;
  A = { kind: 'parent', ...o, formId: o.parentForms[0]?.id, q: '', choice: null, shown: PAGE, busy: false };
  paint('#at-q');
}

export function closeAttach() {
  A = null;
  document.getElementById('at-root')?.remove();
  document.body.classList.remove('at-open');
  if (back && document.contains(back)) back.focus({ preventScroll: true });
  back = null;
}
export const attachOpen = () => !!A;

function root() {
  let r = document.getElementById('at-root');
  if (!r) { r = document.createElement('div'); r.id = 'at-root'; document.body.appendChild(r); }
  return r;
}

function paint(focusSel) {
  if (!A) return;
  const act = document.activeElement;
  const keep = !focusSel && act && act.closest && act.closest('#at-root') ? { sel: act.dataset.atf ? `[data-atf="${CSS.escape(act.dataset.atf)}"]` : act.id ? '#' + act.id : null, s: act.selectionStart, e: act.selectionEnd } : null;
  const scroll = document.querySelector('#at-root .at-list')?.scrollTop || 0;
  root().innerHTML = A.kind === 'kids' ? kidsHTML() : parentHTML();
  document.body.classList.add('at-open');
  const list = document.querySelector('#at-root .at-list'); if (list) list.scrollTop = scroll;
  const el = focusSel ? document.querySelector('#at-root ' + focusSel) : keep?.sel ? document.querySelector('#at-root ' + keep.sel) : null;
  if (el) { el.focus({ preventScroll: true }); if (keep && el.setSelectionRange && keep.s != null) try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* not a text box */ } }
}

/* ---------- picking children ---------- */

function kidsData() {
  const { childForm, parentId, exclude } = A;
  const cols = listCols(childForm, 3);
  const base = {
    records: store.records, childFormId: childForm.id, parentId, exclude, others: A.others,
    canEdit: (r) => canEditRecord(store.me, r), recById: H.recById, text: (r) => searchText(r, childForm, cols),
  };
  const pool = attachCandidates(base);
  // ticks survive a search, but not a record leaving the pool (the switch turned off)
  const inPool = new Set(pool.map((x) => x.rec.id));
  [...A.picked].forEach((id) => { if (!inPool.has(id)) A.picked.delete(id); });
  const all = A.q.trim() ? attachCandidates({ ...base, q: A.q }) : pool;
  return { cols, all, pool };
}

function kidsHTML() {
  const { childForm, parentTitle } = A;
  const { cols, all, pool } = kidsData();
  const shown = all.slice(0, A.shown);
  const picked = pool.filter((x) => A.picked.has(x.rec.id));
  const moves = movesFrom(picked, titleOf);
  const kids = nounOf(childForm, 2), one = itemName(childForm).toLowerCase();
  const allOn = shown.length > 0 && shown.every((x) => A.picked.has(x.rec.id));
  const head = `<tr><th class="at-ck"><label class="at-cklab"><input type="checkbox" data-atc="all" data-atf="all" aria-label="Tick all shown"${allOn ? ' checked' : ''}${shown.length ? '' : ' disabled'}></label></th><th>${esc(H.titleFieldOf(childForm)?.label || 'Title')}</th>${cols.map((f) => `<th>${esc(f.label)}</th>`).join('')}${A.others ? `<th>Currently on</th>` : ''}</tr>`;
  const body = shown.map(({ rec, from }) => {
    const on = A.picked.has(rec.id);
    return `<tr class="${on ? 'on' : ''}${from ? ' moving' : ''}" data-at="row" data-v="${esc(rec.id)}"><td class="at-ck"><label class="at-cklab"><input type="checkbox" data-atc="pick" data-atf="p-${esc(rec.id)}" data-v="${esc(rec.id)}" aria-label="Attach ${esc(titleOf(rec))}"${on ? ' checked' : ''}></label></td><td class="at-title">${esc(titleOf(rec))}</td>${cols.map((f) => { const t = cellText(f, rec, childForm); return `<td title="${esc(t)}">${esc(t)}</td>`; }).join('')}${A.others ? `<td class="at-from">${from ? esc(titleOf(from)) : '<span class="at-none">None</span>'}</td>` : ''}</tr>`;
  }).join('');
  const emptyMsg = A.q ? `Nothing matches “${esc(A.q)}”.`
    : A.others ? `There are no other ${esc(kids)} you can attach.`
    : `Every ${esc(one)} is already attached somewhere. Turn on “Include ${esc(kids)} attached elsewhere” to move some here.`;
  const n = picked.length;
  return `<div class="at-scrim" data-at="close"><div class="at-dlg" role="dialog" aria-modal="true" aria-labelledby="at-h">
    <div class="at-h"><div class="at-tt"><h2 id="at-h">Attach existing ${esc(kids)}</h2><p class="at-sub">To ${esc(parentTitle)}. ${A.others ? 'Ones attached elsewhere move here.' : `Showing ${esc(kids)} that aren’t attached to anything yet.`}</p></div><button type="button" class="ibtn" data-at="close" aria-label="Close">✕</button></div>
    <div class="at-tools"><input id="at-q" class="in" type="search" data-ati="q" value="${esc(A.q)}" placeholder="Search ${esc(kids)}" aria-label="Search ${esc(kids)}">
      <label class="switch"><input type="checkbox" data-ati="others" data-atf="others"${A.others ? ' checked' : ''}><span class="tr"></span><span>Include ${esc(kids)} attached elsewhere</span></label></div>
    <div class="at-list">${all.length ? `<table class="at-tbl"><thead>${head}</thead><tbody>${body}</tbody></table>${all.length > shown.length ? `<div class="at-more"><span>Showing ${shown.length} of ${all.length}</span><button type="button" class="btn sm" data-at="more">Show ${Math.min(PAGE, all.length - shown.length)} more</button></div>` : ''}` : `<p class="at-empty">${emptyMsg}</p>`}</div>
    <div class="at-foot">${moves.n ? `<p class="at-warn" role="status"><b>${moves.n} will move</b> from ${moves.names.slice(0, 4).map(esc).join(', ')}${moves.names.length > 4 ? ` and ${moves.names.length - 4} more` : ''}.</p>` : `<p class="at-count">${n ? `${n} ticked` : 'Tick the ones to attach.'}</p>`}
      <button type="button" class="btn ghost" data-at="close">Cancel</button><button type="button" class="btn primary" data-at="go" data-atf="go"${n && !A.busy ? '' : ' disabled'}>${n ? `Attach ${n} ${esc(nounOf(childForm, n))}` : 'Attach'}</button></div>
  </div></div>`;
}

/* ---------- picking a parent ---------- */

function parentHTML() {
  const { childForm, recs, skipped, parentForms } = A;
  const pf = parentForms.find((f) => f.id === A.formId) || parentForms[0];
  const cols = listCols(pf, 2);
  const words = A.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const kidsOf = new Map();
  store.records.forEach((r) => { if (r.parentId) kidsOf.set(r.parentId, (kidsOf.get(r.parentId) || 0) + 1); });
  const all = store.records.filter((r) => r.formId === pf.id && canEditRecord(store.me, r))
    .filter((r) => !words.length || (() => { const t = searchText(r, pf, cols).toLowerCase(); return words.every((w) => t.includes(w)); })())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const shown = all.slice(0, A.shown);
  if (A.choice && !all.some((r) => r.id === A.choice)) A.choice = null;
  const choice = A.choice && H.recById(A.choice);
  const moving = recs.filter((r) => { const p = parentOf(r, H.recById); return p && p.id !== A.choice; }).length;
  const already = choice ? recs.filter((r) => r.parentId === choice.id).length : 0;
  const n = recs.length, kids = nounOf(childForm, n), pn = itemName(pf).toLowerCase();
  const body = shown.map((r) => {
    const on = A.choice === r.id;
    return `<tr class="${on ? 'on' : ''}" data-at="choose" data-v="${esc(r.id)}"><td class="at-ck"><label class="at-cklab"><input type="radio" name="at-parent" data-atc="choose" data-atf="c-${esc(r.id)}" data-v="${esc(r.id)}" aria-label="${esc(titleOf(r))}"${on ? ' checked' : ''}></label></td><td class="at-title">${esc(titleOf(r))}</td>${cols.map((f) => { const t = cellText(f, r, pf); return `<td title="${esc(t)}">${esc(t)}</td>`; }).join('')}<td class="num">${kidsOf.get(r.id) || 0}</td></tr>`;
  }).join('');
  const notes = [];
  if (moving) notes.push(`<b>${moving} ${moving === 1 ? 'is' : 'are'} attached elsewhere</b> and will move.`);
  if (already) notes.push(`${already} ${already === 1 ? 'is' : 'are'} already on it.`);
  if (skipped) notes.push(`${skipped} you can’t edit ${skipped === 1 ? 'is' : 'are'} skipped.`);
  const go = n - already;
  return `<div class="at-scrim" data-at="close"><div class="at-dlg" role="dialog" aria-modal="true" aria-labelledby="at-h">
    <div class="at-h"><div class="at-tt"><h2 id="at-h">Attach ${n} ${esc(kids)} to…</h2><p class="at-sub">Pick the ${esc(pn)} they belong to.</p></div><button type="button" class="ibtn" data-at="close" aria-label="Close">✕</button></div>
    <div class="at-tools">${parentForms.length > 1 ? `<select class="in at-auto" data-ati="form" data-atf="form" aria-label="Which form">${parentForms.map((f) => `<option value="${esc(f.id)}"${f.id === pf.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select>` : ''}
      <input id="at-q" class="in" type="search" data-ati="q" value="${esc(A.q)}" placeholder="Search ${esc(nounOf(pf, 2))}" aria-label="Search ${esc(nounOf(pf, 2))}"></div>
    <div class="at-list">${all.length ? `<table class="at-tbl"><thead><tr><th class="at-ck"><span class="sr">Pick</span></th><th>${esc(H.titleFieldOf(pf)?.label || 'Title')}</th>${cols.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th class="num">${esc(childForm.name)}</th></tr></thead><tbody>${body}</tbody></table>${all.length > shown.length ? `<div class="at-more"><span>Showing ${shown.length} of ${all.length}</span><button type="button" class="btn sm" data-at="more">Show ${Math.min(PAGE, all.length - shown.length)} more</button></div>` : ''}`
      : `<p class="at-empty">${A.q ? `Nothing matches “${esc(A.q)}”.` : `There are no ${esc(nounOf(pf, 2))} you can edit.`}</p>`}</div>
    <div class="at-foot"><p class="at-warn${notes.length ? '' : ' at-count'}" role="status">${notes.join(' ') || (choice ? '' : `Pick ${/^[aeiou]/.test(pn) ? 'an' : 'a'} ${esc(pn)}.`)}</p>
      <button type="button" class="btn ghost" data-at="close">Cancel</button><button type="button" class="btn primary" data-at="go" data-atf="go"${choice && go > 0 && !A.busy ? '' : ' disabled'}>${choice ? `Attach ${go} to ${esc(titleOf(choice))}` : 'Attach'}</button></div>
  </div></div>`;
}

/* ---------- events ---------- */

async function go() {
  if (!A || A.busy) return;
  if (A.kind === 'kids') {
    const recs = [...A.picked].map((id) => H.recById(id)).filter(Boolean);
    if (!recs.length) return;
    A.busy = true; paint();
    const done = await A.onPick(recs);
    if (done === false) { if (A) { A.busy = false; paint(); } return; }
    closeAttach();
  } else {
    const parent = A.choice && H.recById(A.choice); if (!parent) return;
    const pf = A.parentForms.find((f) => f.id === parent.formId);
    A.busy = true; paint();
    const done = await A.onPick(parent, pf);
    if (done === false) { if (A) { A.busy = false; paint(); } return; }
    closeAttach();
  }
}

document.addEventListener('click', (e) => {
  if (!A) return;
  const el = e.target.closest && e.target.closest('#at-root [data-at]');
  if (!el) return;
  const a = el.dataset.at;
  if (a === 'close') { if (el.classList.contains('at-scrim') && e.target !== el) return; closeAttach(); return; }
  if (a === 'more') { A.shown += PAGE; paint('[data-at="more"]'); return; }
  if (a === 'go') { go(); return; }
  if (e.target.closest('input, label')) return; // the box itself: handled on change
  if (a === 'row') { const id = el.dataset.v; if (A.picked.has(id)) A.picked.delete(id); else A.picked.add(id); paint(`[data-atf="p-${CSS.escape(id)}"]`); }
  if (a === 'choose') { A.choice = el.dataset.v; paint(`[data-atf="c-${CSS.escape(el.dataset.v)}"]`); }
});
document.addEventListener('change', (e) => {
  if (!A) return;
  const t = e.target; if (!t.closest || !t.closest('#at-root')) return;
  const c = t.dataset.atc, i = t.dataset.ati;
  if (c === 'pick') { if (t.checked) A.picked.add(t.dataset.v); else A.picked.delete(t.dataset.v); paint(); }
  else if (c === 'all') {
    const { all } = kidsData();
    all.slice(0, A.shown).forEach((x) => (t.checked ? A.picked.add(x.rec.id) : A.picked.delete(x.rec.id)));
    paint();
  } else if (c === 'choose') { A.choice = t.dataset.v; paint(); }
  else if (i === 'others') { A.others = t.checked; A.shown = PAGE; paint(); }
  else if (i === 'form') { A.formId = t.value; A.choice = null; A.shown = PAGE; paint(); }
});
document.addEventListener('input', (e) => {
  if (!A || e.target.dataset?.ati !== 'q' || !e.target.closest('#at-root')) return;
  A.q = e.target.value; A.shown = PAGE; paint();
});
document.addEventListener('keydown', (e) => {
  if (!A) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAttach(); return; }
  if (e.key === 'Tab') { // keep focus inside the window
    const f = [...document.querySelectorAll('#at-root button:not(:disabled), #at-root input:not(:disabled), #at-root select')].filter((x) => x.offsetParent);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
}, true);
