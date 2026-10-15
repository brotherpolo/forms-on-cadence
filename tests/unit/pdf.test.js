// Export PDF: the pure layout helpers (pdfdoc.js) and a full drawing (pdfdraw.js) with the bundled pdf-lib.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldItem, fieldRows, safeText, wrapText, colWidths, fileName, fitBox, trimBox } from '../../src/pdfdoc.js';
import { drawPdf } from '../../src/pdfdraw.js';
import * as L from '../../public/vendor/pdf-lib.min.js';

const f = (type, label, width = 'half', extra = {}) => ({ type, label, width, ...extra });
const mono = (s) => String(s).length; // every character 1 unit wide

test('field items: each type prints the right way', () => {
  assert.deepEqual(fieldItem(f('text', 'Name'), 'Jo', 'Jo'), { kind: 'text', label: 'Name', width: 'half', text: 'Jo' });
  assert.equal(fieldItem(f('textarea', 'Notes', 'half'), 'a', 'a').width, 'full', 'long text always takes the full width');
  assert.equal(fieldItem(f('text', 'Empty'), '', '').text, '', 'empty fields print empty');
  assert.equal(fieldItem(f('checkbox', 'Done'), false, 'No').text, 'No', 'an unticked box says No');
  assert.deepEqual(fieldItem(f('image', 'Roof'), { name: 'r.jpg', path: 'uploads/f/u/r.jpg', url: 'https://x' }, 'r.jpg').src, { path: 'uploads/f/u/r.jpg', url: 'https://x' });
  assert.equal(fieldItem(f('signature', 'Sign'), 'data:image/png;base64,AAA', 'Signed').src, 'data:image/png;base64,AAA');
  assert.equal(fieldItem(f('signature', 'Sign'), 'javascript:x', 'Signed').src, '', 'only pictures are drawn');
  assert.equal(fieldItem(f('file', 'Doc'), { name: 'a.pdf', size: 2048 }, 'a.pdf').text, 'a.pdf · 2 KB');
  assert.deepEqual([fieldItem(f('rating', 'Stars', 'half', { max: 5 }), 4, '').n, fieldItem(f('rating', 'Stars', 'half', { max: 5 }), 4, '').max], [4, 5]);
  assert.equal(fieldItem(f('color', 'Paint'), '#3a7bd5', '#3a7bd5').hex, '#3a7bd5');
  assert.deepEqual(fieldItem(f('heading', 'Inspection', 'full', { help: 'On site' }), null, ''), { kind: 'heading', label: 'Inspection', help: 'On site' });
});

test('field rows: half-width fields pair up, like the record page', () => {
  const it = (label, width, kind = 'text') => ({ kind, label, width, text: '' });
  const rows = fieldRows([it('a', 'half'), it('b', 'half'), it('c', 'half'), { kind: 'heading', label: 'H' }, it('d', 'half'), it('e', 'full'), it('f', 'half'), it('g', 'half')]);
  assert.deepEqual(rows.map((r) => (r.heading ? '#' + r.heading.label : r.cells.map((c) => c.label).join('+'))), ['a+b', 'c', '#H', 'd', 'e', 'f+g']);
});

test('text the standard fonts can draw', () => {
  const has = (cp) => cp < 256 || [0x2014, 0x2026, 0x2022, 0x201c, 0x201d].includes(cp);
  assert.equal(safeText('Café — “ok”…', has), 'Café — “ok”…');
  assert.equal(safeText('a → b ✓ 😀', has), 'a -> b v ?');
  assert.equal(safeText('ő\tx\r\ny', has), 'o    x\ny', 'accents the font lacks drop; tabs and line endings tidy up');
});

test('wrapping keeps words whole, keeps line breaks and cuts very long words', () => {
  assert.deepEqual(wrapText('one two three four', 9, mono), ['one two', 'three', 'four']);
  assert.deepEqual(wrapText('a\n\nb', 10, mono), ['a', '', 'b']);
  assert.deepEqual(wrapText('abcdefghij', 4, mono), ['abcd', 'efg', 'hij'], 'no piece shorter than 3');
  assert.deepEqual(wrapText('', 10, mono), ['']);
});

test('table columns fill the width and never get too thin', () => {
  const w1 = colWidths([{ label: 'Item' }, { label: 'Cost' }], [['Shingles', '$12']], mono, 100, { min: 1, pad: 0 });
  assert.equal(Math.round(w1.reduce((a, b) => a + b, 0)), 100);
  assert.ok(w1[0] > w1[1], 'the wider column gets more room');
  const many = Array.from({ length: 12 }, (_, i) => ({ label: 'Column ' + i }));
  const w2 = colWidths(many, [many.map(() => 'x'.repeat(80))], mono, 500, { min: 30, cap: 200, pad: 10 });
  assert.ok(Math.abs(w2.reduce((a, b) => a + b, 0) - 500) < 0.5, 'squeezed to fit');
  assert.ok(w2.every((w) => w >= 30 - 1e-6));
});

