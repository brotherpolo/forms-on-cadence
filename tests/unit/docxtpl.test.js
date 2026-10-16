// Word templates (src/docxtpl.js): reading placeholders, conditions, repeats, pictures, the whole file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findTags, splitOpts, parseTag, fmtDate, formatValue, parseCond, evalCond, normalise, readPart, fillDocx, checkDocx, docText, imageSize } from '../../src/docxtpl.js';
import { parseXml, writeXml, findAll } from '../../src/docxxml.js';
import { zip, unzip } from '../../src/xlsx.js';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docXml = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`;
const P = (...runs) => `<w:p>${runs.map((r) => `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`).join('')}</w:p>`;
const enc = (s) => new TextEncoder().encode(s);
async function makeDocx(body) {
  return zip([
    { name: '[Content_Types].xml', data: enc('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: 'word/document.xml', data: enc(docXml(body)) },
  ]);
}
async function bodyText(bytes) {
  const files = unzip(bytes);
  return docText(new TextDecoder().decode(await files.get('word/document.xml')()));
}
function scope(vals, lists = {}) {
  return {
    get: (n) => (n in vals ? (typeof vals[n] === 'object' && vals[n] && 'type' in vals[n] ? vals[n] : { type: typeof vals[n] === 'boolean' ? 'checkbox' : 'text', v: vals[n], text: Array.isArray(vals[n]) ? vals[n].join(', ') : String(vals[n] ?? '') }) : null),
    list: (n) => (n in lists ? lists[n].map((r) => scope(r)) : null),
    calc: (e) => (e.trim() === '1 + 1' ? { v: 2 } : e.includes('bad') ? { e: 'That doesn’t work.' } : { v: 1234.5 }),
    image: (n) => (n === 'Photo' ? Promise.resolve({ bytes: PNG, type: 'png' }) : n === 'Empty' ? Promise.resolve(null) : undefined),
  };
}
// a 2×1 PNG header is enough for sizes
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 200, 0, 0, 0, 100, 8, 6, 0, 0, 0]);

test('finding placeholders: braces inside formulas, quotes, and {{', () => {
  assert.deepEqual(findTags('Hi {Name}, {= {Qty} * 2} and {{x}').map((t) => (t.esc ? 'ESC' : t.inner)), ['Name', '= {Qty} * 2', 'ESC']);
  assert.deepEqual(findTags('{Date|"MMM d, yyyy"}').map((t) => t.inner), ['Date|"MMM d, yyyy"']);
  assert.deepEqual(findTags('{never closed').length, 0);
  assert.deepEqual(splitOpts('Date|"a|b"|long'), ['Date', '"a|b"', 'long']);
  assert.deepEqual(parseTag('#each Line items|sort Amount desc'), { k: 'each', name: 'Line items', opts: ['sort Amount desc'], raw: '#each Line items|sort Amount desc' });
  assert.equal(parseTag('= CHILDSUM("A", "B")|currency').expr, 'CHILDSUM("A", "B")');
  assert.equal(parseTag('%Photo|width=5cm').k, 'img');
  assert.equal(parseTag('#if Stage = "Done"').cond, 'Stage = "Done"');
  assert.equal(parseTag('/each').k, '/each');
});

test('Word’s split pieces are put back together', () => {
  const root = parseXml(`<w:p ${W}><w:r><w:t>Dear {Cli</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ent na</w:t></w:r><w:r><w:t>me}, hi</w:t></w:r></w:p>`);
  const p = root.kids[0];
  normalise(p);
  assert.deepEqual(findAll(p, 'w:t').map((t) => t.kids.map((k) => k.v).join('')), ['Dear {Client name}', '', ', hi']);
});

test('dates, numbers and options', () => {
  const d = new Date(2026, 9, 20, 14, 5);
  assert.equal(fmtDate(d, 'yyyy-MM-dd HH:mm'), '2026-10-20 14:05');
  assert.equal(fmtDate(d, "MMM d, yyyy 'at' h:mm a"), 'Oct 20, 2026 at 2:05 PM');
  assert.equal(fmtDate(d, 'EEEE'), 'Tuesday');
  assert.equal(formatValue({ type: 'date', v: '2026-10-20', text: 'Oct 20, 2026' }, ['long']).text, 'October 20, 2026');
  assert.equal(formatValue({ type: 'date', v: '2026-10-20', text: 'x' }, ['"d MMMM"']).text, '20 October');
  assert.equal(formatValue({ type: 'number', v: 1234.567, text: '1,234.567' }, ['0.0']).text, '1234.6');
  assert.equal(formatValue({ type: 'number', v: 1234.567, text: '' }, ['#,##0']).text, '1,235');
  assert.equal(formatValue({ type: 'number', v: 5, text: '5' }, ['currency'], { currency: 'CAD' }).text, 'CA$5.00');
  assert.equal(formatValue({ type: 'checkbox', v: true, text: 'Yes' }).text, '✓');
  assert.equal(formatValue({ type: 'checkbox', v: false, text: 'No' }).text, '');
  assert.equal(formatValue({ type: 'checkbox', v: false, text: 'No' }, ['Yes/No']).text, 'No');
  assert.equal(formatValue({ type: 'text', v: 'maple clinics', text: 'maple clinics' }, ['title']).text, 'Maple Clinics');
  assert.equal(formatValue({ type: 'text', v: '', text: '' }, ['or "None"']).text, 'None');
  const b = formatValue({ type: 'multiselect', v: ['A', 'B'], text: 'A, B' }, ['bullets']);
  assert.equal(b.blocks.length, 2);
  assert.equal(b.blocks[0].t, 'li');
  const R = {};
  formatValue({ type: 'text', v: 'x', text: 'x' }, ['sparkly'], R);
  assert.equal(R.warnings.size, 1);
});

test('conditions', () => {
  const sc = scope({ Stage: 'Approved', Budget: { type: 'currency', v: 48000, text: '' }, Billable: true, Notes: '', Issues: ['Power', 'Noise'], 'Client name': 'Maple' });
  const t = (c) => evalCond(parseCond(c), sc);
  assert.equal(t('Stage = "Approved"'), true);
  assert.equal(t('Stage = "approved"'), true, 'case doesn’t matter');
  assert.equal(t('Stage != "Approved"'), false);
  assert.equal(t('Budget > 10000 and Billable'), true);
  assert.equal(t('Budget > 100000 or not Billable'), false);
  assert.equal(t('Notes'), false, 'empty is false');
  assert.equal(t('not Notes'), true);
  assert.equal(t('Issues contains "power"'), true);
  assert.equal(t('Issues = "Noise"'), true);
  assert.equal(t('Billable = "Yes"'), true);
  assert.equal(t('Client name contains "map"'), true, 'names with spaces');
  assert.equal(t('(Stage = "Draft" or Stage = "Approved") and Budget >= 48000'), true);
  assert.equal(t('[Client name] = "Maple"'), true);
  assert.throws(() => parseCond('Stage = '), /ends too soon/);
  assert.throws(() => parseCond('(Stage = "x"'), /bracket/);
  const missing = new Set();
  assert.equal(evalCond(parseCond('Nope = 1'), sc, { missing }), false);
  assert.deepEqual([...missing], ['Nope']);
});

test('fields, inline and paragraph blocks', async () => {
  const bytes = await makeDocx(
    P('Dear {Name|upper}, total {= 1 + 1}.') +
    P('{#if Billable}', ) + P('Billable!') + P('{#else}') + P('Not billable') + P('{/if}') +
    P('A{#if Notes} with notes{/if}{#if not Notes} without notes{/if}.') +
    P('Price {{not a tag}.') +
    P('{Unknown}'),
  );
  const out = await fillDocx(bytes, scope({ Name: 'Dana', Billable: true, Notes: '' }));
  assert.deepEqual((await bodyText(out.bytes)).split('\n'), ['Dear DANA, total 2.', 'Billable!', 'A without notes.', 'Price {not a tag}.', '{Unknown}']);
  assert.deepEqual(out.missing, ['Unknown']);
});

test('repeating rows and paragraphs, sort and where', async () => {
  const row = (...cells) => `<w:tr>${cells.map((c) => `<w:tc>${P(c)}</w:tc>`).join('')}</w:tr>`;
  const bytes = await makeDocx(
    `<w:tbl><w:tblPr/><w:tblGrid/>${row('Item', 'Qty')}${row('{#each Lines|sort Qty desc|where Qty > 1}{Item}', '{Qty}{/each}')}${row('Total', '9')}</w:tbl>` +
    P('{#each Visits}') + P('- {Title}') + P('{/each}'),
  );
  const out = await fillDocx(bytes, scope({}, { Lines: [{ Item: 'A', Qty: 2 }, { Item: 'B', Qty: 5 }, { Item: 'C', Qty: 1 }], Visits: [{ Title: 'One' }, { Title: 'Two' }] }));
  const xml = new TextDecoder().decode(await unzip(out.bytes).get('word/document.xml')());
  assert.equal((xml.match(/<w:tr>/g) || []).length, 4, 'header, two matching lines, total');
  assert.deepEqual((await bodyText(out.bytes)).split('\n'), ['Item', 'Qty', 'B', '5', 'A', '2', 'Total', '9', '- One', '- Two']);
});

test('rows between two rows, and a block left open is reported', async () => {
  const row = (...cells) => `<w:tr>${cells.map((c) => `<w:tc>${P(c)}</w:tc>`).join('')}</w:tr>`;
  const ok = await makeDocx(`<w:tbl>${row('{#if Show}', '')}${row('Shown', 'row')}${row('{/if}', '')}${row('Always', '')}</w:tbl>`);
  assert.deepEqual((await bodyText((await fillDocx(ok, scope({ Show: false }))).bytes)).split('\n'), ['Always', '']);
  assert.deepEqual((await bodyText((await fillDocx(ok, scope({ Show: true }))).bytes)).split('\n'), ['Shown', 'row', 'Always', '']);
  const bad = await makeDocx(P('{#if Show}') + P('never closed'));
  await assert.rejects(fillDocx(bad, scope({ Show: true })), /has no \{\/if\}/);
  const bad2 = await makeDocx(P('{#if Show} text that runs on') + P('and on{/if}'));
  const c = await checkDocx(bad2, { has: () => true, list: () => null, formula: () => null, image: () => true });
  assert.match(c.errors.join(' '), /shares its line/);
});

test('formatted text becomes paragraphs; pictures go in', async () => {
  const bytes = await makeDocx(P('{Scope}') + P('Inline: {Scope}') + P('{%Photo|width=5cm}') + P('{%Empty}'));
  const blocks = [{ t: 'p', runs: [{ s: 'Refresh the ' }, { s: 'lobby', b: true }] }, { t: 'li', list: 'ul', runs: [{ s: 'Floors' }] }, { t: 'li', list: 'ol', n: 1, runs: [{ s: 'Paint' }] }];
  const out = await fillDocx(bytes, scope({ Scope: { type: 'textarea', v: 'Refresh the lobby\n• Floors\n1. Paint', text: 'Refresh the lobby\n• Floors\n1. Paint', blocks } }));
  const files = unzip(out.bytes);
  const xml = new TextDecoder().decode(await files.get('word/document.xml')());
  assert.match(xml, /<w:b\/><\/w:rPr><w:t>lobby<\/w:t>/, 'bold kept');
  assert.equal((await bodyText(out.bytes)).split('\n').slice(0, 3).join('|'), 'Refresh the lobby|•Floors|1.Paint');
  assert.match(xml, /<wp:extent cx="1800000" cy="900000"\/>/, '5 cm wide, same shape');
  assert.ok(files.has('word/media/fw1.png'));
  const rels = new TextDecoder().decode(await files.get('word/_rels/document.xml.rels')());
  assert.match(rels, /Id="rIdFw1"[^>]+Target="media\/fw1.png"/);
  const ct = new TextDecoder().decode(await files.get('[Content_Types].xml')());
  assert.match(ct, /Extension="png" ContentType="image\/png"/);
  assert.deepEqual(imageSize(PNG), { w: 200, h: 100 });
});

test('the sample quote template: every placeholder is known, and it fills in', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('../fixtures/quote-template.docx', import.meta.url)));
  const known = new Set(['Quote number', 'Today', 'Client: Client name', 'Contact name', 'Contact email', 'Project name', 'Stage', 'Start date', 'Due date', 'Budget', 'Estimated hours', 'Safety briefing done', 'Billable', 'Notes', 'Scope of work', 'Approved on', 'Signed by', 'Signed on', 'Exported by', 'Now', 'Created by', 'Created', 'Last updated', 'Item name', 'Owner', 'Company name']);
  const kid = { has: (n) => ['Description', 'Qty', 'Unit price', 'Amount', 'Visit summary', 'Visited at', 'Contact on site'].includes(n), list: () => null, formula: () => null, image: () => false };
  const schema = { has: (n) => known.has(n), list: (n) => (n === 'Line items' || n === 'Site visits' ? kid : null), formula: (e) => (/CHILD/.test(e) ? null : 'bad'), image: (n) => ['Site photo', 'Signature', 'Logo'].includes(n) };
  const c = await checkDocx(bytes, schema);
  assert.deepEqual(c.errors, []);
  assert.deepEqual(c.tags.filter((t) => !t.ok), []);
  assert.ok(c.tags.some((t) => t.text === '{Client: Client name|upper}' && t.ok));
  assert.ok(c.tags.some((t) => t.text === '{#each Line items}' && t.ok));
  assert.ok(c.tags.length > 40);
});
