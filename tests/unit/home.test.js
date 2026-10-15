// Dashboard shortcuts and Home (src/homelogic.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkInfo, visibleTiles, linkChoices, linkKey, linkFromKey, homeDashboardId, PAGES } from '../../src/homelogic.js';

const forms = [{ id: 'f_inv', name: 'Invoices', itemName: 'Invoice' }, { id: 'f_sec', name: 'Payroll' }];
const env = (o = {}) => ({
  formById: (id) => forms.find((f) => f.id === id && (o.hide || []).indexOf(id) < 0) || null,
  canView: (id) => !(o.hide || []).includes(id), canCreate: (id) => !(o.noCreate || []).includes(id),
  isAdmin: !!o.admin, count: (id) => (id === 'f_inv' ? 7 : 1), viewById: (id) => (id === 'v1' ? { id: 'v1', formId: 'f_inv', name: 'Unpaid' } : null),
  noun: (f, n) => (n === 1 ? (f.itemName || 'record').toLowerCase() : f.name.toLowerCase()), item: (f) => f.itemName || 'Record',
  hasWorkflow: !!o.wf, counts: { dashboards: 3, reports: 1, mywork: 2 },
});

test('a form list, a saved view, a new record', () => {
  const l = linkInfo({ to: 'list', form: 'f_inv' }, env());
  assert.deepEqual([l.title, l.sub, l.ok, l.go], ['Invoices', '7 invoices', true, { name: 'records', formId: 'f_inv', viewId: null }]);
  const v = linkInfo({ to: 'list', form: 'f_inv', view: 'v1' }, env());
  assert.deepEqual([v.title, v.go.viewId], ['Invoices · Unpaid', 'v1']);
  const gone = linkInfo({ to: 'list', form: 'f_inv', view: 'deleted' }, env());
  assert.deepEqual([gone.title, gone.go.viewId], ['Invoices', null], 'a deleted view falls back to the plain list');
  const n = linkInfo({ to: 'new', form: 'f_inv' }, env());
  assert.deepEqual([n.title, n.sub, n.glyph, n.go.name], ['New invoice', 'Invoices', '+', 'new']);
  assert.equal(linkInfo({ to: 'new', form: 'f_inv' }, env({ noCreate: ['f_inv'] })).ok, false);
  assert.equal(linkInfo({ to: 'list', form: 'gone' }, env()), null);
});

test('screens: admin ones only for admins; My work only with a workflow', () => {
  assert.equal(linkInfo({ to: 'page', page: 'designer' }, env()).ok, false);
  assert.equal(linkInfo({ to: 'page', page: 'designer' }, env({ admin: true })).ok, true);
  assert.equal(linkInfo({ to: 'page', page: 'designer' }, env({ admin: true })).sub, 'Administration');
  assert.equal(linkInfo({ to: 'page', page: 'mywork' }, env()).ok, false);
  assert.equal(linkInfo({ to: 'page', page: 'mywork' }, env({ wf: true })).sub, '2 waiting on you');
  assert.equal(linkInfo({ to: 'page', page: 'dashboards' }, env()).sub, '3 dashboards');
  assert.equal(linkInfo({ to: 'page', page: 'reports' }, env()).sub, '1 report');
  assert.equal(PAGES.filter((p) => p.admin).length, 7);
});

test('who sees which tiles', () => {
  const tiles = [{ id: 'a', report: 'r' }, { id: 'b', link: { to: 'page', page: 'users' } }, { id: 'c', link: { to: 'list', form: 'f_sec' } }, { id: 'd', link: { to: 'list', form: 'f_inv' } }];
  assert.deepEqual(visibleTiles(tiles, env({ admin: true })).map((t) => t.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(visibleTiles(tiles, env({ hide: ['f_sec'] })).map((t) => t.id), ['a', 'd'], 'members: no admin screens, no forms they can’t see');
});

test('the picker, keys and Home', () => {
  const g = linkChoices(env(), forms);
  assert.deepEqual(g.map((x) => x.title), ['Forms', 'Insights']);
  assert.ok(!g[1].items.some((i) => i.key === 'page:mywork'), 'no My work without a workflow');
  assert.deepEqual(linkChoices(env({ admin: true }), forms).map((x) => x.title), ['Forms', 'Insights', 'Administration']);
  for (const l of [{ to: 'list', form: 'f', view: 'v' }, { to: 'new', form: 'f' }, { to: 'page', page: 'audit' }]) assert.deepEqual(linkFromKey(linkKey(l)), l);
  assert.equal(linkFromKey('page:nope'), null);
  const see = (id) => id !== 'hidden';
  assert.equal(homeDashboardId('mine', 'def', see), 'mine');
  assert.equal(homeDashboardId('hidden', 'def', see), 'def', 'your own home was unshared: the default');
  assert.equal(homeDashboardId('', 'hidden', see), '');
});
