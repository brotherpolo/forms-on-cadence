// Comments on a record, with @mentions, and My work → Mentions.
// Anyone who can see a record can comment on it (view-only too). Type @ to mention someone; the
// server (Cadence folder, functions/comments.js) emails them, puts it in their My work → Mentions
// and, when ticked, gives them a Cadence task, but only if they can open the record. You can
// edit and delete your own comments; administrators can delete any. Replies are one level deep.
// Comments aren't part of the record's PDF.
import { esc } from './ui.js';
import { threads, shownCount, mentionQuery, matchPeople, insertMention, mentionsIn, parts, notifyLine, notifiedNotes, canSeeRecord, initials, avatarColor, ago, unreadOf, MAX_TEXT } from './commentlogic.js';
import { watchComments, addComment, updateComment, deleteComment, markMentionsRead } from './store.js';

let H = null; // { store, view(), recById, formById, recTitle, itemName, toast, isAdmin, canUseTasks, foldBtn, folded(formId,key), unfold(formId,key), openRecord(id) }
const KEY = 'e:comments';
const S = { recordId: null, unsub: null, list: [], loaded: false, error: false, drafts: new Map(), editId: null, editText: '', editPicked: [], armed: null, busy: null, pop: null, flash: null, lit: null };

export function initComments(helpers) {
  H = helpers;
  const mine = (e) => e.target.closest?.('#rec-comments, #mw-mentions');
  document.addEventListener('click', (e) => {
    const inside = mine(e);
    // a Delete waiting for its second tap goes back to normal when you click anywhere else
    if (S.armed && !e.target.closest?.(`[data-cm="del"][data-id="${CSS.escape(S.armed)}"]`)) { S.armed = null; paint(); }
    if (inside) onClick(e);
  }, true);
  document.addEventListener('input', (e) => { if (e.target.dataset?.cmTa) { e.stopPropagation(); onInput(e.target); } }, true);
  document.addEventListener('change', (e) => { if (e.target.dataset?.cmTask !== undefined) { e.stopPropagation(); draft().task = e.target.checked; paintWho(); } }, true);
  document.addEventListener('keydown', (e) => { if (e.target.dataset?.cmTa) onKey(e); }, true);
  document.addEventListener('focusout', (e) => { if (e.target.dataset?.cmTa) setTimeout(() => { if (!document.activeElement?.dataset?.cmTa) closePop(); }, 120); });
  // picking from the list keeps the cursor in the box
  document.addEventListener('mousedown', (e) => { if (e.target.closest?.('[data-cm-pick]')) e.preventDefault(); }, true);
}

const me = () => H.store.user?.uid;
const myName = () => H.store.profiles?.[me()]?.displayName || H.store.me?.displayName || H.store.user?.displayName || (H.store.user?.email || '').split('@')[0] || 'Someone';
const nameOf = (uid, fallback) => H.store.profiles?.[uid]?.displayName || fallback || (uid === me() ? myName() : 'Someone');
const draft = (rid = S.recordId) => { if (!S.drafts.has(rid)) S.drafts.set(rid, { text: '', picked: [], replyTo: null, task: false, caret: 0 }); return S.drafts.get(rid); };

/** Everyone who could be mentioned. Administrators also see who can't open this record (off). */
function people(rec) {
  const out = new Map(), admin = H.isAdmin();
  Object.entries(H.store.profiles || {}).forEach(([uid, p]) => {
    if (!p || p.removed || uid === me()) return;
    out.set(uid, { uid, name: String(p.displayName || (p.email || '').split('@')[0] || 'Someone'), email: p.email || '' });
  });
  if (admin) (H.store.users || []).forEach((u) => {
    if (u.id === me()) return;
    const p = out.get(u.id) || { uid: u.id, name: String(H.store.profiles?.[u.id]?.displayName || u.displayName || (u.email || '').split('@')[0] || 'Someone'), email: u.email || '' };
    if (!p.email) p.email = u.email || '';
    p.off = !canSeeRecord(u, rec, u.id);
    if (!H.store.profiles?.[u.id]?.removed) out.set(u.id, p);
  });
  return [...out.values()];
}
const offSet = (rec) => new Set(people(rec).filter((p) => p.off).map((p) => p.uid));

