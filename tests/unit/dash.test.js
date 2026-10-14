import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rowsFor, condHit, periodRange, kpiOf, slicesOf, groupRows, pivotOf, normalizeDef, newDef, defFromWidget,
  migrateLegacy, visibleTo, usedOn, filterReaches, dateRefOf, sortRecs, chainFields, bucketOf, groupLabel, drillRows, drillLabel, baseRows,
} from '../../src/dashlogic.js';
import { parseRoute, routeFor } from '../../src/route.js';

const forms = [
  { id: 'clients', name: 'Clients', titleField: 'name', children: [{ formId: 'projects' }], fields: [
    { id: 'name', type: 'text', label: 'Company name' },
    { id: 'status', type: 'select', label: 'Status', options: ['Lead', 'Active'] }] },
  { id: 'projects', name: 'Projects', titleField: 'title', children: [{ formId: 'lines', display: 'grid' }], fields: [
    { id: 'title', type: 'text', label: 'Project name' },
    { id: 'stage', type: 'select', label: 'Stage', options: ['Scoping', 'In progress', 'Done'] },
    { id: 'due', type: 'date', label: 'Due date' }] },
  { id: 'lines', name: 'Line items', titleField: 'desc', children: [], fields: [
    { id: 'desc', type: 'text', label: 'Description' },
    { id: 'cat', type: 'select', label: 'Category', options: ['Labour', 'Materials'] },
    { id: 'amt', type: 'currency', label: 'Amount' },
    { id: 'tags', type: 'multiselect', label: 'Tags', options: ['A', 'B'] },
    { id: 'bill', type: 'checkbox', label: 'Billable' },
    { id: 'inv', type: 'number', label: 'Invoice #' },
    { id: 'notes', type: 'textarea', label: 'Notes' }] },
];
const T = (s) => new Date(s).getTime();
const rec = (id, formId, values, parentId = null, createdAt = T('2026-10-05T10:00')) => ({ id, formId, values, parentId, ownerId: 'u1', createdAt });
const records = [
  rec('c1', 'clients', { name: 'Acme', status: 'Active' }), rec('c2', 'clients', { name: 'Globex', status: 'Lead' }),
  rec('p1', 'projects', { title: 'Lobby', stage: 'In progress', due: '2026-10-20' }, 'c1'),
  rec('p2', 'projects', { title: 'Roof', stage: 'Done', due: '2026-09-02' }, 'c2'),
  rec('l1', 'lines', { desc: 'Design', cat: 'Labour', amt: 100, tags: ['A'], bill: true, inv: 10 }, 'p1', T('2026-10-03T09:00')),
  rec('l2', 'lines', { desc: 'Panels', cat: 'Materials', amt: 300, tags: ['A', 'B'], bill: false, inv: 2 }, 'p1', T('2026-10-08T09:00')),
  rec('l3', 'lines', { desc: 'Survey', cat: 'Labour', amt: 50, tags: [], bill: true, inv: 10 }, 'p2', T('2026-09-12T09:00')),
];
const byF = new Map(forms.map((f) => [f.id, f])), byR = new Map(records.map((r) => [r.id, r]));
const ctx = { forms, records, profiles: {}, formById: (id) => byF.get(id) || null, recById: (id) => byR.get(id) || null, fmt: (f, v) => String(v), recTitle: (r) => r.values.name || r.values.title || r.values.desc };
const ids = (l) => l.map((r) => r.id).sort().join();
const NOW = T('2026-10-13T12:00');

