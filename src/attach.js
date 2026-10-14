// The two "attach" windows:
//   openPickChildren — from a parent record: tick existing child records to attach to it.
//   openPickParent   — from a child form's list: pick the one parent to attach the ticked records to.
// They draw themselves into #at-root over the page; the caller decides what attaching does
// (a grid stages rows until the parent is saved; separate records and lists save straight away).
import './attach.css';
import { store } from './store.js';
import { canEditRecord } from './access.js';
import { esc, itemName } from './ui.js';
import { attachCandidates, parentOf, movesFrom, suggestMatch, suggestParent, chipHit, filterFields, filterValuesOf, valueOrder, searchHit } from './attachlogic.js';
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
/** A record's name in a sentence: a bare number gets its form's word ("Invoice 7", not "7"). */
const named = (rec) => { const t = titleOf(rec); const f = H.formById(rec.formId); return /^[#\d]/.test(t) && f ? itemName(f) + ' ' + t : t; };

// Search looks through every field (long text included) and the parent's name. Cached per
// record object: the store swaps the object when a record changes.
const NOSEARCH = new Set(['heading', 'file', 'image', 'signature']);
const TEXT = new WeakMap();
function fullText(rec) {
  let t = TEXT.get(rec);
  if (t == null) {
    const form = H.formById(rec.formId);
    const parts = [titleOf(rec)];
    (form?.fields || []).forEach((f) => { if (!NOSEARCH.has(f.type)) parts.push(cellText(f, rec, form)); });
    const p = parentOf(rec, H.recById); if (p) parts.push(titleOf(p));
    t = parts.join(' • ');
    TEXT.set(rec, t);
  }
  return t;
}

/**
 * Pick existing child records for one parent.
 * o: { parentForm, parentId (null when not saved yet), parentTitle, parentValues, childForm, exclude: Set, onPick(recs) }
 */
export function openPickChildren(o) {
  back = document.activeElement;
  A = { kind: 'kids', ...o, q: '', others: false, picked: new Set(), shown: PAGE, busy: false, chips: [], sugOff: false, pop: null };
  // the suggested match: a field with the same name on both forms, set to this parent's value
  const eligible = attachCandidates(baseOpts(true)).map((x) => x.rec);
  const sug = suggestMatch({ parentForm: o.parentForm, childForm: o.childForm, parentValues: o.parentValues || {}, records: eligible, valOf: (f, r) => H.valOf(f, r, o.childForm), titleField: H.titleFieldOf(o.parentForm) });
  A.sug = sug ? { ...sug, text: cellText(sug.p, { formId: o.parentForm.id, values: o.parentValues || {} }, o.parentForm) || String(o.parentValues?.[sug.p.id] ?? '') } : null;
  paint('#at-q');
}

/**
 * Pick the parent for records ticked in a list.
 * o: { childForm, recs (the ticked records), skipped (ticked but not editable), parentForms, onPick(parent, parentForm) }
 */
export function openPickParent(o) {
  back = document.activeElement;
  A = { kind: 'parent', ...o, formId: o.parentForms[0]?.id, q: '', choice: null, shown: PAGE, busy: false };
  const sug = suggestParent({
    childForm: o.childForm, parentForms: o.parentForms, recs: o.recs,
    parentsOf: (fid) => store.records.filter((r) => r.formId === fid && canEditRecord(store.me, r)),
    valOf: (f, r) => H.valOf(f, r, H.formById(r.formId)), titleFieldOf: H.titleFieldOf,
  });
  A.sug = sug;
  if (sug) {
    A.formId = sug.form.id;
    const already = o.recs.filter((r) => r.parentId === sug.parent.id).length;
    if (sug.n === sug.total && already < o.recs.length) A.choice = sug.parent.id; // every ticked record agrees: picked for you
  }
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
  const popScroll = document.querySelector('#at-root .at-popl')?.scrollTop || 0;
  root().innerHTML = A.kind === 'kids' ? kidsHTML() : parentHTML();
  document.body.classList.add('at-open');
  const list = document.querySelector('#at-root .at-list'); if (list) list.scrollTop = scroll;
  const pl = document.querySelector('#at-root .at-popl'); if (pl) pl.scrollTop = popScroll;
  const el = focusSel ? document.querySelector('#at-root ' + focusSel) : keep?.sel ? document.querySelector('#at-root ' + keep.sel) : null;
  if (el) { el.focus({ preventScroll: true }); if (keep && el.setSelectionRange && keep.s != null) try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* not a text box */ } }
}

/* ---------- picking children ---------- */

function baseOpts(others) {
  return {
    records: store.records, childFormId: A.childForm.id, parentId: A.parentId, exclude: A.exclude, others,
    canEdit: (r) => canEditRecord(store.me, r), recById: H.recById, text: fullText,
  };
}
const fieldIn = (form, id) => (form.fields || []).find((f) => f.id === id);

function kidsData(popField) {
  const { childForm } = A;
  const sugOn = !!A.sug && !A.sugOff;
  const chips = (sugOn ? [{ field: A.sug.c.id, key: A.sug.key, suggested: true }] : []).concat(A.chips);
  const val = (f, r) => H.valOf(f, r, childForm);
  const keepBut = (skip) => (r) => chips.every((ch) => {
    if (skip && ch.field === skip && !ch.suggested) return true;
    const f = fieldIn(childForm, ch.field);
    return !f || chipHit(ch, f, val(f, r), H.fmt);
  });
  const q = A.q.trim();
  const others = A.others || chips.length > 0 || !!q; // anything that narrows the list (a match, a filter, a search) looks everywhere
  const eligible = attachCandidates(baseOpts(true));
  const okIds = new Set(eligible.map((x) => x.rec.id));
  [...A.picked].forEach((id) => { if (!okIds.has(id)) A.picked.delete(id); });
  const all = attachCandidates({ ...baseOpts(others), keep: keepBut(null), q });
  let values = null;
  if (popField) {
    const counts = new Map();
    attachCandidates({ ...baseOpts(true), keep: keepBut(popField.id), q }).forEach(({ rec }) => {
      filterValuesOf(popField, val(popField, rec), H.fmt).forEach((x) => { const c = counts.get(x.label); if (c) c.n++; else counts.set(x.label, { ...x, n: 1 }); });
    });
    values = [...counts.values()].sort(valueOrder);
  }
  return { chips, sugOn, others, q, eligible, all, values };
}

function chipLabel(ch) {
  const f = fieldIn(A.childForm, ch.field);
  if (ch.suggested) return `${f?.label || 'Field'} is ${A.sug.text}`;
  return `${f?.label || 'Field'} is ${ch.labels.join(' or ')}`;
}

function popHTML(popField, values) {
  if (!A.pop) return '';
  if (A.pop === 'fields') {
    const fs = filterFields(A.childForm);
    return `<div class="at-pop" role="dialog" aria-label="Add a filter"><div class="at-plab">Filter by</div><div class="at-popl">${fs.map((f) => `<button type="button" class="at-opt" data-at="field" data-v="${esc(f.id)}" data-atf="f-${esc(f.id)}"><span>${esc(f.label)}</span><span aria-hidden="true">›</span></button>`).join('') || '<p class="at-none">Nothing to filter by.</p>'}</div></div>`;
  }
  if (!popField) return '';
  const mine = A.chips.find((c) => c.field === popField.id);
  const shown = (values || []).slice(0, 200);
  return `<div class="at-pop" role="dialog" aria-label="Filter by ${esc(popField.label)}">
    <div class="at-phead"><button type="button" class="ibtn" data-at="popback" aria-label="Back to fields">‹</button><b>${esc(popField.label)}</b></div>
    <div class="at-popl">${shown.map((x, i) => `<label class="at-opt"><span class="at-optl"><input type="checkbox" data-atc="val" data-atf="v-${i}" data-v="${esc(x.label)}"${mine && mine.labels.includes(x.label) ? ' checked' : ''}>${esc(x.label)}</span><span class="at-n">${x.n}</span></label>`).join('') || '<p class="at-none">No values here.</p>'}
    ${(values || []).length > shown.length ? `<p class="at-none">Showing the first ${shown.length}. Use search for the rest.</p>` : ''}</div>
    <button type="button" class="btn primary sm at-pdone" data-at="popdone">Done</button></div>`;
}

function kidsHTML() {
  const { childForm } = A;
  const parentTitle = /^[#\d]/.test(A.parentTitle) ? itemName(A.parentForm) + ' ' + A.parentTitle : A.parentTitle;
  const popField = A.pop && A.pop !== 'fields' ? fieldIn(childForm, A.pop) : null;
  const d = kidsData(popField);
  const { all, chips, sugOn, others, q } = d;
  const cols = listCols(childForm, 3);
  const shown = all.slice(0, A.shown);
  const picked = d.eligible.filter((x) => A.picked.has(x.rec.id));
  const visibleIds = new Set(all.map((x) => x.rec.id));
  const hiddenTicked = picked.filter((x) => !visibleIds.has(x.rec.id)).length;
  const moves = movesFrom(picked, named);
  const kids = nounOf(childForm, 2), one = itemName(childForm).toLowerCase();
  const allOn = shown.length > 0 && shown.every((x) => A.picked.has(x.rec.id));
  const head = `<tr><th class="at-ck"><label class="at-cklab"><input type="checkbox" data-atc="all" data-atf="all" aria-label="Tick all shown"${allOn ? ' checked' : ''}${shown.length ? '' : ' disabled'}></label></th><th>${esc(H.titleFieldOf(childForm)?.label || 'Title')}</th>${cols.map((f) => `<th>${esc(f.label)}</th>`).join('')}${others ? `<th class="at-fromh">Currently on</th>` : ''}</tr>`;
  const body = shown.map(({ rec, from }) => {
    const on = A.picked.has(rec.id);
    return `<tr class="${on ? 'on' : ''}${from ? ' moving' : ''}" data-at="row" data-v="${esc(rec.id)}"><td class="at-ck"><label class="at-cklab"><input type="checkbox" data-atc="pick" data-atf="p-${esc(rec.id)}" data-v="${esc(rec.id)}" aria-label="Attach ${esc(titleOf(rec))}"${on ? ' checked' : ''}></label></td><td class="at-title">${esc(titleOf(rec))}</td>${cols.map((f) => { const t = cellText(f, rec, childForm); return `<td title="${esc(t)}">${esc(t)}</td>`; }).join('')}${others ? `<td class="at-from">${from ? esc(named(from)) : '<span class="at-none">Nothing</span>'}</td>` : ''}</tr>`;
  }).join('');
  const emptyMsg = chips.length ? `No ${esc(kids)} match ${chips.length === 1 ? 'this filter' : 'these filters'}${q ? ' and search' : ''}. Remove a filter with its ✕ to see more.`
    : q ? `Nothing matches “${esc(q)}”, anywhere in the ${esc(kids)}.`
    : others ? `There are no other ${esc(kids)} you can attach.`
    : `Every ${esc(one)} is already attached somewhere. Search, or turn on “Include ${esc(kids)} attached elsewhere”, to find ones to move here.`;
  const sub = sugOn ? `To ${esc(parentTitle)}. Showing ${esc(kids)} whose ${esc(fieldIn(childForm, A.sug.c.id)?.label || '')} is ${esc(A.sug.text)}, including any attached elsewhere; those move here.`
    : q ? `To ${esc(parentTitle)}. Searching every ${esc(one)}, including ones attached elsewhere.`
    : chips.length ? `To ${esc(parentTitle)}. Filtering every ${esc(one)}, including ones attached elsewhere; those move here.`
    : A.others ? `To ${esc(parentTitle)}. Ones attached elsewhere move here.`
    : `To ${esc(parentTitle)}. Showing ${esc(kids)} that aren’t attached to anything yet.`;
  const chipHTML = chips.map((ch, i) => `<span class="at-chip${ch.suggested ? ' sug' : ''}">${ch.suggested ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/></svg>' : ''}<span>${esc(chipLabel(ch))}</span>${ch.suggested ? '<span class="at-tag">Suggested</span>' : ''}<button type="button" data-at="chipx" data-v="${ch.suggested ? 's' : i - (sugOn ? 1 : 0)}" data-atf="x-${i}" aria-label="Remove ${esc(chipLabel(ch))}">✕</button></span>`).join('');
  const n = picked.length;
  const foot = moves.n ? `<b>${moves.n} will move</b> from ${moves.names.slice(0, 4).map(esc).join(', ')}${moves.names.length > 4 ? ` and ${moves.names.length - 4} more` : ''}.` : n ? `${n} ticked.` : 'Tick the ones to attach.';
  return `<div class="at-scrim" data-at="close"><div class="at-dlg" role="dialog" aria-modal="true" aria-labelledby="at-h">
    <div class="at-h"><div class="at-tt"><h2 id="at-h">Attach existing ${esc(kids)}</h2><p class="at-sub">${sub}</p></div><button type="button" class="ibtn" data-at="close" aria-label="Close">✕</button></div>
    <div class="at-tools"><input id="at-q" class="in" type="search" data-ati="q" value="${esc(A.q)}" placeholder="Search every field" aria-label="Search ${esc(kids)}">
      <label class="switch"><input type="checkbox" data-ati="others" data-atf="others"${A.others ? ' checked' : ''}><span class="tr"></span><span>Include ${esc(kids)} attached elsewhere</span></label></div>
    <div class="at-chips"><span class="at-lab">Showing</span>${chipHTML || `<span class="at-none">${others ? 'All' : 'Unattached'} ${esc(kids)}</span>`}
      <button type="button" class="at-add" data-at="filter" data-atf="filter" aria-expanded="${A.pop ? 'true' : 'false'}">+ Filter</button>
      ${A.sug && A.sugOff ? `<button type="button" class="at-restore" data-at="restore">Use suggested match (${esc(fieldIn(childForm, A.sug.c.id)?.label || '')} is ${esc(A.sug.text)})</button>` : ''}
      ${popHTML(popField, d.values)}</div>
    <div class="at-list">${all.length ? `<table class="at-tbl"><thead>${head}</thead><tbody>${body}</tbody></table>${all.length > shown.length ? `<div class="at-more"><span>Showing ${shown.length} of ${all.length}</span><button type="button" class="btn sm" data-at="more">Show ${Math.min(PAGE, all.length - shown.length)} more</button></div>` : ''}` : `<p class="at-empty">${emptyMsg}</p>`}</div>
    <div class="at-foot"><p class="${moves.n ? 'at-warn' : 'at-count'}" role="status">${foot}${hiddenTicked ? ` <span class="at-hid">${hiddenTicked} of them ${hiddenTicked === 1 ? 'is' : 'are'} hidden by the filters or search.</span>` : ''}</p>
      <button type="button" class="btn ghost" data-at="close">Cancel</button><button type="button" class="btn primary" data-at="go" data-atf="go"${n && !A.busy ? '' : ' disabled'}>${n ? `Attach ${n} ${esc(nounOf(childForm, n))}` : 'Attach'}</button></div>
  </div></div>`;
}

/* ---------- picking a parent ---------- */

function parentHTML() {
  const { childForm, recs, skipped, parentForms, sug } = A;
  const pf = parentForms.find((f) => f.id === A.formId) || parentForms[0];
  const cols = listCols(pf, 2);
  const kidsOf = new Map();
  store.records.forEach((r) => { if (r.parentId) kidsOf.set(r.parentId, (kidsOf.get(r.parentId) || 0) + 1); });
  const sugHere = sug && sug.form.id === pf.id ? sug : null;
  const all = store.records.filter((r) => r.formId === pf.id && canEditRecord(store.me, r) && r.id !== sugHere?.parent.id)
    .filter((r) => searchHit(fullText(r), A.q))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const shown = all.slice(0, A.shown);
  if (A.choice && !all.some((r) => r.id === A.choice) && A.choice !== sugHere?.parent.id) A.choice = null;
  const choice = A.choice && H.recById(A.choice);
  const moving = recs.filter((r) => { const p = parentOf(r, H.recById); return p && p.id !== A.choice; }).length;
  const already = choice ? recs.filter((r) => r.parentId === choice.id).length : 0;
  const n = recs.length, kids = nounOf(childForm, n), pn = itemName(pf).toLowerCase();
  const row = (r) => {
    const on = A.choice === r.id;
    return `<tr class="${on ? 'on' : ''}" data-at="choose" data-v="${esc(r.id)}"><td class="at-ck"><label class="at-cklab"><input type="radio" name="at-parent" data-atc="choose" data-atf="c-${esc(r.id)}" data-v="${esc(r.id)}" aria-label="${esc(titleOf(r))}"${on ? ' checked' : ''}></label></td><td class="at-title">${esc(titleOf(r))}</td>${cols.map((f) => { const t = cellText(f, r, pf); return `<td title="${esc(t)}">${esc(t)}</td>`; }).join('')}<td class="num">${kidsOf.get(r.id) || 0}</td></tr>`;
  };
  const notes = [];
  if (moving) notes.push(`<b>${moving} ${moving === 1 ? 'is' : 'are'} attached elsewhere</b> and will move.`);
  if (already) notes.push(`${already} ${already === 1 ? 'is' : 'are'} already on it.`);
  if (skipped) notes.push(`${skipped} you can’t edit ${skipped === 1 ? 'is' : 'are'} skipped.`);
  if (sugHere && choice && choice.id !== sugHere.parent.id) notes.push(`The suggested match is ${esc(named(sugHere.parent))}.`);
  const go = n - already;
  let card = '';
  if (sugHere) {
    const p = sugHere.parent, on = A.choice === p.id;
    const why = `${esc(sugHere.c.label)} matches ${sugHere.n === sugHere.total ? (sugHere.total === 1 ? 'the ticked ' + esc(itemName(childForm).toLowerCase()) : 'all ' + sugHere.total + ' ticked') : sugHere.n + ' of the ' + sugHere.total + ' ticked'}.`;
    card = `<button type="button" class="at-sugcard${on ? ' on' : ''}" data-at="choose" data-v="${esc(p.id)}" data-atf="c-${esc(p.id)}" aria-pressed="${on}">
      <span class="at-sugic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/></svg></span>
      <span class="at-sugt"><span class="at-tag">Suggested</span><b>${esc(titleOf(p))}</b>${cols.map((f) => { const t = cellText(f, p, pf); return t ? `<span class="at-sugm">${esc(t)}</span>` : ''; }).join('')}<span class="at-sugw">${why}</span></span>
      <span class="at-radio${on ? ' on' : ''}" aria-hidden="true"></span></button>`;
  }
  return `<div class="at-scrim" data-at="close"><div class="at-dlg" role="dialog" aria-modal="true" aria-labelledby="at-h">
    <div class="at-h"><div class="at-tt"><h2 id="at-h">Attach ${n} ${esc(kids)} to…</h2><p class="at-sub">Pick the ${esc(pn)} they belong to.</p></div><button type="button" class="ibtn" data-at="close" aria-label="Close">✕</button></div>
    ${card ? `<div class="at-sugwrap">${card}</div>` : ''}
    <div class="at-tools">${parentForms.length > 1 ? `<select class="in at-auto" data-ati="form" data-atf="form" aria-label="Which form">${parentForms.map((f) => `<option value="${esc(f.id)}"${f.id === pf.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select>` : ''}
      <input id="at-q" class="in" type="search" data-ati="q" value="${esc(A.q)}" placeholder="${card ? 'Or search' : 'Search'} ${esc(nounOf(pf, 2))}" aria-label="Search ${esc(nounOf(pf, 2))}"></div>
    <div class="at-list">${all.length ? `<table class="at-tbl"><thead><tr><th class="at-ck"><span class="sr">Pick</span></th><th>${esc(H.titleFieldOf(pf)?.label || 'Title')}</th>${cols.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th class="num">${esc(childForm.name)}</th></tr></thead><tbody>${shown.map(row).join('')}</tbody></table>${all.length > shown.length ? `<div class="at-more"><span>Showing ${shown.length} of ${all.length}</span><button type="button" class="btn sm" data-at="more">Show ${Math.min(PAGE, all.length - shown.length)} more</button></div>` : ''}`
      : `<p class="at-empty">${A.q ? `Nothing matches “${esc(A.q)}”.` : card ? `No other ${esc(nounOf(pf, 2))} you can edit.` : `There are no ${esc(nounOf(pf, 2))} you can edit.`}</p>`}</div>
    <div class="at-foot"><p class="at-warn${notes.length ? '' : ' at-count'}" role="status">${notes.join(' ') || (choice ? '' : `Pick ${/^[aeiou]/.test(pn) ? 'an' : 'a'} ${esc(pn)}.`)}</p>
      <button type="button" class="btn ghost" data-at="close">Cancel</button><button type="button" class="btn primary" data-at="go" data-atf="go"${choice && go > 0 && !A.busy ? '' : ' disabled'}>${choice ? `Attach ${go} to ${esc(named(choice))}` : 'Attach'}</button></div>
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
  if (a === 'close') { if (el.classList.contains('at-scrim') && e.target !== el) { if (A.pop && !e.target.closest('.at-pop, [data-at="filter"]')) { A.pop = null; paint(); } return; } closeAttach(); return; }
  if (A.pop && !e.target.closest('.at-pop') && a !== 'filter') A.pop = null; // a click elsewhere closes the filter menu
  if (a === 'filter') { A.pop = A.pop ? null : 'fields'; paint(A.pop ? '.at-pop .at-opt' : '[data-atf="filter"]'); return; }
  if (a === 'field') { A.pop = el.dataset.v; paint('.at-pop [data-atc="val"], .at-pop [data-at="popback"]'); return; }
  if (a === 'popback') { A.pop = 'fields'; paint('.at-pop .at-opt'); return; }
  if (a === 'popdone') { A.pop = null; paint('[data-atf="filter"]'); return; }
  if (a === 'chipx') { if (el.dataset.v === 's') A.sugOff = true; else A.chips.splice(+el.dataset.v, 1); A.shown = PAGE; paint('[data-atf="filter"]'); return; }
  if (a === 'restore') { A.sugOff = false; A.shown = PAGE; paint('[data-atf="filter"]'); return; }
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
  else if (c === 'val') {
    const fid = A.pop, v = t.dataset.v;
    let ch = A.chips.find((x) => x.field === fid);
    if (!ch) { ch = { field: fid, labels: [] }; A.chips.push(ch); }
    ch.labels = t.checked ? [...new Set(ch.labels.concat(v))] : ch.labels.filter((x) => x !== v);
    if (!ch.labels.length) A.chips = A.chips.filter((x) => x !== ch);
    A.shown = PAGE; paint();
  }
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
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (A.pop) { A.pop = null; paint('[data-atf="filter"]'); } else closeAttach(); return; }
  if (e.key === 'Tab') { // keep focus inside the window
    const f = [...document.querySelectorAll('#at-root button:not(:disabled), #at-root input:not(:disabled), #at-root select')].filter((x) => x.offsetParent);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  }
}, true);
