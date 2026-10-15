// Duplicate a record (src/duplogic.js) and smaller photos (src/photo.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyValues, relinkRow, NOT_COPIED } from '../../src/duplogic.js';
import { targetSize, jpgName, MAX_EDGE } from '../../src/photo.js';

const form = { fields: [
  { id: 'name', type: 'text' }, { id: 'num', type: 'autonumber' }, { id: 'sig', type: 'signature' },
  { id: 'tax', type: 'formula' }, { id: 'h', type: 'heading' }, { id: 'tags', type: 'multiselect' },
  { id: 'pic', type: 'image' }, { id: 'amt', type: 'currency' }, { id: 'note', type: 'textarea' },
] };

test('a copy keeps typed values, not numbers, signatures or calculations', () => {
  const v = { name: 'Roof job', num: 'INV-0058', sig: 'data:x', tax: 13, tags: ['a', 'b'], pic: { name: 'r.jpg', url: 'u' }, amt: 100, note: '' };
  const out = copyValues(form, v, { titleId: 'name' });
  assert.deepEqual(out, { name: 'Roof job (copy)', tags: ['a', 'b'], pic: { name: 'r.jpg', url: 'u' }, amt: 100 });
  out.tags.push('c');
  assert.deepEqual(v.tags, ['a', 'b'], 'the original is not touched');
  for (const t of ['autonumber', 'signature', 'formula', 'heading']) assert.ok(NOT_COPIED.has(t));
});

test('the title gets "(copy)" once, only when it is typed text', () => {
  assert.equal(copyValues(form, { name: 'A (copy)' }, { titleId: 'name' }).name, 'A (copy)');
  assert.equal(copyValues(form, { name: '  ' }, { titleId: 'name' }).name, '  ');
  assert.deepEqual(copyValues(form, { num: 'X' }, { titleId: 'num' }), {});
  assert.equal(copyValues(form, { name: 'A' }).name, 'A', 'no title field: no suffix');
  assert.deepEqual(copyValues(null, { name: 'A' }), {});
});

test('grid rows: links back to the original are cleared', () => {
  const rowForm = { fields: [{ id: 'job', type: 'relation', relForm: 'f_job' }, { id: 'cli', type: 'relation', relForm: 'f_cli' }, { id: 'q', type: 'number' }] };
  assert.deepEqual(relinkRow(rowForm, { job: 'orig', cli: 'c1', q: 2 }, 'f_job', 'orig'), { cli: 'c1', q: 2 });
  assert.deepEqual(relinkRow(rowForm, { job: 'other', q: 2 }, 'f_job', 'orig'), { job: 'other', q: 2 });
});

test('photo size: scaled to at most 2000px on the long side, never enlarged', () => {
  assert.deepEqual(targetSize(4032, 3024), { w: 2000, h: 1500, scaled: true });
  assert.deepEqual(targetSize(3024, 4032), { w: 1500, h: 2000, scaled: true });
  assert.deepEqual(targetSize(800, 600), { w: 800, h: 600, scaled: false });
  assert.deepEqual(targetSize(MAX_EDGE, 10), { w: 2000, h: 10, scaled: false });
  assert.equal(targetSize(10000, 1).h, 1);
});

test('photo names end in .jpg', () => {
  assert.equal(jpgName('IMG_0042.HEIC'), 'IMG_0042.jpg');
  assert.equal(jpgName('roof.photo.png'), 'roof.photo.jpg');
  assert.equal(jpgName('noext'), 'noext.jpg');
  assert.equal(jpgName(''), 'photo.jpg');
});