/* ---------- Watching the open record's comments ---------- */
export function sync() {
  const v = H.view();
  const want = v.name === 'record' && v.recordId ? v.recordId : null;
  if (want === S.recordId) return;
  if (S.unsub) { S.unsub(); S.unsub = null; }
  Object.assign(S, { recordId: want, list: [], loaded: false, error: false, editId: null, armed: null, busy: null, pop: null });
  if (want) S.unsub = watchComments(want, (list) => { S.list = list; S.loaded = true; S.error = false; if (S.editId && !list.some((c) => c.id === S.editId)) S.editId = null; paint(); }, (err) => { console.error(err); S.loaded = true; S.error = true; paint(); });
}
export function stop() { if (S.unsub) S.unsub(); Object.assign(S, { recordId: null, unsub: null, list: [], loaded: false }); S.drafts.clear(); }

/* Keep the cursor where it was when the screen is drawn again. */
export function keep() {
  const a = document.activeElement;
  if (!a?.dataset?.cmTa) return null;
  return { ta: a.dataset.cmTa, s: a.selectionStart, e: a.selectionEnd, top: a.scrollTop };
}
export function restore(k) {
  if (!k) return;
  const t = document.querySelector(`[data-cm-ta="${k.ta}"]`);
  if (!t) return;
  t.focus({ preventScroll: true });
  try { t.setSelectionRange(k.s, k.e); } catch (e) { /* not a text box any more */ }
  t.scrollTop = k.top;
  if (S.pop && S.pop.ta === k.ta) paintPop();
}
function paint() {
  const el = document.getElementById('rec-comments');
  if (!el || H.view().recordId !== S.recordId) return;
  const k = keep();
  el.innerHTML = html();
  restore(k);
  flashIt();
}
function flashIt() {
  if (!S.flash) return;
  const c = document.getElementById('cm-' + S.flash);
  if (!c) { if (S.loaded) S.flash = null; return; }
  const id = S.flash;
  S.flash = null;
  S.lit = { id, until: Date.now() + 2400 }; // kept through redraws until it fades
  c.classList.add('cm-flash');
  c.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => { if (S.lit?.id === id) S.lit = null; document.getElementById('cm-' + id)?.classList.remove('cm-flash'); }, 2400);
}
export const afterRender = () => flashIt();

/* ---------- The Comments section ---------- */
export function html() {
  sync();
  const rec = H.recById(S.recordId);
  if (!rec) return '';
  const form = H.formById(rec.formId);
  const n = shownCount(S.list);
  const open = !H.folded(rec.formId, KEY);
  const last = S.list.length ? S.list.reduce((a, b) => ((b.at || 0) > (a.at || 0) ? b : a)) : null;
  const head = `<div class="section-h"><h2>${H.foldBtn(KEY, open, `<span class="badge cm-badge" aria-hidden="true">“</span><span>Comments</span> <span class="count">${n || ''}</span>`, last ? `latest ${ago(last.at)}` : 'none yet')}</h2></div>`;
  if (!open) return `<section class="section" id="comments">${head}</section>`;
  const body = !S.loaded ? '<p class="note cm-empty">Loading comments…</p>'
    : S.error ? '<p class="note cm-empty">Comments couldn’t be loaded. The latest security rules may not be deployed yet.</p>'
      : n ? `<div class="cm-list">${threads(S.list).map(({ c, reply }) => commentHTML(c, reply, rec)).join('')}</div>`
        : `<p class="note cm-empty">No comments yet. Start the conversation about this ${esc(H.itemName(form).toLowerCase())}; type @ to bring someone in.</p>`;
  return `<section class="section" id="comments">${head}<div class="panel subsec cm-panel">${body}${S.error ? '' : composerHTML(rec)}</div></section>`;
}

function textHTML(c) {
  return parts(c.text, c.mentions).map((p) => (p.uid ? `<span class="cm-pill${p.uid === me() ? ' me' : ''}">${esc(p.t)}</span>` : esc(p.t))).join('');
}
function avatar(uid, name, small) {
  return `<span class="cm-av${small ? ' sm' : ''}" style="background:${avatarColor(uid)}" aria-hidden="true">${esc(initials(name))}</span>`;
}