test('file names, picture sizes and logo trimming', () => {
  assert.equal(fileName('Site visit', 'Smith house: 12/3'), 'Site visit - Smith house 12 3.pdf');
  assert.equal(fileName('', ''), 'Record.pdf');
  assert.ok(fileName('F', 'x'.repeat(300)).length <= 124);
  assert.deepEqual(fitBox(1000, 500, 200, 200), { w: 200, h: 100 });
  assert.deepEqual(fitBox(100, 50, 400, 400, 0.5), { w: 50, h: 25 }, 'small pictures are not blown up');
  // 6 × 4 picture: white border, a dark 2 × 1 block at (2,1)
  const w = 6, h = 4, d = new Uint8ClampedArray(w * h * 4).fill(255);
  [[2, 1], [3, 1]].forEach(([x, y]) => { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = 0; });
  assert.deepEqual(trimBox(d, w, h, 0), { x: 2, y: 1, w: 2, h: 1 });
  assert.deepEqual(trimBox(new Uint8ClampedArray(16).fill(255), 2, 2), { x: 0, y: 0, w: 2, h: 2 }, 'all blank: keep it all');
});

// a 1 × 1 PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

test('a whole record draws: letterhead, fields, a long grid over pages, page numbers', async () => {
  const items = [
    fieldItem(f('text', 'Site'), 'Smith house', 'Smith house'),
    fieldItem(f('date', 'Visit'), '2026-10-03', 'Oct 3, 2026'),
    fieldItem(f('heading', 'Inspection'), null, ''),
    fieldItem(f('rating', 'Condition', 'half', { max: 5 }), 3, '3 of 5'),
    fieldItem(f('color', 'Paint'), '#3a7bd5', '#3a7bd5'),
    fieldItem(f('textarea', 'Notes'), 'x', 'Long notes → with arrows and emoji 😀. '.repeat(40)),
    { ...fieldItem(f('signature', 'Signed by'), 'data:image/png;base64,x', 'Signed'), imgKey: 'sig' },
    fieldItem(f('image', 'Photo'), { name: 'gone.jpg', path: 'p' }, 'gone.jpg'), // couldn't be fetched: printed as its name
  ];
  const rows = Array.from({ length: 80 }, (_, i) => ['Item ' + i, 'Description '.repeat(i % 4 + 1), String(i), '$' + i]);
  const model = {
    brand: { name: 'Pollack Renovations', logoKey: 'logo' }, accent: '#0f7b6c', formName: 'Site visit', title: 'Smith house', meta: ['Created 3 Oct 2026 by Jane', 'Owner Jane'], parent: 'Clients: Smith',
    items, sections: [{ title: 'Materials', count: 80, cols: [{ label: 'Item' }, { label: 'Description' }, { label: 'Qty', num: true }, { label: 'Cost', num: true }], rows, total: ['Total', '', '3,160', '$3,160'] },
      { title: 'Follow-ups', count: 0, cols: [{ label: 'Title' }], rows: [], empty: 'No follow-ups.' }],
    stamp: 'Exported 14 Oct 2026 by Adam',
  };
  const bytes = await drawPdf(L, model, new Map([['logo', { bytes: PNG, type: 'png' }], ['sig', { bytes: PNG, type: 'png' }]]));
  const doc = await L.PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 3, 'the grid runs over several pages');
  assert.equal(doc.getTitle(), 'Site visit - Smith house');
  assert.equal(doc.getAuthor(), 'Pollack Renovations');
  assert.ok(Buffer.from(bytes).toString('latin1').startsWith('%PDF-'));
});

test('a bare record with no company, logo or pictures still draws', async () => {
  const bytes = await drawPdf(L, { formName: 'Note', title: '', items: [], sections: [], meta: [] });
  assert.equal((await L.PDFDocument.load(bytes)).getPageCount(), 1);
});

test('tables: words stay whole; smaller text, then landscape, before anything breaks', async () => {
  const { planTable } = await import('../../src/pdfdoc.js');
  const m = (size) => (t) => String(t).length * size * 0.5; // each character half the text size wide
  const measure = (size) => m(size);
  const spaces = [{ avail: 504 }, { avail: 684, landscape: true }];
  // 4 columns: fits at the normal size, and every column is at least its longest word
  const cols = [{ label: 'Item' }, { label: 'Description' }, { label: 'Qty', num: true }, { label: 'Amount', num: true }];
  const rows = [['Shingles', 'Architectural asphalt shingles, charcoal, 30-year warranty', '12', 'CA$1,234.56']];
  const p1 = planTable(cols, rows, measure, { spaces, pad: 10 });
  assert.deepEqual([p1.size, p1.landscape, p1.broken], [9.5, false, false]);
  assert.ok(p1.widths[3] >= 'CA$1,234.56'.length * 9.5 * 0.5 + 10 - 0.01, 'an amount is never split');
  assert.ok(p1.widths[1] >= 'Architectural'.length * 9.5 * 0.5 + 10 - 0.01, 'the longest word fits');
  assert.ok(Math.abs(p1.widths.reduce((a, b) => a + b, 0) - 504) < 0.5);
  // 12 wide columns: too much for portrait at any size → landscape
  const wide = Array.from({ length: 12 }, (_, i) => ({ label: 'Column ' + i, num: i > 0 }));
  const wrow = [['Description of work', ...Array.from({ length: 11 }, () => 'CA$12,345.67')]];
  const p2 = planTable(wide, wrow, measure, { spaces, pad: 10 });
  assert.equal(p2.landscape, true);
  assert.equal(p2.broken, false);
  // 20 of them: nothing fits; the smallest text on landscape, words allowed to break
  const p3 = planTable(Array.from({ length: 20 }, () => ({ label: 'X', num: true })), [Array.from({ length: 20 }, () => 'CA$12,345.67')], measure, { spaces, pad: 10 });
  assert.deepEqual([p3.size, p3.landscape, p3.broken], [7, true, true]);
});
