// Live pop-ups while Formwright is open: what's new since the last look. Pure (no DOM), unit-tested;
// notices.js shows them. Only things that happen while the app is open pop up: what was already
// there when you signed in is in the My work badge instead.

/** How far back a workflow move can be and still count as new (other people's clocks drift). */
export const SKEW = 60e3;

/** Mentions that are new: not seen before, unread, and made since you opened the app. */
export function freshMentions(list, seen, since) {
  return (list || []).filter((m) => m && !seen.has(m.id) && !m.read && (m.at || 0) >= since - SKEW);
}

/** A record's place in a workflow: the same record arriving at another stage is new again. */
export const waitKey = (r) => `${r.id}:${r.stage}:${r.stageAt || 0}`;

/** Whether a record at a stage is waiting on me (or a group I'm in). */
export const waitsOn = (r, me, groups = []) => !!(r && r.stage && (r.assignee === me || (r.assigneeGroup && groups.includes(r.assigneeGroup))));

/**
 * Records that have just arrived at a stage that's yours: not seen before, moved since you opened
 * the app, by someone else (or an automation). wf(r) says whether its form has a workflow.
 */
export function freshWaiting(records, { me, groups = [], seen, since, wf = () => true }) {
  return (records || []).filter((r) => waitsOn(r, me, groups) && wf(r) && !seen.has(waitKey(r))
    && (r.stageAt || 0) >= since - SKEW && r.updatedBy !== me);
}