function commentHTML(c, reply, rec) {
  const mine = c.by === me(), admin = H.isAdmin();
  const name = nameOf(c.by, c.byName);
  const editing = S.editId === c.id;
  const armed = S.armed === c.id;
  const busy = S.busy === c.id;
  const notes = (mine || admin) ? notifiedNotes(c) : [];
  const full = new Date(c.at || 0).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const acts = editing ? '' : `<div class="cm-acts">
      <button type="button" class="cm-lnk" data-cm="reply" data-id="${esc(c.id)}">Reply</button>
      ${mine ? `<button type="button" class="cm-lnk" data-cm="edit" data-id="${esc(c.id)}">Edit</button>` : ''}
      ${mine || admin ? `<button type="button" class="cm-lnk danger${armed ? ' armed' : ''}" data-cm="del" data-id="${esc(c.id)}"${busy ? ' disabled' : ''}>${busy ? 'Deleting…' : armed ? 'Tap again to delete' : 'Delete'}</button>` : ''}
    </div>`;
  const text = editing
    ? `<div class="cm-edit"><div class="cm-tawrap"><textarea class="in cm-ta" data-cm-ta="edit" rows="3" maxlength="${MAX_TEXT}" aria-label="Edit your comment" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="cm-pop-edit">${esc(S.editText)}</textarea><div class="cm-pop" id="cm-pop-edit" role="listbox" aria-label="People" hidden></div></div>
        <div class="cm-row"><button type="button" class="btn sm primary" data-cm="save-edit"${S.busy === 'edit' ? ' disabled' : ''}>${S.busy === 'edit' ? 'Saving…' : 'Save'}</button><button type="button" class="btn sm ghost" data-cm="cancel-edit">Cancel</button><span class="help">Anyone you add gets told; people already mentioned aren’t told again.</span></div></div>`
    : `<p class="cm-x">${textHTML(c)}</p>`;
  const lit = S.lit && S.lit.id === c.id && Date.now() < S.lit.until;
  return `<article class="cm-c${reply ? ' cm-r' : ''}${mine ? ' mine' : ''}${lit ? ' cm-flash' : ''}" id="cm-${esc(c.id)}">
    ${avatar(c.by, name, reply)}
    <div class="cm-b">
      <div class="cm-h"><b>${esc(name)}</b><time datetime="${new Date(c.at || 0).toISOString()}" title="${esc(full)}">${esc(ago(c.at || 0))}</time>${c.editedAt ? `<span class="cm-ed" title="Edited ${esc(new Date(c.editedAt).toLocaleString())}">edited</span>` : ''}${c.task && (c.mentions || []).length ? '<span class="cm-tag" title="The people mentioned were also given a Cadence task">+ task</span>' : ''}</div>
      ${text}
      ${notes.map((x) => `<p class="cm-note">${esc(x)}</p>`).join('')}
      ${acts}
    </div>
  </article>`;
}

function composerHTML(rec) {
  const d = draft();
  const parent = d.replyTo ? S.list.find((c) => c.id === d.replyTo) : null;
  if (d.replyTo && !parent) d.replyTo = null;
  const busy = S.busy === 'post';
  const tasks = H.canUseTasks();
  return `<div class="cm-new">
    ${parent ? `<div class="cm-replying">Replying to <b>${esc(nameOf(parent.by, parent.byName))}</b><button type="button" class="cm-lnk" data-cm="cancel-reply">Cancel</button></div>` : ''}
    <div class="cm-tawrap">${avatar(me(), myName())}<textarea class="in cm-ta" data-cm-ta="new" rows="${d.text ? 3 : 2}" maxlength="${MAX_TEXT}" placeholder="Write a comment. Type @ to mention someone." aria-label="${parent ? 'Write a reply' : 'Write a comment'}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="cm-pop-new"${busy ? ' disabled' : ''}>${esc(d.text)}</textarea><div class="cm-pop" id="cm-pop-new" role="listbox" aria-label="People" hidden></div></div>
    <div class="cm-foot">
      ${tasks ? `<label class="cm-task"><input type="checkbox" data-cm-task${d.task ? ' checked' : ''}> Also give the people I mention a Cadence task</label>` : ''}
      <span class="cm-who" id="cm-who" role="status">${esc(whoLine(rec))}</span>
      <button type="button" class="btn primary" data-cm="post"${busy ? ' disabled' : ''}>${busy ? 'Posting…' : parent ? 'Reply' : 'Comment'}</button>
    </div>
  </div>`;
}
function whoLine(rec) {
  const d = draft();
  const ms = mentionsIn(d.text, d.picked, people(rec));
  return notifyLine(ms, { task: d.task && H.canUseTasks(), off: offSet(rec) });
}
function paintWho() { const w = document.getElementById('cm-who'); const rec = H.recById(S.recordId); if (w && rec) w.textContent = whoLine(rec); }

