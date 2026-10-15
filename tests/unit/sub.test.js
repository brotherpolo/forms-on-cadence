// Sections under a record (grids, child records, tasks): saved choices, columns, limits, task cells.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSubs, prefsOf, setPrefs, colsFor, toggleCol, moveCol, nextSort, limitRows, sortByVal, daysOpen, taskCell, TASK_COLS, TASK_DEFAULT, DEFAULT_SHOW } from '../../src/sublogic.js';
import { dueInfo } from '../../src/tasks.js';

test('saved choices: bad or missing text gives defaults; one section changes at a time', () => {
  assert.deepEqual(readSubs('nope'), {});
  assert.deepEqual(readSubs(null), {});
  assert.deepEqual(prefsOf({}, 'f1', 'c:f2'), { cols: undefined, sort: null, show: DEFAULT_SHOW });
  let all = setPrefs({}, 'f1', 'c:f2', { show: 5, sort: { key: 'title', dir: 'desc' } });
  all = setPrefs(all, 'f1', 't:tasks', { show: 'all' });
  assert.deepEqual(prefsOf(all, 'f1', 'c:f2'), { cols: undefined, sort: { key: 'title', dir: 'desc' }, show: 5 });
  assert.equal(prefsOf(all, 'f1', 't:tasks').show, 'all');
  assert.equal(prefsOf({ f1: { k: { show: 7 } } }, 'f1', 'k').show, DEFAULT_SHOW, 'only 5, 10, 15, 20 or all');
  all = setPrefs(all, 'f1', 'c:f2', { sort: undefined });
  assert.equal(prefsOf(all, 'f1', 'c:f2').sort, null, 'undefined clears a choice');
});

test('columns: saved choice if still valid, else the defaults; tick, untick, move', () => {
  const cat = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  assert.deepEqual(colsFor(['c', 'gone', 'a', 'c'], cat, ['a']), ['c', 'a']);
  assert.deepEqual(colsFor(undefined, cat, ['b', 'x']), ['b']);
  assert.deepEqual(colsFor([], cat, ['b'], { min: 1 }), ['b'], 'a grid keeps at least one column');
  assert.deepEqual(colsFor([], cat, ['b']), [], 'a list may show only its title');
  assert.deepEqual(toggleCol(['a'], 'b'), ['a', 'b']);
  assert.deepEqual(toggleCol(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(toggleCol(['a'], 'a', { min: 1 }), ['a']);
  assert.deepEqual(moveCol(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(moveCol(['a', 'b'], 'a', -1), ['a', 'b']);
});

test('sorting and how many show', () => {
  assert.deepEqual(nextSort(null, 'x', 'desc'), { key: 'x', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'x', dir: 'desc' }, 'x'), { key: 'x', dir: 'asc' });
  const rows = [{ id: 1, sortVal: 'b' }, { id: 2, sortVal: null }, { id: 3, sortVal: 'A' }, { id: 4, sortVal: 'item 10' }, { id: 5, sortVal: 'item 9' }];
  assert.deepEqual(sortByVal(rows, 'asc').map((r) => r.id), [3, 1, 5, 4, 2], 'natural order, blanks last');
  assert.deepEqual(sortByVal(rows, 'desc').map((r) => r.id), [4, 5, 1, 3, 2]);
  const many = Array.from({ length: 12 }, (_, i) => ({ i, isNew: i === 11 }));
  const l = limitRows(many, 5, (r) => r.isNew);
  assert.deepEqual(l.rows.map((r) => r.i), [0, 1, 2, 3, 4, 11], 'new rows always show');
  assert.equal(l.hidden, 6);
  assert.equal(limitRows(many, 'all').rows.length, 12);
});

test('tasks: days open and table cells', () => {
  const now = new Date(2026, 9, 14, 21, 0).getTime();
  assert.equal(daysOpen({ createdAt: new Date(2026, 9, 10, 23, 0).getTime() }, now), 4, 'counts calendar days');
  assert.equal(daysOpen({ createdAt: new Date(2026, 9, 1).getTime(), done: true, doneAt: new Date(2026, 9, 3).getTime() }, now), 2, 'stops when done');
  assert.equal(daysOpen({}, now), null);
  const opt = { todayKey: '2026-10-14', now, dueInfo };
  const t = { title: 'Call', due: '2026-10-10', createdAt: new Date(2026, 9, 13).getTime(), ownerName: 'Adam', assigneeName: 'Jane', repeat: 'weekly', notes: 'a\nb' };
  assert.equal(taskCell('due', t, opt).tone, 'late');
  assert.equal(taskCell('due', { ...t, done: true }, opt).tone, '', 'done tasks aren’t late');
  assert.equal(taskCell('days', t, opt).text, '1 day');
  assert.deepEqual([taskCell('owner', t, opt).text, taskCell('assignee', t, opt).text, taskCell('status', t, opt).text, taskCell('repeat', t, opt).text, taskCell('notes', t, opt).text], ['Adam', 'Jane', 'Open', 'Weekly', 'a b']);
  assert.equal(taskCell('due', { title: 'x' }, opt).sort, null, 'no date sorts last');
  assert.deepEqual(TASK_DEFAULT, ['due', 'days', 'owner', 'assignee', 'status']);
  assert.ok(TASK_DEFAULT.every((k) => TASK_COLS.some((c) => c.key === k)));
});
