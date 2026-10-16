// Comments on a record and @mentions: the pure parts (no DOM, no Firebase), so they can be
// tested on their own. The screen is in comments.js; the server side is in the Cadence
// folder (functions/comments.js), which also decides who can see a record when it notifies.

export const MAX_TEXT = 5000;
export const MAX_MENTIONS = 20;

/** Comments in reading order: each comment, then its replies, oldest first. Replies to a removed comment are left out. */
export function threads(list) {
  const all = (list || []).filter(Boolean);
  const byAt = (a, b) => (a.at || 0) - (b.at || 0) || String(a.id).localeCompare(String(b.id));
  const roots = all.filter((c) => !c.parent).sort(byAt);
  const ids = new Set(roots.map((c) => c.id));
  const kids = new Map();
  all.filter((c) => c.parent && ids.has(c.parent)).forEach((c) => { if (!kids.has(c.parent)) kids.set(c.parent, []); kids.get(c.parent).push(c); });
  const out = [];
  roots.forEach((c) => { out.push({ c, reply: false }); (kids.get(c.id) || []).sort(byAt).forEach((r) => out.push({ c: r, reply: true })); });
  return out;
}

/** How many comments show (replies to a removed comment don't). */
export const shownCount = (list) => threads(list).length;

/**
 * The @word being typed just before the caret, if any: { q, start } where start is the "@".
 * Allows one space so "@Sam L" still finds Sam Lee.
 */
