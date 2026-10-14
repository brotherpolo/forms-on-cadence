import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headingOf, readFolds, isFolded, setFold, setFolds, foldKeys } from '../../src/foldlogic.js';

test('fields belong to the heading above them', () => {
  const fs = [{ id: 'a', type: 'text' }, { id: 'h1', type: 'heading' }, { id: 'b', type: 'text' }, { id: 'c', type: 'date' }, { id: 'h2', type: 'heading' }, { id: 'd', type: 'textarea' }];
  assert.deepEqual(headingOf(fs), { a: null, b: 'h1', c: 'h1', d: 'h2' });
  assert.deepEqual(headingOf(undefined), {});
});

test('folds are kept per form, and opening leaves no trace', () => {
  let f = readFolds(null);
  assert.deepEqual(f, {});
  assert.deepEqual(readFolds('not json'), {});
  assert.deepEqual(readFolds('[1]'), {});
  f = setFold(f, 'inv', 'h:notes', true);
  f = setFold(f, 'inv', 'g:lines', true);
  assert.ok(isFolded(f, 'inv', 'h:notes') && !isFolded(f, 'cust', 'h:notes'), 'another form is not affected');
  f = setFold(f, 'inv', 'h:notes', false);
  assert.deepEqual(f, { inv: { 'g:lines': 1 } });
  f = setFold(f, 'inv', 'g:lines', false);
  assert.deepEqual(f, {});
  const keys = foldKeys({ fields: [{ id: 'h1', type: 'heading' }, { id: 'x', type: 'text' }] }, ['lines'], ['pay']);
  assert.deepEqual(keys, ['h:h1', 'g:lines', 'c:pay']);
  f = setFolds({}, 'inv', keys, true);
  assert.equal(Object.keys(f.inv).length, 3);
  assert.deepEqual(setFolds(f, 'inv', keys, false), {});
  assert.deepEqual(readFolds(JSON.stringify(f)), f, 'round trip through storage');
});
