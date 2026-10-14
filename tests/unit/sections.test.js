import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSections, sectionOrder, moveSection, TASKS } from '../../src/sectionlogic.js';

const form = { children: [{ formId: 'pay' }, { formId: 'lines', display: 'grid' }, { formId: 'notes' }] };

test('the default order is grids, Tasks, then child forms', () => {
  assert.deepEqual(defaultSections(form), ['lines', TASKS, 'pay', 'notes']);
  assert.deepEqual(sectionOrder(form), ['lines', TASKS, 'pay', 'notes']);
  assert.deepEqual(sectionOrder({}), [TASKS]);
});

test('a saved order wins; removed forms drop out; new ones slot in after their default neighbour', () => {
  assert.deepEqual(sectionOrder({ ...form, sectionOrder: ['pay', 'notes', TASKS, 'lines'] }), ['pay', 'notes', TASKS, 'lines']);
  assert.deepEqual(sectionOrder({ ...form, sectionOrder: ['gone', 'pay', TASKS, 'pay', 'lines'] }), ['pay', 'notes', TASKS, 'lines'], 'notes comes in after Payments, its default neighbour');
  const grid2 = { children: [...form.children, { formId: 'parts', display: 'grid' }], sectionOrder: [TASKS, 'pay', 'lines', 'notes'] };
  assert.deepEqual(sectionOrder(grid2), [TASKS, 'pay', 'lines', 'parts', 'notes'], 'a new grid follows the other grid');
  const switched = { children: [{ formId: 'pay', display: 'grid' }, { formId: 'lines', display: 'grid' }, { formId: 'notes' }], sectionOrder: ['notes', 'pay', TASKS, 'lines'] };
  assert.deepEqual(sectionOrder(switched), ['notes', 'pay', TASKS, 'lines'], 'switching grid/separate keeps the place');
});

test('moving up and down', () => {
  const o = ['lines', TASKS, 'pay'];
  assert.deepEqual(moveSection(o, 'pay', -1), ['lines', 'pay', TASKS]);
  assert.deepEqual(moveSection(o, 'lines', -1), o, 'already first');
  assert.deepEqual(moveSection(o, 'pay', 1), o, 'already last');
  assert.deepEqual(moveSection(o, 'nope', 1), o);
});
