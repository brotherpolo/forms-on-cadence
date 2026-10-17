// My work → All mentions and All tasks (administrators): filtering and ordering. Pure, unit-tested.

/** Mentions for a person (mentioned or mentioning) and/or unread only; newest first. */
export function filterMentions(list, { who = '', unread = false } = {}) {
  return (list || [])
    .filter((m) => (!who || m.to === who || m.by === who) && (!unread || !m.read))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

/** Tasks for a person (assigned or owner), a form, and open / done / all. */
export function filterTasks(list, { who = '', form = '', status = 'open' } = {}) {
  return (list || []).filter((t) => t && t.recordId
    && (!who || t.assigneeId === who || t.ownerId === who || (t.assigneeRole && 'role:' + t.assigneeRole === who))
    && (!form || t.formId === form)
    && (status === 'all' || (status === 'done' ? !!t.done : !t.done)));
}

/** Open before done; overdue first, then by due date (no date last), then oldest first. */
export function sortTasks(list, todayKey) {
  const rank = (t) => (t.done ? 3 : !t.due ? 2 : t.due < todayKey ? 0 : 1);
  return [...(list || [])].sort((a, b) => rank(a) - rank(b) || String(a.due || '9').localeCompare(String(b.due || '9')) || (a.createdAt || 0) - (b.createdAt || 0));
}

/** Who a task is with: its assignee, or its owner when it's assigned to nobody. */
export const holder = (t) => (t.assigneeId ? { uid: t.assigneeId, name: t.assigneeName || t.assigneeEmail || 'someone' } : t.assigneeRole ? { uid: 'role:' + t.assigneeRole, name: `${t.assigneeRoleName || 'A role'} (role)`, role: true } : { uid: t.ownerId, name: t.ownerName || t.ownerEmail || 'the owner' });
