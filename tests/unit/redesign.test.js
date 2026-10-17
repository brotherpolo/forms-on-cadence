// The redesign's logic: the sidebar's Forms list, recent forms, Ctrl K matching, colour scheme and density.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushRecent, sidebarFormList } from '../../src/navlogic.js';
import { matchScore, paletteResults } from '../../src/palettelogic.js';
import { readScheme, applyScheme, readDensity, applyDensity } from '../../src/theme.js';

const F = (id, name, order, extra = {}) => ({ id, name, order, ...extra });
const forms = [F('a', 'Alpha', 1), F('b', 'Bravo', 2), F('c', 'Charlie', 3), F('d', 'Delta', 4), F('k', 'Kid', 5, { showInSidebar: false })];
forms[0].children = [{ formId: 'k' }];
const all = () => true;

test('recent forms: newest first, no repeats, capped', () => {
  assert.deepEqual(pushRecent(['b', 'a'], 'a'), ['a', 'b']);
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b']);
});

test('sidebar Forms: recent ones topped up, shown in the forms’ own order, children left out', () => {
  assert.deepEqual(sidebarFormList(forms, all, ['d', 'c'], 3).map((f) => f.id), ['a', 'c', 'd']);
  assert.deepEqual(sidebarFormList(forms, all, [], 6).map((f) => f.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(sidebarFormList(forms, (f) => f.id !== 'a', ['a'], 2).map((f) => f.id), ['b', 'c']);
});

test('Ctrl K matching: every word, name starts beat word starts beat anywhere', () => {
  assert.equal(matchScore('Lobby renovation', 'Projects', 'lob'), 4);
  assert.equal(matchScore('Big lobby', '', 'lob'), 3);
  assert.equal(matchScore('Bigglobby', '', 'lob'), 2);
  assert.equal(matchScore('Lobby renovation', 'Projects', 'projects lobby'), 1);
  assert.equal(matchScore('Lobby renovation', 'Projects', 'invoice'), 0);
});

test('Ctrl K results: pages and forms before records; empty shows recent records', () => {
  const items = [
    { kind: 'record', id: 'r1', label: 'Lobby renovation', sub: 'Projects', at: 5 },
    { kind: 'record', id: 'r2', label: 'Lobby repaint', sub: 'Projects', at: 9 },
    { kind: 'page', id: 'home', label: 'Home', sub: 'Page' },
    { kind: 'form', id: 'p', label: 'Lobby jobs', sub: 'Form' },
    { kind: 'new', id: 'p', label: 'New lobby job', sub: 'Lobby jobs' },
  ];
  assert.deepEqual(paletteResults(items, 'lobby').map((x) => x.id), ['p', 'r2', 'r1', 'p']);
  assert.deepEqual(paletteResults(items, '').map((x) => x.id), ['home', 'p', 'r2', 'r1']);
  assert.deepEqual(paletteResults(items, 'zzz'), []);
});

test('scheme and density: stored per device, default removes the setting', () => {
  const st = new Map(); const storage = { getItem: (k) => st.get(k) ?? null, setItem: (k, v) => st.set(k, v), removeItem: (k) => st.delete(k) };
  const doc = { documentElement: { dataset: {} } };
  assert.equal(readScheme(storage), 'indigo');
  assert.equal(applyScheme(doc, 'spruce', storage), 'spruce');
  assert.equal(doc.documentElement.dataset.scheme, 'spruce'); assert.equal(readScheme(storage), 'spruce');
  applyScheme(doc, 'indigo', storage);
  assert.equal(doc.documentElement.dataset.scheme, undefined); assert.equal(st.has('fw.scheme'), false);
  assert.equal(applyScheme(doc, 'nonsense', storage), 'indigo');
  applyDensity(doc, 'compact', storage);
  assert.equal(doc.documentElement.dataset.density, 'compact'); assert.equal(readDensity(storage), 'compact');
});
