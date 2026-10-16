// Live pop-ups at the bottom of the screen while Formwright is open, like Cadence's:
// "Bea Martin mentioned you on Lobby renovation  [Open]" and "Lobby renovation is waiting on you
// at Review  [Open]". Several at once become one ("3 new mentions  [Show]"). What was already
// there when you signed in doesn't pop up; it's in My work.
import { toast, esc } from './ui.js';
import { freshMentions, freshWaiting, waitKey } from './noticelogic.js';

let H = null; // { store, recById, formById, recTitle, stageName, groupName, wfOn, openMention(id), openRecord(id), openMyWork(tab) }
const N = { since: 0, seenM: null, seenW: null };
const LONG = 8000;

export function initNotices(helpers) { H = helpers; reset(); }
export function reset() { Object.assign(N, { since: Date.now(), seenM: null, seenW: null }); }

/** Look for anything new (called whenever the data changes). */
export function check() {
  if (!H || !H.store.user) return;
  const me = H.store.user.uid, groups = H.store.me?.groups || [];
  // the first look only takes note of what's there
  if (!N.seenM) { N.seenM = new Set((H.store.mentions || []).map((m) => m.id)); }
  else {
    const fresh = freshMentions(H.store.mentions, N.seenM, N.since);
    (H.store.mentions || []).forEach((m) => N.seenM.add(m.id));
    if (fresh.length) showMentions(fresh);
  }
  const wf = (r) => H.wfOn(H.formById(r.formId));
  if (!N.seenW) N.seenW = new Set();
  const fresh = freshWaiting(H.store.records, { me, groups, seen: N.seenW, since: N.since, wf });
  (H.store.records || []).forEach((r) => { if (r.stage) N.seenW.add(waitKey(r)); });
  if (fresh.length) showWaiting(fresh, me);
}

function showMentions(list) {
  if (list.length > 1) { toast(`<b>${list.length} new mentions</b> in comments`, { html: true, action: 'Show', onAction: () => H.openMyWork('mentions'), duration: LONG }); return; }
  const m = list[0];
  const rec = H.recById(m.recordId), f = H.formById(m.formId);
  const title = rec && f ? H.recTitle(rec, f) : m.recordTitle || 'a record';
  const by = H.store.profiles?.[m.by]?.displayName || m.byName || 'Someone';
  toast(`<b>${esc(by)}</b> mentioned you on <b>${esc(title)}</b>`, { html: true, action: 'Open', onAction: () => H.openMention(m.id), duration: LONG });
}

function showWaiting(list, me) {
  if (list.length > 1) { toast(`<b>${list.length} records</b> are waiting on you`, { html: true, action: 'Show', onAction: () => H.openMyWork('waiting'), duration: LONG }); return; }
  const r = list[0], f = H.formById(r.formId);
  const who = r.assignee === me ? 'you' : `the ${H.groupName(r.assigneeGroup) || ''} group`.replace('the  group', 'your group');
  toast(`<b>${esc(H.recTitle(r, f))}</b> is waiting on ${esc(who)} at <b>${esc(H.stageName(f, r))}</b>`, { html: true, action: 'Open', onAction: () => H.openRecord(r.id), duration: LONG });
}
