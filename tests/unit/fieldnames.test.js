// Captions and system names (src/fieldnames.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sysOf, fieldByName, sharedCaptions, shownName, uniqueSysNames, renameRefs } from '../../src/fieldnames.js';

const form = { fields: [
  { id: 'h1', type: 'heading', label: 'Client' }, { id: 'a', type: 'text', label: 'Name', sysName: 'Client name' },
  { id: 'h2', type: 'heading', label: 'Contact' }, { id: 'b', type: 'text', label: 'Name' }, { id: 'c', type: 'email', label: 'Email' },
] };

test('system names default to the caption', () => {
  assert.equal(sysOf(form.fields[1]), 'Client name');
  assert.equal(sysOf(form.fields[3]), 'Name');
  assert.equal(sysOf({ label: 'X', sysName: '  ' }), 'X');
});

test('finding a field by name: system name, then ID, then a caption only one field has', () => {
  assert.equal(fieldByName(form, 'client NAME').id, 'a');
  assert.equal(fieldByName(form, 'Name').id, 'b', 'the field whose system name is Name');
  assert.equal(fieldByName(form, 'c').id, 'c');
  assert.equal(fieldByName(form, 'Email').id, 'c');
  assert.equal(fieldByName({ fields: [{ id: 'x', type: 'text', label: 'Total', sysName: 'Sum' }] }, 'Total').id, 'x', 'an old {Total} still works');
  assert.equal(fieldByName({ fields: [{ id: 'x', type: 'text', label: 'T', sysName: 'A' }, { id: 'y', type: 'text', label: 'T', sysName: 'B' }] }, 'T'), undefined, 'a shared caption is ambiguous');
  assert.equal(fieldByName(form, 'Client'), undefined, 'not a heading');
});

test('shared captions show which is which', () => {
  assert.deepEqual([...sharedCaptions(form.fields)], ['name']);
  assert.equal(shownName(form, form.fields[1]), 'Name (Client name)');
  assert.equal(shownName(form, form.fields[3]), 'Name (Contact)', 'no system name of its own: its section');
  assert.equal(shownName(form, form.fields[4]), 'Email');
});

test('unique system names, and renaming references', () => {
  const u = uniqueSysNames([{ id: 'a', type: 'text', label: 'Name' }, { id: 'b', type: 'text', label: 'Name' }, { id: 'c', type: 'text', label: 'Name 2' }, { id: 'd', type: 'text', label: 'Name' }]);
  assert.deepEqual(u.given.map((g) => [g.id, g.sysName]), [['b', 'Name 3'], ['d', 'Name 4']], 'skips a name another field already has');
  assert.deepEqual(u.fields.map(sysOf), ['Name', 'Name 3', 'Name 2', 'Name 4']);
  assert.equal(new Set(u.fields.map((f) => sysOf(f).toLowerCase())).size, 4, 'all different');
  assert.equal(renameRefs('{name} + { Total }', [['Name', 'Client name'], ['total', 'Sum']]), '{Client name} + {Sum}');
});

test('imports: template headings use system names; a caption still matches', async () => {
  const { templateColumns, matchColumns } = await import('../../src/importlogic.js');
  const f = { fields: [{ id: 'a', type: 'text', label: 'Name', sysName: 'Client name' }, { id: 'b', type: 'text', label: 'Name', sysName: 'Contact name' }] };
  const cols = templateColumns(f, [], () => '');
  assert.deepEqual(cols.slice(1).map((c) => c.header), ['Client name', 'Contact name']);
  assert.deepEqual(matchColumns(['Contact name', 'client name'], cols).map((m) => m.key), ['b', 'a']);
  assert.deepEqual(matchColumns(['Name', 'Name'], cols).map((m) => m.key), ['a', 'b'], 'shared captions: in order');
});