test('conditions: AND, OR, is not, multiple choice, yes/no, parent fields', () => {
  const base = { form: 'lines', measure: { fn: 'count' } };
  assert.equal(ids(rowsFor(ctx, { ...base, conditions: [{ ref: { form: 'lines', id: 'cat' }, op: 'is', value: 'Labour' }] })), 'l1,l3');
  assert.equal(ids(rowsFor(ctx, { ...base, conditions: [{ ref: { form: 'lines', id: 'cat' }, op: 'not', value: 'Labour' }] })), 'l2');
  assert.equal(ids(rowsFor(ctx, { ...base, join: 'or', conditions: [{ ref: { form: 'lines', id: 'cat' }, op: 'is', value: 'Materials' }, { ref: { form: 'clients', id: 'status' }, op: 'is', value: 'Lead' }] })), 'l2,l3');
  assert.equal(ids(rowsFor(ctx, { ...base, conditions: [{ ref: { form: 'lines', id: 'cat' }, op: 'is', value: 'Labour' }, { ref: { form: 'clients', id: 'status' }, op: 'is', value: 'Active' }] })), 'l1');
  assert.equal(ids(rowsFor(ctx, { ...base, conditions: [{ ref: { form: 'lines', id: 'tags' }, op: 'is', value: 'B' }] })), 'l2');
  assert.equal(ids(rowsFor(ctx, { ...base, conditions: [{ ref: { form: 'lines', id: 'bill' }, op: 'is', value: 'No' }] })), 'l2');
  assert.equal(ids(rowsFor(ctx, { ...base, conditions: [{ ref: { form: 'lines', id: 'tags' }, op: 'is', value: '(blank)' }] })), 'l3');
  assert.equal(ids(rowsFor(ctx, { ...base, conditions: [{ ref: { form: 'lines', id: 'cat' }, op: 'is', value: '' }] })), 'l1,l2,l3'); // unfinished condition ignored
  assert.equal(condHit(ctx, byR.get('l1'), { ref: { form: 'projects', id: 'title' }, op: 'is', value: 'Lobby' }), true);
});

test('dashboard filters reach reports only through linked forms; periods use the report’s date', () => {
  const def = { form: 'lines', measure: { fn: 'count' } };
  assert.equal(filterReaches(ctx, def, { form: 'clients', id: 'name' }), true);
  assert.equal(filterReaches(ctx, { form: 'clients' }, { form: 'lines', id: 'cat' }), false);
  assert.equal(ids(rowsFor(ctx, def, { fields: [{ ref: { form: 'clients', id: 'name' }, values: ['Acme'] }] })), 'l1,l2');
  assert.equal(ids(rowsFor(ctx, { form: 'clients' }, { fields: [{ ref: { form: 'lines', id: 'cat' }, values: ['Labour'] }] })), 'c1,c2'); // doesn't reach: ignored
  const m = periodRange('month', NOW);
  assert.equal(ids(rowsFor(ctx, def, { range: { from: m.from, to: m.to } })), 'l1,l2'); // by Created on
  assert.deepEqual(dateRefOf(ctx, { form: 'projects' }), { form: 'projects', id: 'due' });
  assert.equal(ids(rowsFor(ctx, { form: 'projects' }, { range: { from: m.from, to: m.to } })), 'p1');
  assert.equal(periodRange('all', NOW), null);
  const q = periodRange('quarter', NOW);
  assert.equal(new Date(q.from).getMonth(), 9); assert.equal(new Date(q.prevFrom).getMonth(), 6);
  const y = periodRange('year', NOW);
  assert.equal(new Date(y.from).getFullYear(), 2026); assert.equal(new Date(y.prevFrom).getFullYear(), 2025);
  const d = periodRange('30d', NOW);
  assert.equal(Math.round((d.to - d.from) / 864e5), 30);
});

test('KPI compares with the period before', () => {
  const def = { form: 'lines', type: 'kpi', measure: { fn: 'sum', ref: { form: 'lines', id: 'amt' } }, compare: true };
  const k = kpiOf(ctx, def, {}, NOW); // this month vs last month
  assert.equal(k.value, 400); assert.equal(k.prev, 50); assert.equal(Math.round(k.delta), 700);
  const m = periodRange('month', NOW);
  const k2 = kpiOf(ctx, def, { periodKey: 'month', range: { from: m.from, to: m.to } }, NOW);
  assert.equal(k2.value, 400); assert.equal(k2.prevLabel, 'last month');
  assert.equal(kpiOf(ctx, { ...def, compare: false }, {}, NOW).value, 450);
});

