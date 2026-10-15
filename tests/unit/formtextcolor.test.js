// Text view colours (src/formtextcolor.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineParts, sectionsIn, namesIn, paint } from '../../src/formtextcolor.js';

const kinds = (l, known, check) => lineParts(l, known, check).pieces.map((p) => [p.k, p.t]);

test('a field line, piece by piece, keeping every character', () => {
  const l = 'Stage: dropdown [Scoping, "A, B"], half, help "Where it is"  @p_stage';
  const r = lineParts(l);
  assert.equal(r.pieces.map((p) => p.t).join(''), l);
  assert.equal(r.kind, 'field'); assert.equal(r.bad, false);
  const k = kinds(l);
  assert.deepEqual(k.filter(([x]) => !['plain', 'punct'].includes(x)), [['cap', 'Stage'], ['type', 'dropdown'], ['opt', 'Scoping'], ['str', '"A, B"'], ['kw', 'half'], ['kw', 'help'], ['str', '"Where it is"'], ['tag', '@p_stage']]);
});

test('headings, comments, settings with numbers, links, system names', () => {
  assert.deepEqual(kinds('# Contact, help "Who to call"  @k').filter(([x]) => x !== 'plain' && x !== 'punct'), [['head', '# Contact'], ['kw', 'help'], ['str', '"Who to call"'], ['tag', '@k']]);
  assert.equal(lineParts('# Contact').kind, 'heading');
  assert.deepEqual(kinds('// a note'), [['comment', '// a note']]);
  assert.ok(kinds('Budget: currency, min 0').some(([k, t]) => k === 'num' && t === '0'));
  assert.ok(kinds('Client: link to Clients').some(([k, t]) => k === 'type' && t === 'link to'));
  assert.ok(kinds('Name: text, system name "Contact name"').some(([k, t]) => k === 'kw' && t === 'system name'));
  assert.equal(lineParts('').kind, 'blank');
});

test('calculations: references, functions, numbers, text', () => {
  const known = new Set(['budget']);
  const k = kinds('Tax: calculated, as currency = ROUND({Budget} * 1.13, 2) & "x"', known);
  assert.ok(k.some(([x, t]) => x === 'type' && t === 'currency'), 'as currency');
  assert.ok(k.some(([x, t]) => x === 'fn' && t === 'ROUND'));
  assert.ok(k.some(([x, t]) => x === 'ref' && t === '{Budget}'));
  assert.ok(k.some(([x, t]) => x === 'num' && t === '1.13'));
  assert.ok(k.some(([x, t]) => x === 'str' && t === '"x"'));
  assert.ok(kinds('T: calculated = {Nope} + 1', known).some(([x]) => x === 'referr'), 'not on the form');
  assert.ok(!kinds('T: calculated = CHILDSUM({Line items}, {Amount})', known).some(([x]) => x === 'referr'), 'other forms are not checked');
});

test('what isn’t understood is marked, except on the line being typed', () => {
  assert.equal(lineParts('Notes: long txt, full').bad, true);
  assert.equal(lineParts('Notes: long text, ful').bad, true);
  assert.equal(lineParts('Notes: long text, ful', new Set(), false).bad, false);
  assert.equal(lineParts('Name: Short Text, Required, In List').bad, false, 'any case');
});

test('names, sections and the painted HTML', () => {
  const txt = '# Client  @a\nName: text, system name "Client name"\n# "Sign, off"\nTotal: calculated = {client name} + {Gone}';
  assert.deepEqual([...namesIn(txt)].sort(), ['client name', 'name', 'total']);
  assert.deepEqual(sectionsIn(txt), [{ line: 1, name: 'Client' }, { line: 3, name: 'Sign, off' }]);
  const p = paint(txt, { problems: new Map([[2, 'Bad <thing>']]) });
  assert.equal(p.count, 2, 'line 2 from the parser, line 4 from {Gone}');
  assert.match(p.gut, /title="Bad &lt;thing&gt;"/);
  assert.equal((p.code.match(/class="tx-l tx-h"/g) || []).length, 2);
  assert.equal(paint(txt, { caretLine: 4 }).count, 0, 'not while typing on it');
  assert.match(paint('A: text <b>').code, /&lt;b&gt;/);
});
