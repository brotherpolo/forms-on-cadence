// Reading and writing spreadsheets for imports, with no extra packages.
//   writeXlsx(sheets)  -> Uint8Array of an .xlsx file (Excel, Google Sheets, Numbers)
//   readSheets(bytes)  -> [{ name, hidden, rows }] from an .xlsx or .csv file
// .xlsx files are zip archives of XML; the zip is written and read here, and compressed
// with the browser's own CompressionStream / DecompressionStream. Works in Node 22 too,
// which the unit tests use.

const enc = new TextEncoder();

/* ---------- zip ---------- */

let CRC;
function crc32(u8) {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function through(u8, stream) {
  const s = new Blob([u8]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** files: [{ name, data: Uint8Array }] -> zip bytes (deflated when the browser can). */
export async function zip(files) {
  const canDeflate = typeof CompressionStream === 'function';
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    let body = f.data, method = 0;
    if (canDeflate && f.data.length > 64) {
      const z = await through(f.data, new CompressionStream('deflate-raw'));
      if (z.length < f.data.length) { body = z; method = 8; }
    }
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(8, method, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
    h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, f.data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, body);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, method, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, f.data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  all.forEach((p) => { out.set(p, at); at += p.length; });
  return out;
}

/** zip bytes -> Map(name -> async () => Uint8Array). Throws on anything that isn't a zip. */
export function unzip(u8) {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map();
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip directory');
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const body = u8.subarray(start, start + csize);
    out.set(name, async () => {
      if (method === 0) return body;
      if (method === 8) return through(body, new DecompressionStream('deflate-raw'));
      throw new Error('unsupported zip compression');
    });
  }
  return out;
}

/* ---------- XML helpers ---------- */

const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export const xmlEsc = (s) =>
  String(s ?? '').replace(BAD_XML, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function unEsc(s) {
  return String(s)
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
      const k = e.toLowerCase();
      if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'amp') return '&';
      if (k === 'quot') return '"'; if (k === 'apos') return "'";
      const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      try { return String.fromCodePoint(n); } catch (err) { return ''; }
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

function attrs(s) {
  const o = {};
  String(s || '').replace(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (m, k, q, a, b) => { o[k] = unEsc(a ?? b ?? ''); return ''; });
  return o;
}

/** Drop namespace prefixes from tag names (<x:row> -> <row>), keep attributes as they are. */
const unprefix = (xml) => xml.replace(/<(\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z_])/g, '<$1');

/** All text inside <t> tags (a shared string or inline string), without phonetic hints. */
function textOf(xml) {
  let s = '';
  String(xml).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<t\b[^>]*\/>|<t\b[^>]*>([\s\S]*?)<\/t>/g, (m, t) => { s += t ? unEsc(t) : ''; return ''; });
  return s;
}

/* ---------- column letters ---------- */

export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ---------- writing .xlsx ---------- */

// Cell styles (index into cellXfs below).
const STYLE = { head: 1, idhead: 2, date: 3, datetime: 4, time: 5, text: 6, wrap: 7, bold: 8 };

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="166" formatCode="hh:mm"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF5A6174"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E6FB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="49" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** A sheet name Excel accepts: 31 characters, none of : \ / ? * [ ], unique in the workbook. */
export function sheetName(name, taken = new Set()) {
  let base = String(name || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet';
  if (base.toLowerCase() === 'history') base = 'History 1';
  let n = base, i = 2;
  while (taken.has(n.toLowerCase())) { const suf = ' ' + i++; n = base.slice(0, 31 - suf.length) + suf; }
  taken.add(n.toLowerCase());
  return n;
}

function cellXml(ref, cell) {
  if (cell == null || cell === '') return '';
  const c = typeof cell === 'object' && !Array.isArray(cell) ? cell : { v: cell };
  const s = c.s ? ` s="${STYLE[c.s] || 0}"` : '';
  const v = c.v;
  if (v == null || v === '') return c.s ? `<c r="${ref}"${s}/>` : '';
  if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  const t = String(v);
  const sp = /^\s|\s$|\n/.test(t) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}"${s} t="inlineStr"><is><t${sp}>${xmlEsc(t)}</t></is></c>`;
}

function sheetXml(sh) {
  const cols = (sh.cols || []).map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}"${c.style ? ` style="${STYLE[c.style] || 0}"` : ''} customWidth="1"/>`).join('');
  const rows = (sh.rows || []).map((r, ri) => {
    const cells = r.map((cell, ci) => cellXml(colName(ci) + (ri + 1), cell)).join('');
    return cells ? `<row r="${ri + 1}">${cells}</row>` : '';
  }).join('');
  const dv = (sh.validations || []).map((x) =>
    `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"${x.warn ? ' errorStyle="warning"' : ''} errorTitle="${xmlEsc(x.errorTitle || 'Not on the list')}" error="${xmlEsc(x.error || 'Pick a value from the list.')}" sqref="${x.sqref}"><formula1>${xmlEsc(x.list)}</formula1></dataValidation>`
  ).join('');
  const pane = sh.freeze ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"${sh.first ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${rows}</sheetData>${dv ? `<dataValidations count="${sh.validations.length}">${dv}</dataValidations>` : ''}</worksheet>`;
}

/**
 * sheets: [{ name, rows: [[cell]], cols: [{ width, style }], freeze, hidden, validations: [{ sqref, list, warn }] }]
 * A cell is a string, number, boolean, null, or { v, s } where s is one of the STYLE names.
 */
