import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCols, saveCols, toggleCol, moveCol, searchRows, sortRows, nextSort, REPORT_COLS, REPORT_DEFAULT, colsKey } from '../../src/catalog.js';

const store = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };
const rows = [
  { id: 'a', name: 'Total Billings', cells: { type: { text: 'KPI' }, dashes: { text: 'Billings' }, updated: { text: 'Oct 14, 2026', sort: 300 } } },
  { id: 'b', name: 'Invoice report', cells: { type: { text: 'Pivot' }, dashes: { text: 'Billings' }, updated: { text: 'Oct 2, 2026', sort: 100 } } },
  { id: 'c', name: 'Line Items', cells: { type: { text: 'Table' }, dashes: { text: '' }, updated: { text: '', sort: null } } },
  { id: 'd', name: 'Item 10', cells: { type: { text: 'Bar' } } },
  { id: 'e', name: 'Item 2', cells: { type: { text: 'Bar' } } },
];

test('columns: defaults, saved choice per person, toggling and moving', () => {
  const s = store();
  assert.deepEqual(readCols(s, 'reports', 'u1', REPORT_COLS, REPORT_DEFAULT), REPORT_DEFAULT);
  saveCols(s, 'reports', 'u1', ['owner', 'bogus', 'type', 'owner']);
  assert.deepEqual(readCols(s, 'reports', 'u1', REPORT_COLS, REPORT_DEFAULT), ['owner', 'type']);
  assert.deepEqual(readCols(s, 'reports', 'u2', REPORT_COLS, REPORT_DEFAULT), REPORT_DEFAULT, 'another person keeps the defaults');
  assert.ok(colsKey('reports', 'u1') in s.m);
  assert.deepEqual(toggleCol(['type'], 'owner'), ['type', 'owner']);
  assert.deepEqual(toggleCol(['type', 'owner'], 'type'), ['owner']);
  assert.deepEqual(moveCol(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(moveCol(['a', 'b'], 'a', -1), ['a', 'b']);
});

test('search looks through the name and every shown column, words in any order', () => {
  const cols = ['type', 'dashes'];
  assert.deepEqual(searchRows(rows, 'kpi billings', cols).map((r) => r.id), ['a']);
  assert.deepEqual(searchRows(rows, 'BILLINGS', cols).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(searchRows(rows, 'pivot', ['dashes']).map((r) => r.id), [], 'hidden columns are not searched');
  assert.equal(searchRows(rows, '  ', cols).length, rows.length);
});

test('sorting: dates by value, text naturally, blanks last', () => {
  assert.deepEqual(sortRows(rows, 'updated', -1).map((r) => r.id).slice(0, 2), ['a', 'b']);
  assert.equal(sortRows(rows, 'updated', 1).at(-1).cells.updated?.sort ?? null, null);
  assert.deepEqual(sortRows(rows.filter((r) => /^Item/.test(r.name)), 'name', 1).map((r) => r.name), ['Item 2', 'Item 10']);
  assert.deepEqual(nextSort({ k: 'name', d: 1 }, 'updated', REPORT_COLS), { k: 'updated', d: -1 });
  assert.deepEqual(nextSort({ k: 'type', d: 1 }, 'type', REPORT_COLS), { k: 'type', d: -1 });
});
