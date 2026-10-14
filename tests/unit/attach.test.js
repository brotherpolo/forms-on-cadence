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

/* ---------- suggested matches, filters and search ---------- */
import { keyOf, namePairs, suggestMatch, suggestParent, filterValuesOf, chipHit, valueOrder, searchHit } from '../../src/attachlogic.js';

const INV = { id: 'inv', name: 'Invoice', titleField: 'no', fields: [
  { id: 'no', type: 'text', label: 'Invoice #' }, { id: 'date', type: 'date', label: 'Date' }, { id: 'st', type: 'select', label: 'Status' }] };
const LI = { id: 'li', name: 'Line Item', titleField: 'date', fields: [
  { id: 'date', type: 'date', label: 'Date' }, { id: 'no', type: 'number', label: 'invoice #' }, { id: 'desc', type: 'textarea', label: 'Description' },
  { id: 'kind', type: 'multiselect', label: 'Type of Billable' }, { id: 'st', type: 'select', label: 'Status' }, { id: 'ok', type: 'checkbox', label: 'Billable' }] };
const lines = [
  { id: 'l1', formId: 'li', values: { date: '2026-09-01', no: 1, st: 'Open' } },
  { id: 'l2', formId: 'li', values: { date: '2026-09-02', no: 1, st: 'Open' } },
  { id: 'l3', formId: 'li', values: { date: '2026-09-01', no: 2, st: 'Open' } },
  { id: 'l4', formId: 'li', values: { date: '2026-10-05', no: null, st: 'Open' } },
];
const v = (f, r) => r.values[f.id];

test('a value key: 1 and "1" match; blanks never do', () => {
  assert.equal(keyOf(1), '1'); assert.equal(keyOf(' 1 '), '1'); assert.equal(keyOf('INV-7'), 'inv-7');
  assert.equal(keyOf(''), null); assert.equal(keyOf(null), null); assert.equal(keyOf(NaN), null); assert.equal(keyOf(['a']), null);
});

test('the suggested match prefers the parent’s title field, even over a narrower date match', () => {
  assert.deepEqual(namePairs(INV, LI).map((x) => x.c.id), ['date', 'no', 'st'], 'same name, types may differ; long text and choices of many never pair');
  const m = suggestMatch({ parentForm: INV, childForm: LI, parentValues: { no: '1', date: '2026-09-02', st: 'Open' }, records: lines, valOf: v, titleField: INV.fields[0] });
  assert.equal(m.c.id, 'no'); assert.equal(m.key, '1'); assert.equal(m.n, 2);
  const noTitle = suggestMatch({ parentForm: INV, childForm: LI, parentValues: { date: '2026-09-01', st: 'Open' }, records: lines, valOf: v, titleField: INV.fields[0] });
  assert.equal(noTitle.c.id, 'date', 'no Invoice #: a date beats a choice field');
  assert.equal(suggestMatch({ parentForm: INV, childForm: LI, parentValues: { no: '99' }, records: lines, valOf: v, titleField: INV.fields[0] }), null, 'nothing matches: no suggestion');
  assert.equal(suggestMatch({ parentForm: INV, childForm: { fields: [{ id: 'x', type: 'text', label: 'Other' }] }, parentValues: { no: '1' }, records: lines, valOf: v }), null);
});

test('the suggested parent for ticked records', () => {
  const invs = [{ id: 'i1', formId: 'inv', values: { no: '1' } }, { id: 'i2', formId: 'inv', values: { no: '2' } }];
  const s = suggestParent({ childForm: LI, parentForms: [INV], recs: lines.slice(0, 2), parentsOf: () => invs, valOf: v, titleFieldOf: (f) => f.fields[0] });
  assert.equal(s.parent.id, 'i1'); assert.equal(s.n, 2); assert.equal(s.total, 2); assert.equal(s.c.label, 'invoice #');
  const mixed = suggestParent({ childForm: LI, parentForms: [INV], recs: lines.slice(0, 3), parentsOf: () => invs, valOf: v, titleFieldOf: (f) => f.fields[0] });
  assert.equal(mixed.parent.id, 'i1'); assert.equal(mixed.n, 2); assert.equal(mixed.total, 3);
  assert.equal(suggestParent({ childForm: LI, parentForms: [INV], recs: [lines[3]], parentsOf: () => invs, valOf: v, titleFieldOf: (f) => f.fields[0] }), null);
});

test('filter values: months for dates, each choice, yes/no, blank', () => {
  const fmt = (f, x) => (f.type === 'number' ? '#' + x : String(x));
  assert.deepEqual(filterValuesOf(LI.fields[0], '2026-09-01', fmt), [{ label: 'Sep 2026', sort: '2026-09' }]);
  assert.deepEqual(filterValuesOf(LI.fields[3], ['Design', 'QA'], fmt).map((x) => x.label), ['Design', 'QA']);
  assert.deepEqual(filterValuesOf(LI.fields[5], false, fmt).map((x) => x.label), ['No']);
  assert.deepEqual(filterValuesOf(LI.fields[1], null, fmt).map((x) => x.label), ['(blank)']);
  assert.deepEqual(filterValuesOf(LI.fields[1], 12, fmt), [{ label: '#12', sort: 12 }]);
  assert.ok(chipHit({ labels: ['Sep 2026'] }, LI.fields[0], '2026-09-30', fmt));
  assert.ok(!chipHit({ labels: ['Sep 2026'] }, LI.fields[0], '2026-10-01', fmt));
  assert.ok(chipHit({ labels: ['QA', 'Testing'] }, LI.fields[3], ['Design', 'QA'], fmt), 'any ticked value');
  assert.ok(chipHit({ key: '1' }, LI.fields[1], 1, fmt) && !chipHit({ key: '1' }, LI.fields[1], 11, fmt), 'a suggested chip matches exactly');
  const vals = [{ sort: 10 }, { sort: 2 }, { sort: 'b' }, { sort: '￿' }, { sort: 'a10' }, { sort: 'a9' }].sort(valueOrder).map((x) => x.sort);
  assert.deepEqual(vals, [2, 10, 'a9', 'a10', 'b', '￿']);
});

test('search: every word, any order, any case', () => {
  assert.ok(searchHit('Mass update to receivables • Quality Assurance', 'mass RECEIV'));
  assert.ok(searchHit('Mass update to receivables', 'receiv mass'));
  assert.ok(!searchHit('Mass update', 'mass delete'));
  assert.ok(searchHit('anything', '  '));
});
