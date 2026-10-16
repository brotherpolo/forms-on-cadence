import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskRefusal } from '../../src/tasks.js';

const me = { uid: 'u_new', email: 'New@Example.com' };
const acct = (x = {}) => ({ role: 'member', cadence: true, groups: ['g1'], access: { '*': { view: 'all', edit: 'own' } }, ...x });
const task = (x = {}) => ({ ownerId: 'u_new', ownerEmail: 'new@example.com', assigneeId: 'u_adam', assigneeEmail: 'adam@example.com', assigneeName: 'Adam', recordId: 'r1', formId: 'f1', ...x });
const rec = (x = {}) => ({ formId: 'f1', ownerId: 'u_adam', ...x });
const person = { uid: 'u_adam' };

test('nothing wrong: no reasons', () => {
  assert.deepEqual(taskRefusal(me, acct(), task(), rec(), person), []);
});

test('missing account', () => {
  assert.match(taskRefusal(me, null, task(), rec(), person)[0], /account wasn’t found/);
});

test('Cadence not switched on (admins always can)', () => {
  assert.match(taskRefusal(me, acct({ cadence: false }), task(), rec(), person).join(' '), /Cadence isn’t switched on/);
  assert.deepEqual(taskRefusal(me, acct({ cadence: false, role: 'admin', access: {} }), task(), rec(), person), []);
});

test('owner email must be my sign-in email', () => {
  assert.match(taskRefusal(me, acct(), task({ ownerEmail: 'other@example.com' }), rec(), person).join(' '), /doesn’t match/);
});

test('assignee missing from the people list, or on another account', () => {
  assert.match(taskRefusal(me, acct(), task(), rec(), null, { assignee: 'Adam Pollack' }).join(' '), /Adam Pollack isn’t in Cadence’s people list under adam@example.com/);
  assert.match(taskRefusal(me, acct(), task(), rec(), { uid: 'u_other' }).join(' '), /different account/);
  assert.deepEqual(taskRefusal(me, acct(), task({ assigneeId: null, assigneeEmail: null }), rec(), undefined), []);
});

test('record link: missing, wrong form, own-only access, workflow responsibility', () => {
  assert.match(taskRefusal(me, acct(), task(), null, person).join(' '), /isn’t saved on the server/);
  assert.match(taskRefusal(me, acct(), task(), rec({ formId: 'f2' }), person).join(' '), /wrong form/);
  const own = acct({ access: { '*': { view: 'own', edit: 'own' } } });
  assert.match(taskRefusal(me, own, task(), rec(), person).join(' '), /only records you created/);
  assert.deepEqual(taskRefusal(me, own, task(), rec({ ownerId: 'u_new' }), person), []);
  assert.deepEqual(taskRefusal(me, own, task(), rec({ assignee: 'u_new' }), person), []);
  assert.deepEqual(taskRefusal(me, own, task(), rec({ assigneeGroup: 'g1' }), person), []);
  const perForm = acct({ access: { '*': { view: 'all' }, f1: { view: 'none' } } });
  assert.match(taskRefusal(me, perForm, task(), rec(), person).join(' '), /doesn’t include this form/);
});
