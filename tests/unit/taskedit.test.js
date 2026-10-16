// Adding and editing Cadence tasks in Formwright (src/tasks.js): the same documents Cadence writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadenceLists, nextDue, mapNodes, newTaskDoc, editPatch, nextOccurrence, assignChoices, DEFAULT_LEVELS } from '../../src/tasks.js';

const me = { uid: 'u1', name: 'Adam', email: 'adam@x.example' }, bea = { uid: 'u2', name: 'Bea', email: 'bea@x.example' };
const lists = cadenceLists(null);
const link = { recordId: 'r1', formId: 'f1', recordSnap: { title: 'Lobby', form: 'Projects', color: '#0f7a5c' } };

test('lists: someone’s own, else Cadence’s starting ones', () => {
  assert.equal(lists.defLevel, 'lv-normal'); assert.equal(lists.levels, DEFAULT_LEVELS);
  const own = cadenceLists({ types: [{ id: 'a', name: 'A' }], levels: [{ id: 'l1', name: 'Top' }], defaultLevel: 'zz', defaultType: 'a' });
  assert.deepEqual([own.types.length, own.defLevel, own.defType], [1, 'l1', 'a']);
});

test('repeat dates as Cadence counts them', () => {
  assert.equal(nextDue('2026-10-16', 'daily'), '2026-10-17');
  assert.equal(nextDue('2026-10-16', 'weekdays'), '2026-10-19', 'Friday → Monday');
  assert.equal(nextDue('2026-10-16', 'weekly'), '2026-10-23');
  assert.equal(nextDue('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextDue(null, 'daily', '2026-10-16'), '2026-10-17');
  assert.equal(nextDue('2026-10-16', 'none'), null);
});

test('the map: nodes under their parents, titles cleaned, colours', () => {
  const map = { nodes: [{ id: 'a', label: '**Lobby**', color: 'blue' }, { id: 'b', label: 'Flooring', color: 'orange' }, { id: 'c', label: 'Orders\nand quotes' }, { id: 'd', label: 'Office' }, { id: 'e', label: '' }],
    edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'a', target: 'd', directed: true }] };
  assert.deepEqual(mapNodes(map).map((n) => [n.title, n.depth, n.parent]), [['Lobby', 0, ''], ['Flooring', 1, 'Lobby'], ['Orders and quotes', 2, 'Flooring'], ['Office', 0, '']]);
  assert.equal(mapNodes(map)[0].hex, '#3b82f6');
  assert.deepEqual(mapNodes(null), []);
});

test('a new task is what Cadence writes', () => {
  const t = newTaskDoc('t1', { title: ' Call supplier ', notes: 'n', due: '', time: '10:00', repeat: 'weekly', typeId: 'ty-work', levelId: 'lv-high', nodeId: 'b', subtasks: [{ id: 's1', title: 'x' }] }, me, null, link, lists, 5);
  assert.deepEqual([t.title, t.time, t.members, t.assigneeId, t.recordId, t.formId, t.nodeId, t.subtasks[0].done, t.ownerEmail], ['Call supplier', null, ['u1'], null, 'r1', 'f1', 'b', false, 'adam@x.example']);
  assert.ok(!('typeSnap' in t), 'no copy of names for my own task');
  const a = newTaskDoc('t2', { title: 'Go', typeId: 'ty-work', levelId: 'lv-high' }, me, bea, link, lists, 5);
  assert.deepEqual([a.members, a.assigneeEmail, a.typeSnap.name, a.levelSnap.color], [['u1', 'u2'], 'bea@x.example', 'Work', '#F08A24']);
});

test('editing: only what changed, only what you may, reschedules counted', () => {
  const old = newTaskDoc('t1', { title: 'A', due: '2026-10-16', levelId: 'lv-normal', typeId: 'ty-work' }, me, bea, link, lists, 1);
  const d = { title: 'A2', notes: '', due: '2026-10-20', time: '', repeat: 'none', typeId: 'ty-work', levelId: 'lv-normal', subtasks: [] };
  assert.deepEqual(Object.keys(editPatch(old, d, me, bea, false, lists, 9)).sort(), ['due', 'moved', 'pushed', 'updatedAt'], 'assignee: not the title');
  const p = editPatch(old, d, me, bea, true, lists, 9);
  assert.deepEqual([p.title, p.moved, p.pushed, 'assigneeId' in p], ['A2', 1, 4, false]);
  const back = editPatch(old, { ...d, title: 'A' , due: '2026-10-16' }, me, me, true, lists, 9);
  assert.deepEqual([back.assigneeId, back.members, back.typeSnap], [null, ['u1'], null], 'back to me');
  assert.deepEqual(editPatch(old, { title: 'A', notes: '', due: '2026-10-16', time: '', repeat: 'none', typeId: 'ty-work', levelId: 'lv-normal', subtasks: [] }, me, bea, true, lists, 9), {}, 'nothing changed');
});

test('ticking off a repeating task makes the next one', () => {
  const t = { ...newTaskDoc('t1', { title: 'Run', due: '2026-10-16', repeat: 'weekdays', subtasks: [{ id: 's', title: 'x', done: true }] }, me, null, link, lists, 1), done: true, moved: 2, doneBy: 'u1' };
  const n = nextOccurrence(t, 't9', 7, '2026-10-16');
  assert.deepEqual([n.id, n.due, n.done, n.spawnedFrom, n.subtasks[0].done, 'moved' in n, 'doneBy' in n, n.recordId], ['t9', '2026-10-19', false, 't1', false, false, false, 'r1']);
});

test('who it can go to: me first, then everyone else by name', () => {
  const c = assignChoices([{ uid: 'u3', name: 'Zed', ok: false }, bea, me], me, null);
  assert.deepEqual(c.map((x) => x.uid), ['u1', 'u2', 'u3']);
  assert.equal(c[0].me, true);
  assert.equal(assignChoices([], me, { uid: 'u7', name: 'Old' }).length, 2, 'the current assignee stays listed');
});

test('emails as Cadence keeps them: lowercase, trimmed', async () => {
  const { normEmail, newTaskDoc } = await import('../../src/tasks.js');
  assert.equal(normEmail(' Adam.Pollack@Gmail.com '), 'adam.pollack@gmail.com');
  assert.equal(normEmail(null), '');
  const t = newTaskDoc('t1', { title: 'x' }, { uid: 'a', name: 'A', email: normEmail('A@X.com') }, { uid: 'b', name: 'B', email: normEmail('B@X.com') }, null, {}, 1);
  assert.equal(t.ownerEmail, 'a@x.com');
  assert.equal(t.assigneeEmail, 'b@x.com');
});
