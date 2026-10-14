import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachCandidates, parentOf, matchingFields, copyPatch, linkPatch, attachChange, detachChange, movesFrom } from '../../src/attachlogic.js';

const invoice = { id: 'inv', name: 'Invoice', fields: [
  { id: 'no', type: 'text', label: 'Invoice #' }, { id: 'client', type: 'text', label: 'Client' },
  { id: 'date', type: 'date', label: 'Date' }, { id: 'tot', type: 'formula', label: 'Total' }, { id: 'h', type: 'heading', label: 'Client' }] };
const line = { id: 'li', name: 'Line Item', fields: [
  { id: 'desc', type: 'text', label: 'Description' }, { id: 'no', type: 'text', label: ' invoice # ' }, { id: 'date', type: 'date', label: 'Date' },
  { id: 'cl', type: 'number', label: 'Client' }, { id: 'amt', type: 'formula', label: 'Total' }, { id: 'link', type: 'relation', label: 'Invoice', relForm: 'inv' },
  { id: 'other', type: 'relation', label: 'Elsewhere', relForm: 'zz' }] };

const recs = [
  { id: 'i1', formId: 'inv', values: { no: 'INV-1' } },
  { id: 'i2', formId: 'inv', values: { no: 'INV-2' } },
  { id: 'a', formId: 'li', values: { desc: 'Design' }, createdAt: 1 },
  { id: 'b', formId: 'li', values: { desc: 'Testing' }, parentId: 'i1', parentFormId: 'inv', createdAt: 2 },
  { id: 'c', formId: 'li', values: { desc: 'Design review' }, parentId: 'gone', createdAt: 3 },
  { id: 'd', formId: 'li', values: { desc: 'Locked' }, createdAt: 4 },
  { id: 'e', formId: 'li', values: { desc: 'On two' }, parentId: 'i2', createdAt: 5 },
];
const byId = (id) => recs.find((r) => r.id === id);
const base = { records: recs, childFormId: 'li', recById: byId, canEdit: (r) => r.id !== 'd', text: (r) => r.values.desc };
const ids = (xs) => xs.map((x) => x.rec.id);

test('who can be attached: unattached (or orphaned) records the viewer can edit, newest first', () => {
  assert.equal(parentOf(byId('c'), byId), null, 'a parent that was deleted counts as none');
  const shown = new Set(['e']); // what's already under invoice 2 (the caller passes it)
  assert.deepEqual(ids(attachCandidates({ ...base, parentId: 'i2', exclude: shown })), ['c', 'a']);
  assert.deepEqual(ids(attachCandidates({ ...base, parentId: null })), ['c', 'a'], 'works for a parent not saved yet');
  const all = attachCandidates({ ...base, parentId: 'i2', exclude: shown, others: true });
  assert.deepEqual(ids(all), ['c', 'b', 'a'], 'records on another parent show with the switch');
  assert.equal(all.find((x) => x.rec.id === 'b').from.id, 'i1');
  assert.equal(all.find((x) => x.rec.id === 'a').from, null);
  assert.deepEqual(ids(attachCandidates({ ...base, parentId: 'i2', exclude: new Set(['c', 'e']) })), ['a'], 'rows already in the grid are left out');
  assert.deepEqual(ids(attachCandidates({ ...base, parentId: 'i2', exclude: shown, others: true, q: 'design' })), ['c', 'a']);
  assert.deepEqual(ids(attachCandidates({ ...base, parentId: 'i2', exclude: shown, q: 'des rev' })), ['c'], 'every word must match');
  // a record detached in the grid but not saved yet still has this parent: it is offered as unattached
  assert.deepEqual(ids(attachCandidates({ ...base, parentId: 'i1' })), ['c', 'b', 'a'], 'e is on another invoice, so hidden');
  assert.equal(attachCandidates({ ...base, parentId: 'i1' }).find((x) => x.rec.id === 'b').from, null);
});

test('copy matching fields fills empty fields only, by label and type', () => {
  assert.deepEqual(matchingFields(invoice, line), [['no', 'no'], ['date', 'date']], 'labels ignore case and spaces; types must match; no formulas or headings');
  assert.deepEqual(copyPatch(invoice, line, { no: 'INV-9', date: '2026-10-01' }, { date: '2026-09-30' }), { no: 'INV-9' });
  assert.deepEqual(copyPatch(invoice, line, { no: '' }, {}), {}, 'nothing to copy');
});

test('links to the parent form follow the move; detaching clears them', () => {
  assert.deepEqual(linkPatch(line, 'inv', 'i2', null, {}), { link: 'i2' });
  assert.deepEqual(linkPatch(line, 'inv', 'i2', 'i1', { link: 'i1' }), { link: 'i2' }, 'still pointing at the old parent');
  assert.deepEqual(linkPatch(line, 'inv', 'i2', 'i1', { link: 'i3' }), {}, 'pointing somewhere chosen on purpose: left alone');
  assert.deepEqual(linkPatch(line, 'inv', null, 'i1', { link: 'i1', other: 'x' }), { link: null });
  assert.deepEqual(linkPatch(line, 'inv', null, 'i1', { link: 'i3' }), {});
});

test('attach and detach changes', () => {
  const p = { id: 'i2', formId: 'inv', values: { no: 'INV-2', date: '2026-10-02' } };
  assert.deepEqual(attachChange(byId('b'), p, invoice, line, true), { id: 'b', parentId: 'i2', parentFormId: 'inv', set: { no: 'INV-2', date: '2026-10-02', link: 'i2' } });
  assert.deepEqual(attachChange(byId('b'), p, invoice, line, false), { id: 'b', parentId: 'i2', parentFormId: 'inv', set: { link: 'i2' } }, 'copy switched off');
  assert.deepEqual(detachChange({ id: 'x', parentId: 'i1', parentFormId: 'inv', values: { link: 'i1', no: 'INV-1' } }, line),
    { id: 'x', parentId: null, parentFormId: null, set: { link: null } }, 'copied values stay');
  assert.deepEqual(detachChange({ id: 'x', parentId: 'i1', values: { link: 'i1' } }, line, 'inv').set, { link: null }, 'older records without parentFormId');
  const m = movesFrom([{ from: byId('i1') }, { from: null }, { from: byId('i1') }, { from: byId('i2') }], (r) => r.values.no);
  assert.deepEqual(m, { n: 3, names: ['INV-1', 'INV-2'] });
});
