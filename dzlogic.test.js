// Form designer canvas: type colours, sections and folding (src/dzlogic.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typeColors, categoryStyle, canvasRows, blockOf, moveBefore, stepTarget, sectionOf } from '../../src/dzlogic.js';

const TYPES = [['text', 'Short text', 'Aa', 'Text'], ['textarea', 'Long text', '¶', 'Text'], ['number', 'Whole number', '12', 'Numbers'], ['decimal', 'Decimal', '1.5', 'Numbers'], ['currency', 'Currency', '$', 'Numbers'], ['heading', 'Section heading', '§', 'Layout']];
const F = [{ id: 'a', type: 'text' }, { id: 'h1', type: 'heading' }, { id: 'b', type: 'number' }, { id: 'c', type: 'date' }, { id: 'h2', type: 'heading' }, { id: 'd', type: 'text' }, { id: 'h3', type: 'heading' }];
const ids = (fs) => fs.map((f) => f.id).join(' ');

test('colours: one hue per category, shaded from deep to light, light and dark', () => {
  const c = typeColors(TYPES);
  assert.equal(c.heading, undefined, 'sections are not a category colour');
  const hue = (s) => /hsl\((\d+)/.exec(s)[1], lig = (s) => parseFloat(/ ([\d.]+)%\)$/.exec(s)[1]);
  assert.equal(hue(c.number.light.fg), hue(c.currency.light.fg));
  assert.notEqual(hue(c.number.light.fg), hue(c.text.light.fg));
  assert.ok(lig(c.number.light.fg) < lig(c.decimal.light.fg) && lig(c.decimal.light.fg) < lig(c.currency.light.fg), 'shades step lighter');
  assert.ok(lig(c.number.dark.fg) > 60, 'dark: bright enough on a dark background');
  assert.match(c.text.style, /^--gl:hsl.*--gd:hsl.*--gdr:hsl/);
  assert.match(categoryStyle(TYPES, c, 'Numbers'), new RegExp(c.decimal.light.fg.replace(/[()]/g, '\\$&')));
});

test('canvas rows: sections, counts, last in section, folded hides its fields', () => {
  const r = canvasRows(F, new Set(['h1']));
  assert.deepEqual(r.map((x) => [x.field.id, x.section, x.hidden]), [['a', null, false], ['h1', null, false], ['b', 'h1', true], ['c', 'h1', true], ['h2', null, false], ['d', 'h2', false], ['h3', null, false]]);
  assert.deepEqual([r[1].count, r[1].folded, r[4].count, r[6].count], [2, true, 1, 0]);
  assert.deepEqual(r.filter((x) => x.last).map((x) => x.field.id), ['c', 'd']);
});

test('moving: a folded section moves whole, before a row, to the end, or not at all', () => {
  assert.deepEqual(blockOf(F, 'h1', new Set(['h1'])), ['h1', 'b', 'c']);
  assert.deepEqual(blockOf(F, 'h1'), ['h1'], 'open: just the heading');
  assert.equal(ids(moveBefore(F, ['h1', 'b', 'c'], 'h3')), 'a h2 d h1 b c h3');
  assert.equal(ids(moveBefore(F, ['a'], null)), 'h1 b c h2 d h3 a');
  assert.equal(moveBefore(F, ['a'], 'h1'), null, 'already there');
  assert.equal(moveBefore(F, ['h1', 'b'], 'b'), null);
  assert.equal(sectionOf(F, 'c'), 'h1'); assert.equal(sectionOf(F, 'a'), null); assert.equal(sectionOf(F, 'h2'), null);
});

test('arrow keys step over a folded section and land at its end', () => {
  const vis = ['a', 'h1', 'h2', 'd', 'h3']; // h1 folded
  assert.equal(stepTarget(vis, 'a', 1), 'h2', 'a moves past folded h1: into the end of its section');
  assert.equal(ids(moveBefore(F, ['a'], stepTarget(vis, 'a', 1))), 'h1 b c a h2 d h3');
  assert.equal(stepTarget(vis, 'd', -1), 'h2');
  assert.equal(stepTarget(vis, 'h3', 1), undefined);
  assert.equal(stepTarget(vis, 'd', 1), null, 'past the last row: the end');
  assert.equal(stepTarget(vis, 'a', -1), undefined);
});

test('a folded section never splits another', async () => {
  const { snapBefore, sectionStep } = await import('../../src/dzlogic.js');
  assert.equal(snapBefore(F, 'd'), 'h3', 'dropped inside h2: lands at its end');
  assert.equal(snapBefore(F, 'h2'), 'h2');
  assert.equal(snapBefore(F, null), null);
  assert.equal(snapBefore([{ id: 'x', type: 'text' }], 'x'), null);
  assert.equal(sectionStep(F, 'h1', 1), 'h3', 'down: past all of h2');
  assert.equal(ids(moveBefore(F, ['h1', 'b', 'c'], sectionStep(F, 'h1', 1))), 'a h2 d h1 b c h3');
  assert.equal(sectionStep(F, 'h2', -1), 'h1');
  assert.equal(sectionStep(F, 'h1', -1), undefined, 'first section stays below the fields before it');
  assert.equal(sectionStep(F, 'h2', 1), null, 'down past the last: the end');
  assert.equal(sectionStep(F, 'h3', 1), undefined);
});