export function mentionQuery(text, caret) {
  const before = String(text || '').slice(0, caret == null ? String(text || '').length : caret);
  const m = /(^|[\s(\[{"'“‘])@([^\s@]{0,40}(?: [^\s@]{0,40})?)$/u.exec(before);
  if (!m) return null;
  return { q: m[2], start: before.length - m[2].length - 1 };
}

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** People whose name (any word of it) or email starts with q, best first, at most n. */
export function matchPeople(people, q, n = 8) {
  const w = fold(q).trim();
  const scored = [];
  for (const p of people || []) {
    const name = fold(p.name);
    let s = -1;
    if (!w) s = 1;
    else if (name.startsWith(w)) s = 3;
    else if (name.split(/\s+/).some((x) => x.startsWith(w))) s = 2;
    else if (fold(p.email).startsWith(w)) s = 1;
    if (s >= 0) scored.push({ p, s });
  }
  scored.sort((a, b) => (a.p.off ? 1 : 0) - (b.p.off ? 1 : 0) || b.s - a.s || String(a.p.name).localeCompare(String(b.p.name)));
  return scored.slice(0, n).map((x) => x.p);
}

/** Put "@Name " in place of the @word being typed. Returns the new text and where the caret goes. */
export function insertMention(text, start, caret, name) {
  const t = String(text || '');
  const ins = '@' + name + ' ';
  const after = t.slice(caret).replace(/^ /, '');
  return { text: t.slice(0, start) + ins + after, caret: start + ins.length };
}

/**
 * Who a comment mentions, in the order they appear: at each "@", the longest name that follows it
 * ("@Sam Lee" is Sam Lee, not Sam). Someone picked from the list wins over a namesake typed
 * out. Each person once, at most 20. picked: [{uid, name}], people: [{uid, name}].
 */
export function mentionsIn(text, picked = [], people = []) {
  const t = String(text || '');
  const cands = [...(picked || []).map((p) => ({ ...p, pk: 1 })), ...(people || []).map((p) => ({ ...p, pk: 0 }))]
    .filter((p) => p && p.uid && p.name)
    .sort((a, b) => b.name.length - a.name.length || b.pk - a.pk);
  const out = [], uids = new Set();
  for (let i = t.indexOf('@'); i >= 0; i = t.indexOf('@', i + 1)) {
    const hit = cands.find((p) => t.startsWith('@' + p.name, i) && !/[\p{L}\p{N}]/u.test(t.charAt(i + p.name.length + 1)));
    if (!hit || uids.has(hit.uid)) continue;
    uids.add(hit.uid);
    out.push({ uid: hit.uid, name: hit.name });
  }
  return out.slice(0, MAX_MENTIONS);
}

/** The text in pieces, with each mention marked: [{t}, {t: '@Sam Lee', uid: 'sam'}, …]. */
export function parts(text, mentions = []) {
  const t = String(text || '');
  const ms = (mentions || []).filter((m) => m && m.name).sort((a, b) => b.name.length - a.name.length);
  const out = [];
  let i = 0, plainFrom = 0;
  while (i < t.length) {
    let hit = null;
    if (t[i] === '@') for (const m of ms) {
      const at = '@' + m.name;
      if (t.startsWith(at, i) && !/[\p{L}\p{N}]/u.test(t.charAt(i + at.length))) { hit = m; break; }
    }
    if (hit) {
      if (i > plainFrom) out.push({ t: t.slice(plainFrom, i) });
      out.push({ t: '@' + hit.name, uid: hit.uid });
      i += hit.name.length + 1; plainFrom = i;
    } else i++;
  }
  if (plainFrom < t.length) out.push({ t: t.slice(plainFrom) });
  return out;
}

/** "Sam", "Sam and Kim", "Sam, Kim and Lee", "Sam, Kim and 3 others". */
export function andList(names, max = 3) {
  const n = (names || []).filter(Boolean);
  if (n.length <= 1) return n[0] || '';
  if (n.length <= max) return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  return n.slice(0, max - 1).join(', ') + ' and ' + (n.length - max + 1) + ' others';
}
const first = (name) => String(name || '').split(/\s+/)[0] || name;

/**
 * The line beside the Comment button: who will hear about it.
 * mentions: [{uid,name}]; off: Set of uids who can't see the record (known to admins only).
 */
export function notifyLine(mentions, { task = false, off = new Set() } = {}) {
  const ok = (mentions || []).filter((m) => !off.has(m.uid));
  const no = (mentions || []).filter((m) => off.has(m.uid));
  const bits = [];
  if (ok.length) bits.push(`${andList(ok.map((m) => first(m.name)))} will get an email${task ? ' and a Cadence task' : ''}`);
  if (no.length) bits.push(`${andList(no.map((m) => first(m.name)))} can’t see this record`);
  return bits.join('. ') + (bits.length ? '.' : '');
}

/** Notes under a comment for the people who weren't told: "Sam can’t see this record and wasn’t notified." */
export function notifiedNotes(comment) {
  const done = (comment && comment.notified) || {};
  const nameOf = (uid) => ((comment.mentions || []).find((m) => m.uid === uid) || {}).name || 'Someone';
  const no = Object.keys(done).filter((u) => done[u] === 'no-access').map(nameOf);
  const gone = Object.keys(done).filter((u) => done[u] === 'gone').map(nameOf);
  const out = [];
  if (no.length) out.push(`${andList(no, 4)} can’t see this record and ${no.length === 1 ? 'wasn’t' : 'weren’t'} notified.`);
  if (gone.length) out.push(`${andList(gone, 4)} no longer ${gone.length === 1 ? 'has an account' : 'have accounts'} and ${gone.length === 1 ? 'wasn’t' : 'weren’t'} notified.`);
  return out;
}

/** Whether someone can open a record (the same test as the security rules and the server). */
export function canSeeRecord(user, rec, uid) {
  if (!user || !rec) return false;
  if ((user.role || 'member') === 'admin') return true;
  const acc = user.access || {};
  const lv = acc[rec.formId] || acc['*'] || {};
  if (lv.view === 'all') return true;
  if (lv.view === 'own' && rec.ownerId === uid) return true;
  if (rec.assignee && rec.assignee === uid) return true;
  if (rec.assigneeGroup && (user.groups || []).includes(rec.assigneeGroup)) return true;
  return false;
}

/** "AP" from "Adam Pollack", "S" from "sam". */
export function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return ((w[0][0] || '') + (w.length > 1 ? w[w.length - 1][0] || '' : '')).toUpperCase();
}

/** A steady colour for a person (the same everywhere). */
const AV = ['#3346c8', '#0f7a5c', '#c2610c', '#7434b0', '#b42367', '#1f6f9a', '#8a6a00', '#4b5563'];
export function avatarColor(uid) {
  let h = 0;
  for (const ch of String(uid || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return AV[h % AV.length];
}

/** "just now", "5 min ago", "3 h ago", "Yesterday", then the date. */
export function ago(t, now = Date.now(), dateOf = (x) => new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  const d = new Date(t), n = new Date(now);
  if (s < 86400 && d.getDate() === n.getDate()) return Math.floor(s / 3600) + ' h ago';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return dateOf(t);
}

/** The mentions not read yet. */
export const unreadOf = (mentions) => (mentions || []).filter((m) => !m.read);