test('groups, slices, pivots', () => {
  const def = { form: 'lines', measure: { fn: 'sum', ref: { form: 'lines', id: 'amt' } }, group: { form: 'lines', id: 'cat' } };
  const list = rowsFor(ctx, def);
  assert.deepEqual(groupRows(ctx, def, def.group, list).map((g) => [g.key, g.value]), [['Labour', 150], ['Materials', 300]]); // option order
  assert.deepEqual(slicesOf(ctx, { ...def, group: { form: 'clients', id: 'name' } }, list).map((x) => [x.key, x.value]), [['Acme', 400], ['Globex', 50]]); // largest first
  assert.deepEqual(slicesOf(ctx, { ...def, conditions: [{ ref: def.group, op: 'not', value: 'Labour' }] }, list).map((x) => x.key), ['Materials']);
  const p = pivotOf(ctx, { ...def, col: { form: 'projects', id: 'stage' } }, list);
  assert.deepEqual(p.cols, ['In progress', 'Done']);
  assert.deepEqual(p.rows.map((r) => [r.key, r.cells, r.total]), [['Labour', [100, 50], 150], ['Materials', [300, null], 300]]);
  assert.deepEqual(p.colTotals, [400, 50]); assert.equal(p.grand, 450);
  assert.equal(pivotOf(ctx, { ...def, col: null }, list), null);
  const s = sortRecs(ctx, list, { form: 'lines', id: 'amt' }, -1);
  assert.deepEqual(s.map((r) => r.id), ['l2', 'l1', 'l3']);
});

test('split by a number (low to high) or by a date period', () => {
  const sum = { form: 'lines', measure: { fn: 'sum', ref: { form: 'lines', id: 'amt' } } };
  const list = rowsFor(ctx, sum);
  assert.deepEqual(groupRows(ctx, sum, { form: 'lines', id: 'inv' }, list).map((g) => [g.key, g.value]), [['2', 300], ['10', 150]], 'numeric order, not text order');
  assert.deepEqual(groupRows(ctx, sum, { form: 'lines', id: '_created', by: 'month' }, list).map((g) => [g.key, g.value]), [['Sep 2026', 50], ['Oct 2026', 400]]);
  assert.deepEqual(groupRows(ctx, sum, { form: 'projects', id: 'due', by: 'quarter' }, list).map((g) => g.key), ['Q3 2026', 'Q4 2026'], 'a parent’s date');
  assert.deepEqual(bucketOf(T('2026-10-08T09:00'), 'week'), { k: 'Week of Oct 5, 2026', s: T('2026-10-05T00:00') });
  assert.equal(bucketOf(T('2026-10-08T09:00'), 'year').k, '2026');
  const p = pivotOf(ctx, { ...sum, group: { form: 'lines', id: 'inv' }, col: { form: 'lines', id: '_created', by: 'month' } }, list);
  assert.deepEqual(p.cols, ['Sep 2026', 'Oct 2026']);
  assert.deepEqual(p.rows.map((r) => [r.key, r.cells]), [['2', [null, 300]], ['10', [50, 100]]]);
  assert.equal(groupLabel(ctx, { form: 'lines', id: '_created', by: 'week' }), 'Created on by week');
});

