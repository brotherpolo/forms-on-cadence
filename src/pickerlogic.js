// Choosing a person (Reassign, a task's "Assigned to"): which rows show, in what order, and whether
// there are enough people to need a search box. No DOM here, so it can be tested on its own.

/** Lowercase text a search compares against. */
export const pickText = (p) => `${p?.name || ''} ${p?.email || ''}`.toLowerCase();
/** Does this row match what's typed? Every word must appear (in the name or the email). */
export function pickMatch(p, q) {
  const words = String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const t = pickText(p);
  return words.every((w) => t.includes(w));
}
/** More people than this and a search box appears. */
export const SEARCH_FROM = 6;
/**
 * people: [{ uid, name, email, ok }]; pinned: special rows shown first ({ uid, name, ok: true, icon });
 * exclude: uids left out (already covered by a pinned row, or who has it now).
 * → { pinned, rows, search }: people who can be picked first, then those who can't yet, A–Z within each.
 */
export function pickRows(people, { pinned = [], exclude = [] } = {}) {
  const ex = new Set(exclude.filter(Boolean));
  const seen = new Set();
  const rows = (people || []).filter((p) => p && p.uid && !ex.has(p.uid) && !seen.has(p.uid) && seen.add(p.uid))
    .sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0) || String(a.name || a.email).localeCompare(String(b.name || b.email)));
  return { pinned, rows, search: pinned.length + rows.length >= SEARCH_FROM };
}
/** Open tasks each person has right now (who it's assigned to, or its owner when unassigned). */
export function openCounts(tasks) {
  const n = {};
  (tasks || []).forEach((t) => { if (t && !t.done) { const who = t.assigneeId || t.ownerId; if (who) n[who] = (n[who] || 0) + 1; } });
  return n;
}
