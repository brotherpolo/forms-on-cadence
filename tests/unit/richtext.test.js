// Formatted long text (src/richtext.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRich, toHTML, toText, plainToBlocks, isPlain, richBlocks, editorHTML, fromEditor, withRich, cleanColor, cleanHref, RICH_KEY } from '../../src/richtext.js';

const ED = '<p>Renovate the lobby at <b>12 King St.</b> by <u>March 3</u>.</p><h3>Scope</h3><ul><li>Flooring</li><li>Desk (<i>client supplies</i>)</li></ul><ol><li>Strip</li><li>Paint <span style="color: rgb(180, 35, 53);">TBC</span></li></ol><blockquote>Keep the mural</blockquote><p>See <a href="https://example.com/x">the folder</a>.</p>';

test('editor HTML → blocks → text and clean HTML', () => {
  const b = parseRich(ED);
  assert.deepEqual(b.map((x) => x.t), ['p', 'h3', 'li', 'li', 'li', 'li', 'quote', 'p']);
  assert.deepEqual(b[0].runs, [{ s: 'Renovate the lobby at ' }, { s: '12 King St.', b: true }, { s: ' by ' }, { s: 'March 3', u: true }, { s: '.' }]);
  assert.deepEqual(b[5].runs[1], { s: 'TBC', c: '#b42335' });
  assert.equal(b[7].runs[1].a, 'https://example.com/x');
  assert.equal(toText(b), 'Renovate the lobby at 12 King St. by March 3.\nScope\n• Flooring\n• Desk (client supplies)\n1. Strip\n2. Paint TBC\nKeep the mural\nSee the folder.');
  const h = toHTML(b);
  assert.deepEqual(parseRich(h), b, 'round trip');
  assert.match(h, /<ol><li>Strip<\/li><li>Paint <span style="color: #b42335">TBC<\/span><\/li><\/ol>/);
  assert.match(h, /<a href="https:\/\/example.com\/x" target="_blank" rel="noopener noreferrer">the folder<\/a>/);
});

test('cleans what it doesn’t know: scripts, events, styles, bad links, odd tags', () => {
  const b = parseRich('<div onclick="x()">Hi <script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:alert(3)">there</a><style>p{}</style><font color="#ff0000" face="Comic">red</font><span style="font-weight:700;font-size:40px">big</span></div>');
  assert.equal(toText(b), 'Hi therered' + 'big');
  const h = toHTML(b);
  assert.ok(!/script|onclick|onerror|javascript|style>|Comic|font-size/i.test(h), h);
  assert.match(h, /<span style="color: #ff0000">red<\/span><b>big<\/b>/);
  assert.equal(cleanHref('www.x.com'), 'https://www.x.com');
  assert.equal(cleanHref('data:text/html,hi'), '');
  assert.deepEqual(['#abc', 'RGB(1,2,3)', 'rgba(0,0,0,0)', 'red', 'url(x)'].map(cleanColor), ['#aabbcc', '#010203', '', '', '']);
});

test('the browser editor’s shapes: divs, br placeholders, nbsp, Word paste', () => {
  assert.equal(toText(parseRich('<div>one</div><div><br></div><div>two&nbsp;&nbsp;words</div>')), 'one\n\ntwo  words');
  assert.equal(toText(parseRich('<p>a<br>b<br></p>')), 'a\nb');
  assert.equal(toText(parseRich('<p></p><p><br></p><p><br></p><p>x</p><p><br></p>')), 'x', 'blank lines at the ends and doubles dropped');
  const word = '<html><head><style>.x{}</style></head><body><!--[if gte mso 9]>junk<![endif]--><p class=MsoNormal><b><span style=\'font-family:"Calibri"\'>Bold</span></b> <span style="mso-x:1">plain</span></p></body></html>';
  assert.deepEqual(parseRich(word), [{ t: 'p', runs: [{ s: 'Bold', b: true }, { s: ' plain' }] }]);
  assert.equal(toText(parseRich('a < b and 5 > 3 &amp; &#233;')), 'a < b and 5 > 3 & é');
});

test('plain values, stale formatting, and what gets stored', () => {
  assert.equal(isPlain(plainToBlocks('a\nb')), true);
  assert.equal(editorHTML({ f: 'one\n\ntwo <x>' }, 'f'), '<p>one</p><p><br></p><p>two &lt;x&gt;</p>');
  const e = fromEditor('<p>Hi <b>there</b></p>');
  assert.deepEqual(e, { text: 'Hi there', html: '<p>Hi <b>there</b></p>' });
  assert.deepEqual(fromEditor('<p>just words</p><p>more</p>'), { text: 'just words\nmore', html: null }, 'nothing to keep');
  assert.deepEqual(fromEditor('<p><br></p>'), { text: '', html: null });
  let v = withRich({ f: e.text }, 'f', e.html);
  assert.equal(v[RICH_KEY].f, e.html);
  assert.equal(richBlocks(v, 'f')[0].runs[1].b, true);
  assert.equal(richBlocks({ ...v, f: 'Changed by an import' }, 'f'), null, 'stale: the words changed elsewhere');
  assert.equal(editorHTML({ ...v, f: 'Changed' }, 'f'), '<p>Changed</p>');
  v = withRich(v, 'f', null);
  assert.equal(RICH_KEY in v, false);
  assert.equal(richBlocks({ f: 'x', [RICH_KEY]: { f: 42 } }, 'f'), null);
});

test('PDF layout of formatted text: wraps across styles, headings bigger, bullets and numbers', async () => {
  const { layoutRich } = await import('../../src/pdfdoc.js');
  const m = (f, size, s) => s.length * size * (f === 'b' || f === 'bi' ? 0.6 : 0.5);
  const b = parseRich('<h3>Scope</h3><p>Some <b>bold words</b> and <i>more</i> text that wraps</p><ol><li>One</li><li>Two</li></ol><blockquote>Q</blockquote>');
  const L = layoutRich(b, 120, m, { size: 10, lh: 14 });
  assert.equal(L[0].items[0].font, 'b'); assert.ok(L[0].items[0].size > 10 && L[0].h > 14, 'heading is bigger');
  const para = L.filter((l) => l.items.some((t) => /Some|wraps|text|more/.test(t.s)));
  assert.ok(para.length >= 2, 'wrapped');
  assert.ok(para.every((l) => l.items.every((t) => t.x + m(t.font, t.size, t.s) <= 120.001)), 'fits');
  assert.ok(para[0].items.some((t) => t.font === 'b' && /bold/.test(t.s)));
  assert.deepEqual(L.filter((l) => l.prefix).map((l) => l.prefix.s), ['1.', '2.']);
  assert.ok(L.find((l) => l.prefix).items[0].x >= 15, 'list text indented');
  assert.equal(L.at(-1).bar, true);
  assert.equal(toText(b).split('\n').length, 5);
});
