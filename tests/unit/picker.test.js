// The person picker (Reassign, a task's Assigned to): rows, order, search and open-task counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRows, pickMatch, openCounts, SEARCH_FROM } from '../../src/pickerlogic.js';

const P = (uid, name, ok = true, email = uid + '@x.example') => ({ uid, name, email, ok });

test('leaves out excluded people and duplicates; people who can be picked first, A–Z', () => {
  const r = pickRows([P('z', 'Zed'), P('a', 'Adam'), P('d', 'Dana', false), P('b', 'Bea'), P('a', 'Adam')], { exclude: ['b'] });
  assert.deepEqual(r.rows.map((p) => p.uid), ['a', 'z', 'd']);
});

test('search box only from six rows, pinned rows counted', () => {
  const five = ['a', 'b', 'c', 'd', 'e'].map((u) => P(u, u.toUpperCase()));
  assert.equal(SEARCH_FROM, 6);
  assert.equal(pickRows(five).search, false);
  assert.equal(pickRows(five, { pinned: [{ uid: '__owner', name: 'Back to owner', ok: true }] }).search, true);
});

test('search matches every word in the name or email, any case', () => {
  const p = P('u1', 'Farren Applebaum', true, 'farrenapplebaum@gmail.com');
  assert.ok(pickMatch(p, ''));
  assert.ok(pickMatch(p, 'farr'));
  assert.ok(pickMatch(p, 'APPLE far'));
  assert.ok(pickMatch(p, 'gmail'));
  assert.ok(!pickMatch(p, 'adam'));
});

test('open tasks per person: the assignee, or the owner when unassigned; done ones skipped', () => {
  assert.deepEqual(openCounts([
    { ownerId: 'a', assigneeId: 'b', done: false },
    { ownerId: 'a', assigneeId: null, done: false },
    { ownerId: 'a', assigneeId: 'b', done: true },
    { ownerId: 'c', assigneeId: 'b', done: false },
  ]), { b: 2, a: 1 });
});