/* ---------- The @ list ---------- */
function onInput(t) {
  const which = t.dataset.cmTa;
  if (which === 'new') { const d = draft(); d.text = t.value; d.caret = t.selectionStart; paintWho(); }
  else S.editText = t.value;
  const q = mentionQuery(t.value, t.selectionStart);
  if (!q) { closePop(); return; }
  const rec = H.recById(S.recordId);
  const items = matchPeople(people(rec), q.q, 8);
  if (!items.length) { closePop(); return; }
  const keepIdx = S.pop && S.pop.ta === which && S.pop.q === q.q ? S.pop.idx : 0;
  S.pop = { ta: which, q: q.q, start: q.start, caret: t.selectionStart, items, idx: Math.min(keepIdx, items.length - 1) };
  const firstOk = items.findIndex((p) => !p.off);
  if (items[S.pop.idx]?.off && firstOk >= 0) S.pop.idx = firstOk;
  paintPop();
}
function paintPop() {
  document.querySelectorAll('.cm-pop').forEach((p) => { if (!S.pop || p.id !== 'cm-pop-' + S.pop.ta) { p.hidden = true; p.innerHTML = ''; } });
  document.querySelectorAll('[data-cm-ta]').forEach((t) => { t.setAttribute('aria-expanded', String(!!S.pop && t.dataset.cmTa === S.pop.ta)); if (!S.pop || t.dataset.cmTa !== S.pop.ta) t.removeAttribute('aria-activedescendant'); });
  if (!S.pop) return;
  const el = document.getElementById('cm-pop-' + S.pop.ta);
  if (!el) return;
  el.innerHTML = S.pop.items.map((p, i) => `<button type="button" role="option" id="cm-opt-${i}" class="cm-opt${i === S.pop.idx ? ' on' : ''}" data-cm-pick="${i}" aria-selected="${i === S.pop.idx}"${p.off ? ' aria-disabled="true"' : ''} tabindex="-1">${avatar(p.uid, p.name, true)}<span class="grow">${esc(p.name)}</span>${p.off ? '<small>can’t see this record</small>' : p.email ? `<small>${esc(p.email)}</small>` : ''}</button>`).join('');
  el.hidden = false;
  document.querySelector(`[data-cm-ta="${S.pop.ta}"]`)?.setAttribute('aria-activedescendant', 'cm-opt-' + S.pop.idx);
  el.querySelector('.cm-opt.on')?.scrollIntoView({ block: 'nearest' });
}
function closePop() { if (!S.pop) return; S.pop = null; paintPop(); }
function pick(i) {
  const p = S.pop?.items[i];
  if (!p) return;
  if (p.off) { H.toast(`${p.name} can’t see this record, so they won’t be told. Give them access in Security groups first.`); return; }
  const t = document.querySelector(`[data-cm-ta="${S.pop.ta}"]`);
  if (!t) return;
  const r = insertMention(t.value, S.pop.start, t.selectionStart, p.name);
  t.value = r.text;
  t.setSelectionRange(r.caret, r.caret);
  if (S.pop.ta === 'new') { const d = draft(); d.text = r.text; d.caret = r.caret; d.picked = d.picked.filter((x) => x.uid !== p.uid).concat({ uid: p.uid, name: p.name }); paintWho(); }
  else { S.editText = r.text; S.editPicked = S.editPicked.filter((x) => x.uid !== p.uid).concat({ uid: p.uid, name: p.name }); }
  closePop();
  t.focus();
}

