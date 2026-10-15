// Audit trail screen: filters, wording, what can be put back, CSV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverFilter, matches, verb, targetText, canPutBack, dayRange, csvRows, KINDS } from '../../src/auditlogic.js';

const e1 = { at: 100, by: 'u1', byName: 'Adam', area: 'record', kind: 'changed', recordId: 'r1', formId: 'f1', formName: 'Invoices', title: 'INV-0058', changes: [{ key: 'st', label: 'Status', type: 'select', from: 'Draft', to: 'Sent' }] };
const e2 = { at: 50, by: 'u2', byName: 'Jane', area: 'group', kind: 'changed', targetName: 'Office' };
const text = (e) => [e.byName, e.title, e.targetName, ...(e.changes || []).map((c) => c.from + ' ' + c.to)].join(' ');

test('the database gets the most specific filter; the rest are checked on what comes back', () => {
  assert.deepEqual(serverFilter({ recordId: 'r1', formId: 'f1', by: 'u1' }), ['recordId', 'r1']);
  assert.deepEqual(serverFilter({ formId: 'f1', by: 'u1' }), ['formId', 'f1']);
  assert.deepEqual(serverFilter({ by: 'u1', kind: 'group' }), ['by', 'u1']);
  assert.deepEqual(serverFilter({ kind: 'group' }), ['area', 'group']);
  assert.equal(serverFilter({}), null);
  assert.ok(matches(e1, { formId: 'f1', by: 'u1', kind: 'changed', q: 'draft sent' }, text));
  assert.ok(!matches(e1, { kind: 'group' }, text));
  assert.ok(matches(e2, { kind: 'group' }, text));
  assert.ok(!matches(e1, { from: 101 }, text) && !matches(e1, { to: 100 }, text) && matches(e1, { from: 100, to: 101 }, text));
  assert.ok(!matches(e1, { q: 'nope' }, text));
  assert.ok(KINDS.every((k) => k.key === '' || typeof k.test === 'function'));
});

test('wording', () => {
  assert.equal(verb(e1) + ' ' + targetText(e1), 'changed Invoices · INV-0058');
  assert.equal(targetText(e2), 'security group Office');
  assert.equal(verb({ area: 'user', kind: 'created' }), 'signed in for the first time:');
  assert.equal(verb({ kind: 'emailed' }), 'emailed the PDF of');
});

test('what can be put back', () => {
  assert.ok(canPutBack(e1, e1.changes[0]));
  assert.ok(!canPutBack(e1, { type: 'signature', from: 'signed' }), 'signatures and files aren’t kept whole');
  assert.ok(!canPutBack(e1, { type: 'textarea', from: 'x'.repeat(1000) + '…' }), 'shortened long text');
  assert.ok(!canPutBack(e2, { type: 'text' }), 'only record changes');
  assert.ok(!canPutBack({ ...e1, kind: 'created' }, e1.changes[0]));
});

test('day range and CSV', () => {
  const r = dayRange('2026-10-14', '2026-10-14');
  assert.equal(r.to - r.from, 864e5);
  assert.deepEqual(dayRange('', ''), { from: null, to: null });
  const { headers, rows } = csvRows([e1, e2], (e, c, side) => c[side], (t) => 'T' + t);
  assert.equal(headers.length, 9);
  assert.deepEqual(rows[0], ['T100', 'Adam', 'changed', 'Invoices', 'Invoices · INV-0058', 'Status', 'Draft', 'Sent', '']);
  assert.deepEqual(rows[1].slice(0, 6), ['T50', 'Jane', 'changed', 'group', 'security group Office', '']);
});

test('form rule changes get a readable label', async () => {
  const { changeLabel } = await import('../../src/auditlogic.js');
  assert.equal(changeLabel({ key: 'prop:rules', label: 'rules' }), 'Show and hide rules');
  assert.equal(changeLabel({ key: 'st', label: 'Status' }), 'Status');
});