test('a split by something that can’t split (long text) is replaced; dates get a period', () => {
  const d = normalizeDef(ctx, { form: 'lines', type: 'donut', group: { form: 'lines', id: 'notes' } });
  assert.notEqual(d.group.id, 'notes');
  assert.deepEqual(normalizeDef(ctx, { form: 'lines', type: 'bar', group: { form: 'lines', id: 'inv' } }).group, { form: 'lines', id: 'inv' });
  assert.deepEqual(normalizeDef(ctx, { form: 'lines', type: 'bar', group: { form: 'projects', id: 'due' } }).group, { form: 'projects', id: 'due', by: 'month' });
  assert.deepEqual(normalizeDef(ctx, { form: 'lines', type: 'bar', group: { form: 'lines', id: 'cat', by: 'week' } }).group, { form: 'lines', id: 'cat' });
  const pv = normalizeDef(ctx, { form: 'lines', type: 'pivot', group: { form: 'lines', id: '_created', by: 'year' }, col: { form: 'lines', id: '_created', by: 'month' } });
  assert.deepEqual([pv.group.by, pv.col.by], ['year', 'month'], 'the same date by year and by month is fine');
});

test('"Other" is worked out from its records, and a dated bar chart doesn’t fold', () => {
  const avg = { form: 'lines', type: 'donut', measure: { fn: 'avg', ref: { form: 'lines', id: 'amt' } }, group: { form: 'lines', id: 'desc' } };
  const list = rowsFor(ctx, avg);
  const s = slicesOf(ctx, avg, list, 2);
  assert.equal(s.length, 2);
  assert.equal(s[1].key, 'Other (2)');
  assert.equal(s[1].value, (100 + 50) / 2, 'the average of its records, not a sum of averages');
  assert.deepEqual(s[1].keys.slice().sort(), ['Design', 'Survey']);
  assert.equal(slicesOf(ctx, { ...avg, limit: 'all' }, list, 2).length, 3, 'All: every group, no Other');
  assert.equal(slicesOf(ctx, normalizeDef(ctx, { ...avg, limit: 'lots' }), list, 2).length, 2, 'an unknown limit falls back');
  const bar = { form: 'lines', type: 'bar', measure: { fn: 'count' }, group: { form: 'lines', id: '_created', by: 'week' } };
  assert.ok(slicesOf(ctx, bar, list, 1).every((x) => !x.other), 'periods stay in order instead of folding');
});

test('drilling: the records behind a slice, a pivot cell, a period, and a KPI', () => {
  const def = { form: 'lines', type: 'pivot', measure: { fn: 'count' }, group: { form: 'lines', id: 'cat' }, col: { form: 'projects', id: 'stage' } };
  const ids2 = (l) => l.map((r) => r.id).sort().join();
  assert.equal(ids2(drillRows(ctx, def, {}, [{ ref: def.group, keys: ['Labour'] }])), 'l1,l3');
  assert.equal(ids2(drillRows(ctx, def, {}, [{ ref: def.group, keys: ['Labour'] }, { ref: def.col, keys: ['Done'] }])), 'l3');
  assert.equal(ids2(drillRows(ctx, def, {}, [{ ref: { form: 'lines', id: 'inv' }, keys: ['10'] }])), 'l1,l3', 'a number split');
  assert.equal(ids2(drillRows(ctx, def, {}, [{ ref: { form: 'lines', id: '_created', by: 'month' }, keys: ['Oct 2026'] }])), 'l1,l2');
  assert.equal(ids2(drillRows(ctx, def, {}, [{ ref: { form: 'lines', id: '_created' }, from: T('2026-10-01'), to: T('2026-10-06'), text: 'x' }])), 'l1');
  assert.equal(ids2(drillRows(ctx, def, {}, [{ ref: { form: 'lines', id: 'cat' }, keys: ['Labour', 'Materials'] }])), 'l1,l2,l3', '"Other" stands for several groups');
  const kpi = { form: 'lines', type: 'kpi', measure: { fn: 'count' }, compare: true };
  assert.equal(ids2(baseRows(ctx, kpi, {}, NOW)), 'l1,l2', 'a KPI compared with last month is this month’s records');
  assert.equal(drillLabel(ctx, { ref: { form: 'lines', id: 'cat' }, keys: ['Labour'] }), 'Category is Labour');
  assert.equal(drillLabel(ctx, { ref: { form: 'lines', id: '_created', by: 'month' }, keys: ['Oct 2026'] }), 'Created on in Oct 2026');
  assert.equal(drillLabel(ctx, { ref: { form: 'lines', id: 'cat' }, keys: ['a', 'b', 'c'] }), 'Category is one of 3');
});