function onKey(e) {
  const t = e.target, which = t.dataset.cmTa;
  if (S.pop && S.pop.ta === which) {
    const n = S.pop.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); S.pop.idx = (S.pop.idx + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; paintPop(); return; }
    if ((e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); pick(S.pop.idx); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(); return; }
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); if (which === 'new') post(); else saveEdit(); return; }
  if (e.key === 'Escape') {
    if (which === 'edit') { e.preventDefault(); e.stopPropagation(); const id = S.editId; S.editId = null; paint(); document.querySelector(`[data-cm="edit"][data-id="${CSS.escape(id || '')}"]`)?.focus(); return; }
    const d = draft();
    if (d.replyTo) { e.preventDefault(); e.stopPropagation(); cancelReply(); }
  }
}

/* ---------- Clicks ---------- */
function onClick(e) {
  const pk = e.target.closest('[data-cm-pick]');
  if (pk) { e.stopPropagation(); pick(Number(pk.dataset.cmPick)); return; }
  const el = e.target.closest('[data-cm]');
  if (!el) return;
  e.stopPropagation();
  const a = el.dataset.cm, id = el.dataset.id;
  if (a === 'post') post();
  else if (a === 'reply') startReply(id);
  else if (a === 'cancel-reply') cancelReply();
  else if (a === 'edit') { const c = S.list.find((x) => x.id === id); if (!c || c.by !== me()) return; S.editId = id; S.editText = c.text || ''; S.editPicked = [...(c.mentions || [])]; S.armed = null; paint(); const t = document.querySelector('[data-cm-ta="edit"]'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
  else if (a === 'cancel-edit') { S.editId = null; paint(); }
  else if (a === 'save-edit') saveEdit();
  else if (a === 'del') remove(id);
  else if (a === 'm-open') openMention(id);
  else if (a === 'm-all') markAll();
}

function startReply(id) {
  const c = S.list.find((x) => x.id === id);
  if (!c) return;
  const root = c.parent || c.id;
  const d = draft();
  d.replyTo = root;
  if (c.by !== me()) {
    const name = nameOf(c.by, c.byName);
    const at = '@' + name + ' ';
    if (!d.text.includes('@' + name)) d.text = at + d.text.replace(/^\s+/, '');
    d.picked = d.picked.filter((x) => x.uid !== c.by).concat({ uid: c.by, name });
  }
  S.editId = null;
  paint();
  const t = document.querySelector('[data-cm-ta="new"]');
  if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(t.value.length, t.value.length); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
}
function cancelReply() {
  const d = draft();
  const parent = S.list.find((c) => c.id === d.replyTo);
  if (parent) { const at = '@' + nameOf(parent.by, parent.byName) + ' '; if (d.text.trim() === at.trim()) d.text = ''; }
  d.replyTo = null;
  paint();
  document.querySelector('[data-cm-ta="new"]')?.focus();
}

async function post() {
  const rec = H.recById(S.recordId);
  const d = draft();
  const text = d.text.trim();
  if (!rec || S.busy) return;
  if (!text) { H.toast('Write something first.'); document.querySelector('[data-cm-ta="new"]')?.focus(); return; }
  const mentions = mentionsIn(text, d.picked, people(rec));
  const rid = S.recordId;
  S.busy = 'post'; closePop(); paint();
  try {
    await addComment(rid, { byName: myName(), text: text.slice(0, MAX_TEXT), mentions, parent: d.replyTo || null, task: !!(d.task && H.canUseTasks() && mentions.length) });
    S.drafts.set(rid, { text: '', picked: [], replyTo: null, task: false, caret: 0 });
  } catch (err) {
    console.error(err);
    H.toast(err?.code === 'permission-denied' ? 'The comment wasn’t posted: the latest security rules may not be deployed yet.' : 'The comment wasn’t posted. Check your connection and try again.');
  }
  S.busy = null; paint();
  document.querySelector('[data-cm-ta="new"]')?.focus({ preventScroll: true });
}

async function saveEdit() {
  const rec = H.recById(S.recordId), id = S.editId;
  const text = S.editText.trim();
  if (!rec || !id || S.busy) return;
  if (!text) { H.toast('A comment can’t be empty. Delete it instead.'); return; }
  const c = S.list.find((x) => x.id === id);
  if (c && text === c.text) { S.editId = null; paint(); return; }
  S.busy = 'edit'; closePop(); paint();
  try {
    await updateComment(S.recordId, id, { text: text.slice(0, MAX_TEXT), mentions: mentionsIn(text, S.editPicked, people(rec)) });
    S.editId = null;
  } catch (err) { console.error(err); H.toast('Your change wasn’t saved. Try again.'); }
  S.busy = null; paint();
}

async function remove(id) {
  const c = S.list.find((x) => x.id === id);
  if (!c || !(c.by === me() || H.isAdmin())) return;
  if (S.armed !== id) { S.armed = id; paint(); document.querySelector(`[data-cm="del"][data-id="${CSS.escape(id)}"]`)?.focus(); return; }
  S.armed = null; S.busy = id; paint();
  try { await deleteComment(S.recordId, id); H.toast(c.parent ? 'Reply deleted' : S.list.some((x) => x.parent === id) ? 'Comment and its replies deleted' : 'Comment deleted'); }
  catch (err) { console.error(err); H.toast('It wasn’t deleted. Try again.'); }
  S.busy = null; paint();
}

/* ---------- My work → Mentions ---------- */
export const unreadCount = () => unreadOf(H?.store.mentions).length;

export function mentionsHTML() {
  const list = H.store.mentions || [];
  const unread = unreadOf(list).length;
  if (!list.length) return `<div id="mw-mentions" class="panel empty"><h2>No mentions yet</h2><p>When someone types @ and your name in a comment on a record, it shows up here, and you get an email.</p></div>`;
  const row = (m) => {
    const f = H.formById(m.formId), rec = H.recById(m.recordId);
    const title = rec && f ? H.recTitle(rec, f) : m.recordTitle || 'a record';
    const by = nameOf(m.by, m.byName);
    return `<button type="button" class="mw-m${m.read ? '' : ' unread'}" data-cm="m-open" data-id="${esc(m.id)}">
      <span class="mw-dot" aria-hidden="true"></span>${avatar(m.by, by)}
      <span class="mw-b"><span class="mw-1"><b>${esc(by)}</b> mentioned you on <b>${esc(title)}</b> <span class="mw-f">· ${esc(f?.name || m.formName || '')}</span>${m.read ? '' : '<span class="sr"> (unread)</span>'}</span>
      <span class="mw-2">${esc(m.snippet || '')}</span></span>
      <time datetime="${new Date(m.at || 0).toISOString()}">${esc(ago(m.at || 0))}</time></button>`;
  };
  return `<div id="mw-mentions" class="panel mw-panel">
    <div class="mw-top"><span class="grow help">Comments where someone mentioned you, newest first.</span>${unread ? `<button type="button" class="cm-lnk" data-cm="m-all">Mark all as read</button>` : ''}</div>
    <div class="mw-list">${list.map(row).join('')}</div></div>`;
}

export async function openMention(id) {
  const m = (H.store.mentions || []).find((x) => x.id === id);
  if (!m) return;
  if (!m.read) markMentionsRead([id]).catch((e) => console.error(e));
  showComment(m.recordId, m.commentId);
}
/** Open a record at one of its comments (highlighted). */
export function showComment(recordId, commentId) {
  const rec = H.recById(recordId);
  if (!rec) { H.toast('That record was deleted, or you can no longer see it.'); return; }
  S.flash = commentId;
  if (H.folded(rec.formId, KEY)) H.unfold(rec.formId, KEY);
  H.openRecord(recordId);
}
async function markAll() {
  const ids = unreadOf(H.store.mentions).map((m) => m.id);
  if (!ids.length) return;
  try { await markMentionsRead(ids); } catch (e) { console.error(e); H.toast('That didn’t work. Try again.'); }
}
