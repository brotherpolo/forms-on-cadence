// Live pop-ups: what counts as new.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshMentions, freshWaiting, waitKey, waitsOn, SKEW } from '../../src/noticelogic.js';

test('new mentions: unseen, unread, since the app opened', () => {
  const since = 1_000_000;
  const list = [
    { id: 'a', at: since + 5, read: false }, { id: 'b', at: since + 5, read: true }, { id: 'c', at: since - SKEW - 1, read: false },
    { id: 'd', at: since - 1000, read: false }, { id: 'e', at: since + 9, read: false },
  ];
  assert.deepEqual(freshMentions(list, new Set(['e']), since).map((m) => m.id), ['a', 'd']);
  assert.deepEqual(freshMentions(null, new Set(), since), []);
});

test('records that just became mine', () => {
  const since = 1_000_000, me = 'u1';
  const r = (id, x) => ({ id, formId: 'f', stage: 's2', stageAt: since + 10, assignee: me, updatedBy: 'u2', ...x });
  const recs = [r('a'), r('b', { updatedBy: me }), r('c', { assignee: 'u3' }), r('d', { assignee: null, assigneeGroup: 'g1' }), r('e', { stageAt: since - SKEW - 5 }), r('f', { stage: null }), r('g', { formId: 'nowf' })];
  const seen = new Set();
  const got = freshWaiting(recs, { me, groups: ['g1'], seen, since, wf: (x) => x.formId !== 'nowf' }).map((x) => x.id);
  assert.deepEqual(got, ['a', 'd'], 'mine or my group’s, moved by someone else, recently, in a workflow');
  assert.deepEqual(freshWaiting(recs, { me, groups: ['g1'], seen: new Set([waitKey(recs[0])]), since }).map((x) => x.id), ['d', 'g']);
  assert.notEqual(waitKey(r('a')), waitKey(r('a', { stage: 's3' })), 'arriving at another stage is new again');
  assert.equal(waitsOn(r('x'), me), true);
  assert.equal(waitsOn(r('x', { stage: null }), me), false);
});

test('roles: a record waiting on a role I hold is waiting on me', () => {
  const r = { id: 'r1', stage: 's2', assigneeRole: 'r_acc' };
  assert.equal(waitsOn(r, 'far', [], ['r_acc']), true);
  assert.equal(waitsOn(r, 'far', [], []), false);
});
