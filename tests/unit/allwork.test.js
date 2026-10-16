// My work → All mentions / All tasks, and Reassign (src/allworklogic.js, src/tasks.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterMentions, filterTasks, sortTasks, holder } from '../../src/allworklogic.js';
import { reassignPatch, passChoices } from '../../src/tasks.js';

test('mentions: by person (either side), unread only, newest first', () => {
  const l = [{ id: 'a', to: 'sam', by: 'kim', at: 1, read: true }, { id: 'b', to: 'kim', by: 'adam', at: 3, read: false }, { id: 'c', to: 'adam', by: 'sam', at: 2, read: false }];
  assert.deepEqual(filterMentions(l).map((m) => m.id), ['b', 'c', 'a']);
  assert.deepEqual(filterMentions(l, { who: 'kim' }).map((m) => m.id), ['b', 'a']);
  assert.deepEqual(filterMentions(l, { unread: true }).map((m) => m.id), ['b', 'c']);
});

test('tasks: record tasks only, by person, form and status; overdue first', () => {
  const l = [
    { id: 'a', recordId: 'r', formId: 'f1', ownerId: 'adam', assigneeId: 'sam', due: '2026-10-20', done: false, createdAt: 1 },
    { id: 'b', recordId: 'r', formId: 'f2', ownerId: 'kim', assigneeId: null, due: '2026-10-01', done: false, createdAt: 2 },
    { id: 'c', recordId: 'r', formId: 'f1', ownerId: 'adam', assigneeId: 'kim', due: null, done: false, createdAt: 3 },
    { id: 'd', recordId: 'r', formId: 'f1', ownerId: 'adam', assigneeId: 'sam', due: '2026-09-01', done: true, createdAt: 4 },
    { id: 'e', recordId: null, ownerId: 'adam', done: false },
  ];
  assert.deepEqual(sortTasks(filterTasks(l), '2026-10-16').map((t) => t.id), ['b', 'a', 'c']);
  assert.deepEqual(filterTasks(l, { status: 'done' }).map((t) => t.id), ['d']);
  assert.deepEqual(filterTasks(l, { status: 'all', who: 'kim' }).map((t) => t.id).sort(), ['b', 'c']);
  assert.deepEqual(filterTasks(l, { form: 'f2' }).map((t) => t.id), ['b']);
  assert.deepEqual(holder(l[1]), { uid: 'kim', name: 'the owner' });
});

test('reassign: only who it’s with changes; back to the owner clears the assignee', () => {
  const t = { ownerId: 'adam', ownerName: 'Adam', assigneeId: 'sam' };
  assert.deepEqual(reassignPatch(t, { uid: 'kim', name: 'Kim', email: 'Kim@X.com' }, 'sam', 5), { assigneeId: 'kim', assigneeName: 'Kim', assigneeEmail: 'kim@x.com', members: ['adam', 'kim'], updatedAt: 5, reassignedBy: 'sam', reassignedAt: 5 });
  assert.deepEqual(reassignPatch(t, null, 'admin', 6).members, ['adam']);
  assert.equal(reassignPatch(t, { uid: 'adam', name: 'Adam' }, 'admin', 6).assigneeId, null, 'giving it to the owner = back to the owner');
});

test('the assignee’s choices: keep it, back to the owner, anyone else', () => {
  const c = passChoices([{ uid: 'adam', name: 'Adam', ok: true }, { uid: 'zoe', name: 'Zoe', ok: true }, { uid: 'bea', name: 'Bea', ok: false }, { uid: 'sam', name: 'Sam', ok: true }], { ownerId: 'adam', ownerName: 'Adam' }, { uid: 'sam', name: 'Sam' });
  assert.deepEqual(c.map((p) => [p.uid, !!p.me, !!p.owner]), [['sam', true, false], ['adam', false, true], ['bea', false, false], ['zoe', false, false]]);
});