test('reports fill in what their type needs', () => {
  const d = normalizeDef(ctx, { form: 'lines', type: 'pivot' });
  assert.ok(d.group && d.col && (d.group.id !== d.col.id || d.group.form !== d.col.form));
  assert.deepEqual(normalizeDef(ctx, { form: 'lines', type: 'line' }).time, { form: 'lines', id: '_created' });
  assert.ok(normalizeDef(ctx, { form: 'lines', type: 'table' }).columns.length >= 2);
  assert.deepEqual(normalizeDef(ctx, { form: 'lines', type: 'kpi', measure: { fn: 'sum', ref: { form: 'lines', id: 'gone' } } }).measure, { fn: 'count' });
  assert.equal(newDef(ctx, 'lines').type, 'bar');
  assert.ok(chainFields(ctx, 'lines').some((x) => x.ref.form === 'clients'));
});

test('old report canvases become a dashboard of saved reports', () => {
  const w = { id: 'w1', type: 'bar', form: 'lines', title: null, measure: { fn: 'count' }, group: { form: 'lines', id: 'cat' }, filter: { ref: { form: 'lines', id: 'bill' }, op: 'not', value: 'No' }, cols: 6, rows: 2 };
  assert.deepEqual(defFromWidget(w).conditions, [{ ref: { form: 'lines', id: 'bill' }, op: 'not', value: 'No' }]);
  const mig = migrateLegacy({ id: 'R', name: 'Ops', ownerId: 'u1', shared: true, widgets: [w, { id: 'w2', type: 'kpi', form: 'lines', title: 'Lines', measure: { fn: 'count' }, cols: 3, rows: 1 }] }, () => 'Auto');
  assert.equal(mig.dashboard.id, 'mig-R');
  assert.deepEqual(mig.dashboard.data.tiles.map((t) => [t.report, t.cols]), [['mig-R-w1', 6], ['mig-R-w2', 3]]);
  assert.deepEqual(mig.reports.map((r) => r.data.name), ['Auto', 'Lines']);
  assert.equal(mig.dashboard.data.shared, true);
});

test('who sees shared items; where a report is used', () => {
  const memberA = { role: 'member', groups: ['g1'] }, memberB = { role: 'member', groups: [] };
  const item = { ownerId: 'x', shared: true, groups: ['g1'] };
  assert.equal(visibleTo(item, memberA, 'a'), true);
  assert.equal(visibleTo(item, memberB, 'b'), false);
  assert.equal(visibleTo({ ...item, groups: [] }, memberB, 'b'), true);
  assert.equal(visibleTo({ ...item, shared: false }, memberA, 'a'), false);
  assert.equal(visibleTo({ ...item, shared: false }, { role: 'admin' }, 'z'), true);
  assert.equal(visibleTo({ ...item, shared: false }, memberB, 'x'), true);
  assert.deepEqual(usedOn([{ id: 'd1', tiles: [{ report: 'r1' }] }, { id: 'd2', tiles: [{ text: {} }] }], 'r1').map((d) => d.id), ['d1']);
});

test('dashboard addresses', () => {
  assert.deepEqual(parseRoute('#/dashboards'), { kind: 'dashboards' });
  assert.deepEqual(parseRoute('#/dashboard/db1'), { kind: 'dashboard', id: 'db1' });
  assert.equal(routeFor({ name: 'dashboard', dashboardId: 'a b' }), '#/dashboard/a%20b');
  assert.equal(routeFor({ name: 'dashboards' }), '#/dashboards');
});

import { canvasTiles, gridTiles, resolveCanvas, placeTile, canvasHeight, tileSize, readingOrder } from '../../src/dashlogic.js';