export async function writeXlsx(sheets) {
  const taken = new Set();
  const named = sheets.map((sh, i) => ({ ...sh, name: sheetName(sh.name, taken), first: i === 0 }));
  const files = [];
  const add = (name, text) => files.push({ name, data: enc.encode(text) });
  add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${named.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  add('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${named.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  add('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  add('xl/styles.xml', STYLES_XML);
  named.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip(files);
}

/* ---------- reading .xlsx ---------- */

function joinPath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (base + target).split('/');
  const out = [];
  parts.forEach((p) => { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
  return out.join('/');
}

async function readXlsx(u8) {
  const files = unzip(u8);
  const text = async (name) => { const get = files.get(name); return get ? new TextDecoder().decode(await get()) : null; };
  const rootRels = (await text('_rels/.rels')) || '';
  let wbPath = 'xl/workbook.xml';
  rootRels.replace(/<(?:\w+:)?Relationship\b([^>]*)>/g, (m, a) => { const o = attrs(a); if (/officeDocument$/.test(o.Type || '') && o.Target) wbPath = joinPath('', o.Target); return ''; });
  const wb = await text(wbPath);
  if (!wb) throw new Error('This file has no workbook inside.');
  const base = wbPath.includes('/') ? wbPath.slice(0, wbPath.lastIndexOf('/') + 1) : '';
  const relsXml = (await text(base + '_rels/' + wbPath.slice(base.length) + '.rels')) || '';
  const rels = {};
  relsXml.replace(/<(?:\w+:)?Relationship\b([^>]*)>/g, (m, a) => { const o = attrs(a); rels[o.Id] = joinPath(base, o.Target || ''); return ''; });
  let sst = [];
  const sstPath = Object.values(rels).find((p) => /sharedStrings\.xml$/i.test(p)) || base + 'sharedStrings.xml';
  const sstXml = await text(sstPath);
  if (sstXml) sst = (unprefix(sstXml).match(/<si\b[\s\S]*?<\/si>|<si\s*\/>/g) || []).map(textOf);
  const sheets = [];
  const list = [];
  unprefix(wb).replace(/<sheet\b([^>]*)\/?>/g, (m, a) => { list.push(attrs(a)); return ''; });
  for (const s of list) {
    const idKey = Object.keys(s).find((k) => /(^|:)id$/.test(k) && k !== 'sheetId');
    const path = rels[s[idKey]];
    const xml = path && (await text(path));
    sheets.push({ name: s.name || 'Sheet', hidden: !!s.state && s.state !== 'visible', rows: xml ? sheetRows(xml, sst) : [] });
  }
  return sheets;
}

function sheetRows(xmlIn, sst) {
  const xml = unprefix(xmlIn);
  const m = /<sheetData\b[^>]*>([\s\S]*)<\/sheetData>/.exec(xml);
  if (!m) return [];
  const rows = [];
  let nextRow = 0;
  m[1].replace(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, (all, ra, body) => {
    const r = attrs(ra).r ? +attrs(ra).r - 1 : nextRow;
    nextRow = r + 1;
    const row = [];
    let nextCol = 0;
    String(body || '').replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (cm, ca, inner) => {
      const a = attrs(ca);
      const ref = /^([A-Z]+)\d*$/i.exec(a.r || '');
      const ci = ref ? colIndex(ref[1].toUpperCase()) : nextCol;
      nextCol = ci + 1;
      const vm = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner || '');
      const v = vm ? unEsc(vm[1]) : null;
      let val = null;
      switch (a.t) {
        case 's': val = v == null ? null : sst[+v] ?? null; break;
        case 'inlineStr': val = textOf((/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner || '') || [])[1] || ''); break;
        case 'str': case 'e': case 'd': val = v; break;
        case 'b': val = v == null ? null : v === '1' || v === 'true'; break;
        default: val = v == null || v === '' ? null : Number(v);
      }
      if (typeof val === 'number' && !isFinite(val)) val = v;
      row[ci] = val;
      return '';
    });
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    // rows that are only formatting (no values) are left out, so a sheet formatted all the
    // way down doesn't turn into a million empty rows
    if (row.some((x) => x != null && x !== '')) rows[r] = row;
    return '';
  });
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/* ---------- reading .csv ---------- */

export function readCsv(textIn) {
  const text = String(textIn).replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  const best = [',', ';', '\t'].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0];
  const delim = best[1] ? best[0] : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => (x === '' ? null : x)));
}

function decodeText(u8) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return new TextDecoder('windows-1252').decode(u8); }
}

/** Bytes of a picked file -> [{ name, hidden, rows }]. Throws an Error with a plain message. */
export async function readSheets(u8, fileName = '') {
  const name = String(fileName).toLowerCase();
  if (u8[0] === 0x50 && u8[1] === 0x4b) {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser can’t open Excel files. Update it, or save the file as .csv and import that.');
    if (/\.numbers$/.test(name)) throw new Error('This is a Numbers file. In Numbers, choose File › Export To › Excel, then import that file.');
    try { return await readXlsx(u8); } catch (e) { throw new Error('This file couldn’t be read as an Excel workbook. Save it as .xlsx or .csv and try again.'); }
  }
  if (u8[0] === 0xd0 && u8[1] === 0xcf) throw new Error('This is an older Excel file (.xls). Open it in Excel and save it as .xlsx, then import that.');
  if (/\.(xlsx|xlsm)$/.test(name)) throw new Error('This file couldn’t be read as an Excel workbook. Save it as .xlsx or .csv and try again.');
  const text = decodeText(u8);
  if (/\u0000/.test(text.slice(0, 2000))) throw new Error('This doesn’t look like a spreadsheet. Use an .xlsx or .csv file.');
  return [{ name: 'CSV', hidden: false, rows: readCsv(text) }];
}