test('canvas: old row layouts get positions', () => {
  const t = canvasTiles([{ id: 'a', report: 'r', cols: 4, rows: 1 }, { id: 'b', report: 'r', cols: 8, rows: 2 }, { id: 'c', text: {}, cols: 6, rows: 2 }]);
  assert.deepEqual(t.map((x) => [x.x, x.y, x.w, x.h]), [[0, 0, 4, 4], [4, 0, 8, 4], [0, 4, 12, 4]]);
  assert.ok(!('cols' in t[0]));
  assert.deepEqual(canvasTiles([{ id: 'a', x: 23, y: -2, w: 4, h: 0 }])[0], { id: 'a', x: 20, y: 0, w: 4, h: 3 }, 'a report is at least three cells tall');
  assert.equal(canvasTiles([{ id: 't', text: {}, x: 0, y: 0, w: 4, h: 1 }])[0].h, 2, 'a text block at least two');
});

test('canvas: dashboards from the 12-column grid double onto the 24-column square grid', () => {
  const old = [{ id: 'a', report: 'r', x: 0, y: 0, w: 3, h: 2 }, { id: 'b', report: 'r', x: 3, y: 0, w: 9, h: 4 }];
  assert.deepEqual(gridTiles(old, { period: 'all' }).map((t) => [t.x, t.y, t.w, t.h]), [[0, 0, 6, 4], [6, 0, 18, 8]]);
  assert.deepEqual(gridTiles(old, { grid: 24 }).map((t) => [t.x, t.y, t.w, t.h]), [[0, 0, 3, 3], [3, 0, 9, 4]], 'already on the new grid: kept');
  const legacy = gridTiles([{ id: 'a', report: 'r', cols: 6, rows: 2 }], undefined);
  assert.deepEqual([legacy[0].w, legacy[0].h], [24, 8], 'the oldest row layout (a lone tile filled its row) lands on the new grid too');
});

test('canvas: moving pushes overlaps down; gaps stay unless floating up', () => {
  const tiles = [{ id: 'a', x: 0, y: 0, w: 6, h: 4 }, { id: 'b', x: 6, y: 0, w: 6, h: 4 }, { id: 'c', x: 0, y: 8, w: 4, h: 4 }];
  const moved = resolveCanvas(tiles.map((t) => (t.id === 'c' ? { ...t, x: 0, y: 2 } : t)), 'c', false);
  const pos = Object.fromEntries(moved.map((t) => [t.id, [t.x, t.y]]));
  assert.deepEqual(pos.c, [0, 2]); assert.deepEqual(pos.a, [0, 6]); assert.deepEqual(pos.b, [6, 0]);
  const gap = resolveCanvas(tiles, null, false);
  assert.equal(gap.find((t) => t.id === 'c').y, 8); // gap kept
  const up = resolveCanvas(tiles, null, true);
  assert.equal(up.find((t) => t.id === 'c').y, 4); // floated up
  const wide = resolveCanvas(tiles.map((t) => (t.id === 'a' ? { ...t, w: 9 } : t)), 'a', false);
  assert.equal(wide.find((t) => t.id === 'b').y, 4); // resized into b: b moves down
});

test('canvas: new tiles go in the first free spot; sizes; order; height', () => {
  const tiles = [{ id: 'a', x: 0, y: 0, w: 6, h: 4 }];
  assert.deepEqual(placeTile(tiles, 6, 4), { x: 6, y: 0 });
  assert.deepEqual(placeTile(tiles, 20, 4), { x: 0, y: 4 });
  assert.deepEqual(tileSize('kpi'), { w: 6, h: 4 });
  assert.deepEqual(tileSize('pivot'), { w: 24, h: 10 });
  assert.deepEqual(readingOrder([{ id: 'b', x: 6, y: 0 }, { id: 'c', x: 0, y: 3 }, { id: 'a', x: 0, y: 0 }]).map((t) => t.id), ['a', 'b', 'c']);
  assert.equal(canvasHeight([{ y: 2, h: 3 }, { y: 0, h: 1 }]), 5);
});
