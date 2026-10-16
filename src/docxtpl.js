// Word templates: fill a .docx made in Word with a record's values. Pure (no DOM, no Firebase),
// unit-tested; the app supplies the record through a "scope" (docxdata.js).
//
// In the template, placeholders are typed as plain text:
//   {Field}  {Parent: Field}  {Field|option|option}  {= formula|option}  {%Picture|width=5cm}
//   {#if condition} … {#else} … {/if}    {#each Grid or child form|sort Field desc|where condition} … {/each}
//   {{ for a real "{"
// Blocks work inline (both ends in one paragraph), on whole paragraphs (each end alone on its
// line) and on table rows (ends in different cells of a row, or in different rows).
//
// Word splits typed text into pieces ("{Cli" + "ent name}") when it's edited or spell-checked;
// normalise() puts each placeholder back into one piece before anything else.
//
// scope (one record, or one row of a grid inside {#each}):
//   get(name)    → { type, v, text, blocks?, currency? } or null when there's no such name
//   list(name)   → [scope] or null
//   calc(expr)   → { v, type? } or { e: 'why' }
//   image(name)  → Promise<{ bytes, type: 'png'|'jpg' } | null (empty)> or undefined (no such name)
// schema (checking a template without a record): has(name), list(name) → schema|null,
//   formula(expr) → error text|null, image(name) → bool

import { parseXml, writeXml, el, txt, clone, findAll, firstNamed, kidsNamed, attr, setAttr } from './docxxml.js';
import { zip, unzip } from './xlsx.js';

/* ---------- placeholders in text ---------- */

/** The {…} placeholders in a piece of text: [{ start, end, inner }] and { esc: true } for "{{". */
export function findTags(text) {
  const out = [];
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    if (s[i + 1] === '{') { out.push({ start: i, end: i + 2, esc: true }); i++; continue; }
    let depth = 1, q = false, j = i + 1;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === '"' || c === '“' || c === '”') q = !q;
      else if (!q && c === '{') depth++;
      else if (!q && c === '}') { depth--; if (!depth) break; }
    }
    if (j >= s.length) break; // never closed: left as text
    out.push({ start: i, end: j + 1, inner: s.slice(i + 1, j) });
    i = j;
  }
  return out;
}

/** "Name|opt|opt" → ['Name', 'opt', 'opt'], not splitting inside quotes, brackets or braces. */
export function splitOpts(s) {
  const out = [];
  let cur = '', depth = 0, q = false;
  for (const c of String(s)) {
    if (c === '"' || c === '“' || c === '”') q = !q;
    if (!q && (c === '(' || c === '{' || c === '[')) depth++;
    if (!q && (c === ')' || c === '}' || c === ']')) depth--;
    if (c === '|' && !q && depth <= 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** What a placeholder asks for. */
export function parseTag(inner) {
  const s = String(inner).trim();
  let m;
  if ((m = /^#if\b([\s\S]*)$/i.exec(s))) return { k: 'if', cond: m[1].trim(), raw: s };
  if (/^#else$/i.test(s)) return { k: 'else', raw: s };
  if (/^\/if$/i.test(s)) return { k: '/if', raw: s };
  if ((m = /^#each\b([\s\S]*)$/i.exec(s))) { const [name, ...opts] = splitOpts(m[1]); return { k: 'each', name, opts, raw: s }; }
  if (/^\/each$/i.test(s)) return { k: '/each', raw: s };
  if (s[0] === '=') { const [expr, ...opts] = splitOpts(s.slice(1)); return { k: 'calc', expr, opts, raw: s }; }
  if (s[0] === '%') { const [name, ...opts] = splitOpts(s.slice(1)); return { k: 'img', name, opts, raw: s }; }
  const [name, ...opts] = splitOpts(s);
  return { k: 'val', name, opts, raw: s };
}
const BLOCK = new Set(['if', 'else', '/if', 'each', '/each']);
const isBlock = (t) => !!t && BLOCK.has(t.k);

/* ---------- dates and numbers ---------- */

const pad = (n, w = 2) => String(n).padStart(w, '0');
/** Date pattern: yyyy yy MMMM MMM MM M dd d EEEE EEE HH H hh h mm ss a. */
export function fmtDate(d, pattern) {
  const mon = (o) => d.toLocaleString(undefined, { month: o });
  const day = (o) => d.toLocaleString(undefined, { weekday: o });
  const h12 = d.getHours() % 12 || 12;
  const T = {
    yyyy: () => String(d.getFullYear()), yy: () => pad(d.getFullYear() % 100), MMMM: () => mon('long'), MMM: () => mon('short'),
    MM: () => pad(d.getMonth() + 1), M: () => String(d.getMonth() + 1), dd: () => pad(d.getDate()), d: () => String(d.getDate()),
    EEEE: () => day('long'), EEE: () => day('short'), HH: () => pad(d.getHours()), H: () => String(d.getHours()),
    hh: () => pad(h12), h: () => String(h12), mm: () => pad(d.getMinutes()), ss: () => pad(d.getSeconds()), a: () => (d.getHours() < 12 ? 'AM' : 'PM'),
  };
  return String(pattern).replace(/yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|hh|h|mm|ss|a|'[^']*'/g, (t) => (t[0] === "'" ? t.slice(1, -1) : T[t]()));
}
/** A date or date-and-time value as a Date, or null. */
export function asDate(v, type) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00');
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
/** "0.00", "#,##0", "0" → formatted number. */
export function fmtNumber(n, pattern) {
  const dec = /\.(0+)/.exec(pattern)?.[1].length || 0;
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: pattern.includes(',') });
}
const titleCase = (s) => String(s).toLowerCase().replace(/(^|[\s\-‐(“"])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const unq = (s) => String(s).replace(/^["“”](.*)["“”]$/s, '$1');
const DATEY = new Set(['date', 'datetime', 'sysdate', 'systime']);
const NUMY = new Set(['number', 'decimal', 'currency', 'percent', 'range', 'rating', 'autonumber']);

/**
 * A value with its options → { text, blocks } (blocks: paragraphs for formatted text, bullets
 * or lines, or null). val = what scope.get or a calculation gave.
 */
export function formatValue(val, opts = [], R = {}) {
  let { type, v } = val;
  let text = val.text ?? (v == null ? '' : String(v));
  let blocks = val.blocks || null;
  if (type === 'checkbox' || typeof v === 'boolean') text = v ? '✓' : '';
  let orText = null;
  const isNum = typeof v === 'number' || (NUMY.has(type) && v !== '' && v != null && !isNaN(Number(v)));
  const d = DATEY.has(type) ? asDate(v, type) : null;
  const withTime = type === 'datetime' || type === 'systime';
  for (const raw of opts) {
    const o = raw.trim(), lo = o.toLowerCase();
    let m;
    if (!o) continue;
    if ((m = /^or\s+(.*)$/i.exec(o))) { orText = unq(m[1].trim()); continue; }
    if (/^(width|height)\s*=/.test(lo)) continue;
    if ((lo === 'short' || lo === 'long') && d) {
      text = lo === 'short' ? d.toLocaleDateString(undefined) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      if (withTime) text += (lo === 'short' ? ' ' : ', ') + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      blocks = null; continue;
    }
    if (/^["“].*["”]$/.test(o)) { if (d) { text = fmtDate(d, unq(o)); blocks = null; } continue; }
    if (/^[#0,]+(\.0+)?$/.test(o)) { if (isNum) { text = fmtNumber(Number(v), o); blocks = null; } continue; }
    if (lo === 'currency') { if (isNum) text = new Intl.NumberFormat(undefined, { style: 'currency', currency: (val.currency || R.currency || 'CAD').toUpperCase() }).format(Number(v)); continue; }
    if (lo === 'percent') { if (isNum) text = Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) + '%'; continue; }
    if ((m = /^([^/]+)\/([^/]*)$/.exec(o)) && (type === 'checkbox' || typeof v === 'boolean')) { text = v ? m[1].trim() : m[2].trim(); continue; }
    if (lo === 'upper') { text = text.toUpperCase(); blocks = blocks && mapRuns(blocks, (s) => s.toUpperCase()); continue; }
    if (lo === 'lower') { text = text.toLowerCase(); blocks = blocks && mapRuns(blocks, (s) => s.toLowerCase()); continue; }
    if (lo === 'title') { text = titleCase(text); blocks = blocks && mapRuns(blocks, titleCase); continue; }
    if (lo === 'bullets' || lo === 'lines') {
      const items = Array.isArray(v) ? v.map(String) : text.split(/\n|,\s*/).filter(Boolean);
      blocks = items.map((s) => (lo === 'bullets' ? { t: 'li', list: 'ul', runs: [{ s }] } : { t: 'p', runs: [{ s }] }));
      text = items.map((s) => (lo === 'bullets' ? '• ' + s : s)).join('\n');
      continue;
    }
    if (lo === 'plain') { blocks = null; continue; }
    (R.warnings || (R.warnings = new Set())).add(`“${o}” isn’t an option Formwright knows`);
  }
  if (!String(text).trim() && !(blocks && blocks.some((b) => b.runs.some((r) => r.s.trim())))) return { text: orText ?? '', blocks: null };
  return { text, blocks };
}
const mapRuns = (blocks, f) => blocks.map((b) => ({ ...b, runs: b.runs.map((r) => ({ ...r, s: f(r.s) })) }));

/* ---------- conditions: Stage = "Approved" and (Budget > 1000 or not Billable) ---------- */

export function parseCond(src) {
  const toks = [];
  const s = String(src);
  let i = 0;
  const OPS = ['!=', '<>', '>=', '<=', '≠', '≥', '≤', '=', '>', '<'];
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === '“' || c === '”') {
      let j = i + 1; while (j < s.length && !'"“”'.includes(s[j])) j++;
      toks.push({ k: 'str', v: s.slice(i + 1, j) }); i = j + 1; continue;
    }
    if (c === '[') { const j = s.indexOf(']', i); const e = j < 0 ? s.length : j; toks.push({ k: 'name', v: s.slice(i + 1, e).trim() }); i = e + 1; continue; }
    if (c === '(' || c === ')') { toks.push({ k: c }); i++; continue; }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (op) { toks.push({ k: 'op', v: { '<>': '!=', '≠': '!=', '≥': '>=', '≤': '<=' }[op] || op }); i += op.length; continue; }
    let j = i; while (j < s.length && !/[\s"“”()[\]!<>=≠≥≤]/.test(s[j])) j++;
    if (j === i) j = i + 1;
    const w = s.slice(i, j), lw = w.toLowerCase();
    if (lw === 'and' || lw === 'or' || lw === 'not') toks.push({ k: lw });
    else if (lw === 'contains') toks.push({ k: 'op', v: 'contains' });
    else {
      const prev = toks[toks.length - 1];
      if (prev && prev.k === 'word') prev.v += ' ' + w; else toks.push({ k: 'word', v: w });
    }
    i = j;
  }
  let p = 0;
  const peek = () => toks[p], take = () => toks[p++];
  const fail = (m) => { throw Object.assign(new Error(m), { cond: true }); };
  function or() { let a = and(); while (peek()?.k === 'or') { take(); a = { k: 'or', a, b: and() }; } return a; }
  function and() { let a = not(); while (peek()?.k === 'and') { take(); a = { k: 'and', a, b: not() }; } return a; }
  function not() { if (peek()?.k === 'not') { take(); return { k: 'not', a: not() }; } return cmp(); }
  function cmp() { const a = atom(); if (peek()?.k === 'op') { const op = take().v; return { k: 'cmp', op, a, b: atom() }; } return a; }
  function atom() {
    const t = take();
    if (!t) fail('The condition ends too soon.');
    if (t.k === '(') { const e = or(); if (take()?.k !== ')') fail('A bracket isn’t closed.'); return e; }
    if (t.k === 'str') return { k: 'lit', v: t.v };
    if (t.k === 'word' && /^-?\d+(\.\d+)?$/.test(t.v)) return { k: 'lit', v: Number(t.v) };
    if (t.k === 'word' || t.k === 'name') return { k: 'name', v: t.v };
    fail(`“${t.v || t.k}” is out of place.`);
  }
  if (!toks.length) fail('The condition is empty.');
  const e = or();
  if (p < toks.length) fail(`“${toks[p].v || toks[p].k}” is out of place.`);
  return e;
}
export const condNames = (e, out = []) => { if (!e) return out; if (e.k === 'name') out.push(e.v); ['a', 'b'].forEach((x) => e[x] && condNames(e[x], out)); return out; };

const BOOLWORD = { yes: true, true: true, ticked: true, checked: true, no: false, false: false, unticked: false };
const truthy = (v) => (typeof v === 'boolean' ? v : Array.isArray(v) ? v.length > 0 : v == null ? false : typeof v === 'number' ? true : String(v).trim() !== '');
const numish = (v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)));
function compare(a, op, b) {
  if (Array.isArray(a)) {
    const has = a.some((x) => String(x).toLowerCase() === String(b).toLowerCase());
    if (op === '=' || op === 'contains') return has;
    if (op === '!=') return !has;
  }
  if (op === 'contains') return String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase());
  if (typeof a === 'boolean' && typeof b === 'string' && String(b).toLowerCase() in BOOLWORD) b = BOOLWORD[String(b).toLowerCase()];
  if (typeof b === 'boolean' && typeof a === 'string' && String(a).toLowerCase() in BOOLWORD) a = BOOLWORD[String(a).toLowerCase()];
  let x, y;
  if (numish(a) && numish(b)) { x = Number(a); y = Number(b); }
  else if (typeof a === 'boolean' || typeof b === 'boolean') { x = !!a; y = !!b; }
  else { x = String(a ?? '').toLowerCase(); y = String(b ?? '').toLowerCase(); }
  switch (op) {
    case '=': return x === y;
    case '!=': return x !== y;
    case '>': return x > y;
    case '<': return x < y;
    case '>=': return x >= y;
    case '<=': return x <= y;
  }
  return false;
}
export function evalCond(e, scope, R = {}) {
  const val = (n) => {
    if (n.k === 'lit') return n.v;
    if (n.k === 'name') { const g = scope.get(n.v); if (!g) { R.missing?.add(n.v); return null; } return g.v; }
    return evalCond(n, scope, R);
  };
  switch (e.k) {
    case 'or': return evalCond(e.a, scope, R) || evalCond(e.b, scope, R);
    case 'and': return evalCond(e.a, scope, R) && evalCond(e.b, scope, R);
    case 'not': return !evalCond(e.a, scope, R);
    case 'cmp': return compare(val(e.a), e.op, val(e.b));
    default: return truthy(val(e));
  }
}

/* ---------- reading the template ---------- */

const tText = (t) => t.kids.filter((k) => k.t === 'text').map((k) => k.v).join('');
const setT = (t, s) => { t.kids = s ? [txt(s)] : []; t.self = !s; if (/^\s|\s$/.test(s)) setAttr(t, 'xml:space', 'preserve'); };
/** The w:t pieces of a paragraph, in order, not counting paragraphs nested inside it (text boxes). */
function textsOf(p, out = []) {
  for (const k of p.kids) {
    if (k.t !== 'el' || k.name === 'w:p' || k.name === 'w:txbxContent') continue;
    if (k.name === 'w:t') out.push(k); else textsOf(k, out);
  }
  return out;
}
/** Put each placeholder that Word split over several pieces back into one piece. */
export function normalise(p) {
  for (let guard = 0; guard < 500; guard++) {
    const ts = textsOf(p);
    const at = [];
    let full = '';
    ts.forEach((t) => { at.push(full.length); full += tText(t); });
    const idx = (pos) => { let i = ts.length - 1; while (i > 0 && at[i] > pos) i--; return i; };
    const split = findTags(full).find((g) => idx(g.start) !== idx(g.end - 1));
    if (!split) return;
    const a = idx(split.start), b = idx(split.end - 1);
    const ta = tText(ts[a]), tb = tText(ts[b]);
    setT(ts[a], ta.slice(0, split.start - at[a]) + full.slice(split.start, split.end));
    for (let i = a + 1; i < b; i++) setT(ts[i], '');
    setT(ts[b], tb.slice(split.end - at[b]));
  }
}
/** Split runs so each placeholder is a run of its own (marked .tag); "{{" becomes "{". */
function splitRuns(container) {
  const out = [];
  for (const k of container.kids) {
    if (k.t !== 'el') { out.push(k); continue; }
    if (k.name === 'w:r') { out.push(...splitRun(k)); continue; }
    if (k.name !== 'w:p' && k.name !== 'w:txbxContent') splitRuns(k);
    out.push(k);
  }
  container.kids = out;
}
function splitRun(r) {
  if (!r.kids.some((k) => k.t === 'el' && k.name === 'w:t' && findTags(tText(k)).length)) return [r];
  const rPr = firstNamed(r, 'w:rPr');
  const runs = [];
  let cur = [];
  const newRun = (kids) => el('w:r', r.attrs, [...(rPr ? [clone(rPr)] : []), ...kids]);
  const flush = () => { if (cur.length) { runs.push(newRun(cur)); cur = []; } };
  const tEl = (s) => { const t = el('w:t', ''); setT(t, s); return t; };
  for (const k of r.kids) {
    if (k === rPr) continue;
    if (k.t !== 'el' || k.name !== 'w:t') { cur.push(k); continue; }
    const s = tText(k);
    let pos = 0, plain = '';
    for (const g of findTags(s)) {
      plain += s.slice(pos, g.start);
      pos = g.end;
      if (g.esc) { plain += '{'; continue; }
      if (plain) { cur.push(tEl(plain)); plain = ''; }
      flush();
      const run = newRun([tEl(s.slice(g.start, g.end))]);
      run.tag = parseTag(g.inner);
      runs.push(run);
    }
    plain += s.slice(pos);
    if (plain) cur.push(tEl(plain));
  }
  flush();
  return runs;
}
/** Visible text of a node (for "is this tag alone on its line"). */
function visible(n) {
  if (n.t === 'text') return n.v;
  if (n.t !== 'el') return '';
  if (n.name === 'w:pPr' || n.name === 'w:rPr' || n.name === 'w:instrText') return '';
  if (n.name === 'w:drawing' || n.name === 'w:pict' || n.name === 'w:object') return '▣';
  if (n.name === 'w:tab') return ' ';
  return n.kids.map(visible).join('');
}

/** Pair openers and closers in a list: blocks in their place; what doesn't pair is reported. */
function pair(list, markerOf, unit, errs, where) {
  const top = { body: [] };
  const stack = [{ blk: null, arr: top.body }];
  for (const n of list) {
    const tag = markerOf(n);
    const cur = stack[stack.length - 1];
    if (!tag) { cur.arr.push(n); continue; }
    if (tag.k === 'if' || tag.k === 'each') {
      const blk = { t: 'block', k: tag.k, tag, body: [], other: null, unit, open: n };
      cur.arr.push(blk);
      stack.push({ blk, arr: blk.body });
    } else if (tag.k === 'else') {
      if (cur.blk && cur.blk.k === 'if' && !cur.blk.other) { cur.blk.other = []; cur.blk.elseNode = n; cur.arr = cur.blk.other; } else cur.arr.push(n);
    } else {
      const want = tag.k === '/if' ? 'if' : 'each';
      if (cur.blk && cur.blk.k === want) { cur.blk.close = n; stack.pop(); } else cur.arr.push(n);
    }
  }
  // openers never closed here: put them back as they were, for the level above to deal with
  while (stack.length > 1) {
    const { blk } = stack.pop();
    const parent = stack[stack.length - 1].arr;
    const i = parent.indexOf(blk);
    parent.splice(i, 1, blk.open, ...blk.body, ...(blk.elseNode ? [blk.elseNode, ...blk.other] : []));
  }
  return top.body;
}
const leftoverTags = (list, markerOf) => {
  const out = [];
  const walk = (arr) => arr.forEach((n) => { if (n.t === 'block') { walk(n.body); if (n.other) walk(n.other); } else if (markerOf(n)) out.push(n); });
  walk(list);
  return out;
};

const runTag = (n) => (n.t === 'el' && n.name === 'w:r' && isBlock(n.tag) ? n.tag : null);
function paraTag(n) {
  if (n.t !== 'el' || n.name !== 'w:p') return null;
  const tags = [];
  let other = '';
  const walk = (x) => x.kids.forEach((k) => {
    if (k.t !== 'el') return;
    if (k.name === 'w:r' && k.tag) { tags.push(k.tag); return; }
    if (k.name === 'w:r') { other += visible(k); return; }
    if (k.name === 'w:pPr' || k.name === 'w:p') return;
    walk(k);
  });
  walk(n);
  return tags.length === 1 && isBlock(tags[0]) && !other.trim() ? tags[0] : null;
}

/** Inline blocks inside one paragraph. */
function doParagraph(p, errs) {
  p.kids = pair(p.kids, runTag, 'inline', errs);
}
/** A body, cell, header…: blocks over whole paragraphs; returns the tags that didn't pair. */
function doContainer(node, errs) {
  for (const k of node.kids) {
    if (k.t !== 'el') continue;
    if (k.name === 'w:p') doParagraph(k, errs);
    else if (k.name === 'w:tbl') doTable(k, errs);
    else if (k.name === 'w:sdt') { const c = firstNamed(k, 'w:sdtContent'); if (c) { const left = doContainer(c, errs); left.forEach((n) => errs.push(stray(n))); } }
  }
  node.kids = pair(node.kids, paraTag, 'para', errs);
  // tags left over: in a paragraph that pairs with nothing at this level
  const left = [];
  leftoverTags(node.kids, paraTag).forEach((p) => left.push({ node: p, tag: paraTag(p), para: p }));
  // and block tags inside paragraphs with other text that didn't pair inline
  const walk = (arr) => arr.forEach((n) => {
    if (n.t === 'block') { walk(n.body); if (n.other) walk(n.other); return; }
    if (n.t === 'el' && n.name === 'w:p' && !paraTag(n)) leftoverTags(n.kids, runTag).forEach((r) => left.push({ node: r, tag: r.tag, para: n, inline: true }));
  });
  walk(node.kids);
  return left;
}
/** Blocks over table rows: ends in different cells or rows. */
function doTable(tbl, errs) {
  const seq = [];
  for (const k of tbl.kids) {
    if (k.t !== 'el' || k.name !== 'w:tr') { seq.push(k); continue; }
    const marks = [];
    for (const tc of kidsNamed(k, 'w:tc')) {
      const left = doContainer(tc, errs);
      left.forEach((x) => {
        marks.push(x.tag);
        removeNode(x.para, x.node === x.para ? null : x.node, tc);
      });
    }
    const opens = marks.filter((t) => t.k === 'if' || t.k === 'each');
    const rest = marks.filter((t) => !(t.k === 'if' || t.k === 'each'));
    opens.forEach((t) => seq.push({ t: 'mark', tag: t }));
    // a row that held only tags (like a row with just {#else}) goes
    if (!(marks.length && !visible(k).trim() && !k.kids.some((c) => c.t === 'el' && c.name === 'w:tc' && findAll(c, 'w:drawing').length))) seq.push(k);
    rest.forEach((t) => seq.push({ t: 'mark', tag: t }));
  }
  tbl.kids = pair(seq, (n) => (n.t === 'mark' ? n.tag : null), 'row', errs);
  leftoverTags(tbl.kids, (n) => (n.t === 'mark' ? n.tag : null)).forEach((m) => errs.push(stray({ tag: m.tag })));
  tbl.kids = tbl.kids.filter((n) => n.t !== 'mark');
}
/** Take a tag out of a cell: the run, or the whole paragraph when it was alone on its line. */
function removeNode(para, run, cell) {
  if (!run) {
    const i = cell.kids.indexOf(para);
    if (i >= 0) {
      if (cell.kids.filter((x) => x.t === 'el' && x.name === 'w:p').length > 1) cell.kids.splice(i, 1);
      else para.kids = para.kids.filter((x) => x.t === 'el' && x.name === 'w:pPr');
    }
    return;
  }
  const drop = (arr) => { const i = arr.indexOf(run); if (i >= 0) { arr.splice(i, 1); return true; } return arr.some((x) => (x.t === 'block' ? drop(x.body) || (x.other && drop(x.other)) : x.t === 'el' && drop(x.kids))); };
  drop(para.kids);
}
function stray(x) {
  const t = x.tag || x.node?.tag;
  const raw = `{${t?.raw || ''}}`;
  if (x.inline) return `${raw} shares its line with other text but isn’t closed on that line. Put it on a line of its own, or end it on the same line.`;
  if (t?.k === 'if' || t?.k === 'each') return `${raw} has no {/${t.k}}.`;
  if (t?.k === 'else') return '{#else} is outside an {#if …} … {/if}.';
  return `${raw} has no {#${t?.k?.slice(1)} …} before it.`;
}

/** A part (document, header or footer) read into blocks: { root, container, errs }. */
export function readPart(xml) {
  const root = parseXml(xml);
  const top = root.kids.find((k) => k.t === 'el');
  const container = top?.name === 'w:document' ? firstNamed(top, 'w:body') : top;
  const errs = [];
  if (!container) return { root, container: null, errs };
  findAll(container, 'w:p').concat(findAll(container, 'w:p').flatMap((p) => findAll(p, 'w:p'))).forEach(normalise);
  findAll(container, 'w:p').concat(findAll(container, 'w:p').flatMap((p) => findAll(p, 'w:p'))).forEach(splitRuns);
  const left = doContainer(container, errs);
  left.forEach((x) => errs.push(stray(x)));
  return { root, container, errs };
}

/* ---------- writing ---------- */

const RPR_ORDER = ['w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps', 'w:strike', 'w:dstrike', 'w:outline', 'w:shadow', 'w:emboss', 'w:imprint', 'w:noProof', 'w:snapToGrid', 'w:vanish', 'w:webHidden', 'w:color', 'w:spacing', 'w:w', 'w:kern', 'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u', 'w:effect', 'w:bdr', 'w:shd', 'w:fitText', 'w:vertAlign', 'w:rtl', 'w:cs', 'w:em', 'w:lang', 'w:eastAsianLayout', 'w:specVanish', 'w:oMath'];
const PPR_ORDER = ['w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr', 'w:widowControl', 'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs', 'w:suppressAutoHyphens', 'w:kinsoku', 'w:wordWrap', 'w:overflowPunct', 'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN', 'w:bidi', 'w:adjustRightInd', 'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:mirrorIndents', 'w:suppressOverlap', 'w:jc', 'w:textDirection', 'w:textAlignment', 'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange'];
/** Set one property in an rPr/pPr, in the order Word insists on. */
function setProp(pr, order, node) {
  pr.kids = pr.kids.filter((k) => !(k.t === 'el' && k.name === node.name));
  const rank = (n) => { const i = order.indexOf(n.name); return i < 0 ? order.length : i; };
  const i = pr.kids.findIndex((k) => k.t === 'el' && rank(k) > rank(node));
  if (i < 0) pr.kids.push(node); else pr.kids.splice(i, 0, node);
  pr.self = false;
}
const hex = (c) => String(c || '').replace('#', '').toUpperCase();
/** Runs for a piece of text (line breaks and tabs kept), formatted like the placeholder was. */
function textRuns(rPr, s, fmt = {}) {
  const pr = rPr ? clone(rPr) : el('w:rPr');
  if (fmt.b) setProp(pr, RPR_ORDER, el('w:b'));
  if (fmt.i) setProp(pr, RPR_ORDER, el('w:i'));
  if (fmt.x) setProp(pr, RPR_ORDER, el('w:strike'));
  if (fmt.c) setProp(pr, RPR_ORDER, el('w:color', ` w:val="${hex(fmt.c)}"`));
  if (fmt.sz) { setProp(pr, RPR_ORDER, el('w:sz', ` w:val="${fmt.sz}"`)); setProp(pr, RPR_ORDER, el('w:szCs', ` w:val="${fmt.sz}"`)); }
  if (fmt.u || fmt.a) setProp(pr, RPR_ORDER, el('w:u', ' w:val="single"'));
  if (fmt.h) setProp(pr, RPR_ORDER, el('w:shd', ` w:val="clear" w:color="auto" w:fill="${hex(fmt.h)}"`));
  const kids = [];
  String(s).split('\n').forEach((line, li) => {
    if (li) kids.push(el('w:br'));
    line.split('\t').forEach((part, pi) => {
      if (pi) kids.push(el('w:tab'));
      if (part) { const t = el('w:t', ''); setT(t, part); kids.push(t); }
    });
  });
  if (!kids.length) return [];
  return [el('w:r', '', [...(pr.kids.length ? [pr] : []), ...kids])];
}

const EMU_CM = 360000, EMU_IN = 914400;
function sizeOpt(opts, key) {
  for (const o of opts || []) {
    const m = new RegExp(`^${key}\\s*=\\s*([\\d.]+)\\s*(cm|mm|in|px)?$`, 'i').exec(o.trim());
    if (m) { const n = Number(m[1]), u = (m[2] || 'cm').toLowerCase(); return Math.round(u === 'in' ? n * EMU_IN : u === 'mm' ? n * EMU_CM / 10 : u === 'px' ? n * 9525 : n * EMU_CM); }
  }
  return 0;
}
/** Width and height of a PNG or JPEG in pixels. */
export function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { w: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, h: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b[i + 2] << 8 | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b[i + 5] << 8 | b[i + 6], w: b[i + 7] << 8 | b[i + 8] };
      i += 2 + len;
    }
  }
  return { w: 400, h: 300 };
}
function drawing(rId, id, cx, cy) {
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  return parseXml(`<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks ${A} noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic ${A}><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`).kids[0];
}

/** Paragraphs from formatted-text blocks, shaped like the paragraph the placeholder was in. */
function blockParas(p, run, blocks) {
  const pPr = firstNamed(p, 'w:pPr');
  const rPr = firstNamed(run, 'w:rPr');
  const listy = pPr && firstNamed(pPr, 'w:numPr');
  return blocks.map((b) => {
    const pr = pPr ? clone(pPr) : el('w:pPr');
    let prefix = '';
    if (b.t === 'li') {
      if (!listy) { setProp(pr, PPR_ORDER, el('w:ind', ' w:left="720" w:hanging="360"')); prefix = (b.list === 'ol' ? `${b.n || 1}.` : '•') + '\t'; }
    } else {
      pr.kids = pr.kids.filter((k) => !(k.t === 'el' && k.name === 'w:numPr'));
      if (b.t === 'quote') setProp(pr, PPR_ORDER, el('w:ind', ' w:left="567"'));
    }
    const head = b.t === 'h3' ? { b: 1, sz: 28 } : b.t === 'h4' ? { b: 1, sz: 24 } : b.t === 'quote' ? { i: 1, c: '555555' } : {};
    const runs = [...(prefix ? textRuns(rPr, prefix) : []), ...b.runs.flatMap((r) => textRuns(rPr, r.s, { ...head, ...r }))];
    return el('w:p', p.attrs, [...(pr.kids.length ? [pr] : []), ...runs]);
  });
}

async function renderList(nodes, scope, R) {
  const out = [];
  for (const n of nodes) {
    if (n.t === 'block') {
      if (n.k === 'if') {
        let ok = false;
        try { ok = evalCond(parseCond(n.tag.cond), scope, R); } catch (e) { R.errors.add(`{#if ${n.tag.cond}}: ${e.message}`); }
        out.push(...await renderList(ok ? n.body : n.other || [], scope, R));
      } else {
        let items = scope.list(n.tag.name);
        if (!items) { R.missing.add(n.tag.name); items = []; }
        for (const o of n.tag.opts || []) {
          let m;
          if ((m = /^where\s+([\s\S]+)$/i.exec(o))) {
            try { const c = parseCond(m[1]); items = items.filter((it) => evalCond(c, it, R)); } catch (e) { R.errors.add(`{#each … |${o}}: ${e.message}`); }
          } else if ((m = /^sort\s+(.+?)(\s+(asc|desc))?$/i.exec(o))) {
            const key = m[1].trim(), dir = (m[3] || 'asc').toLowerCase() === 'desc' ? -1 : 1;
            items = [...items].sort((a, b) => { const x = a.get(key)?.v, y = b.get(key)?.v; return (numish(x) && numish(y) ? Number(x) - Number(y) : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true })) * dir; });
          }
        }
        for (const it of items) out.push(...await renderList(n.body, it, R));
      }
      continue;
    }
    if (n.t !== 'el') { out.push({ ...n }); continue; }
    if (n.name === 'w:p') {
      const multi = await expandPara(n, scope, R);
      if (multi) { out.push(...multi); continue; }
    }
    if (n.name === 'w:r' && n.tag) { out.push(...await renderTag(n, scope, R)); continue; }
    out.push({ ...n, kids: await renderList(n.kids, scope, R), tag: undefined });
  }
  return out;
}
/** A paragraph holding just one value whose text runs to several paragraphs (formatted text, bullets). */
async function expandPara(p, scope, R) {
  const runs = p.kids.filter((k) => k.t === 'el' && k.name === 'w:r');
  const tagRuns = runs.filter((r) => r.tag);
  if (tagRuns.length !== 1 || tagRuns[0].tag.k !== 'val' || p.kids.some((k) => k.t === 'block')) return null;
  if (runs.some((r) => !r.tag && visible(r).trim())) return null;
  const v = resolveVal(tagRuns[0].tag, scope, R);
  if (!v || !v.blocks || !v.blocks.length) return null;
  return blockParas(p, tagRuns[0], v.blocks);
}
function resolveVal(tag, scope, R) {
  const g = scope.get(tag.name);
  if (!g) { R.missing.add(tag.name); return null; }
  return formatValue(g, tag.opts, R);
}
async function renderTag(run, scope, R) {
  const tag = run.tag, rPr = firstNamed(run, 'w:rPr');
  const keep = () => [{ ...run, tag: undefined }];
  if (tag.k === 'val') {
    const v = resolveVal(tag, scope, R);
    if (!v) return keep();
    return textRuns(rPr, v.blocks ? v.blocks.map((b) => (b.t === 'li' ? (b.list === 'ol' ? `${b.n || 1}. ` : '• ') : '') + b.runs.map((r) => r.s).join('')).join('\n') : v.text);
  }
  if (tag.k === 'calc') {
    const r = scope.calc(tag.expr);
    if (r.e) { R.errors.add(`{= ${tag.expr}}: ${r.e}`); return keep(); }
    return textRuns(rPr, formatValue({ type: r.type || (typeof r.v === 'number' ? 'number' : typeof r.v), v: r.v, text: r.text ?? (typeof r.v === 'number' ? r.v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : r.v == null ? '' : String(r.v)) }, tag.opts, R).text);
  }
  if (tag.k === 'img') {
    const got = scope.image(tag.name);
    if (got === undefined) { R.missing.add(tag.name); return keep(); }
    let img;
    try { img = await got; } catch (e) { R.pictures++; return []; }
    if (!img) return [];
    const px = imageSize(img.bytes);
    let cx = sizeOpt(tag.opts, 'width'), cy = sizeOpt(tag.opts, 'height');
    if (cx && !cy) cy = Math.round(cx * px.h / px.w);
    else if (cy && !cx) cx = Math.round(cy * px.w / px.h);
    else if (!cx && !cy) { cx = px.w * 9525; cy = px.h * 9525; if (cx > R.maxWidth) { cy = Math.round(cy * R.maxWidth / cx); cx = R.maxWidth; } }
    const rId = R.addImage(img);
    return [el('w:r', '', [...(rPr ? [clone(rPr)] : []), drawing(rId, R.nextId++, cx, cy)])];
  }
  return [];
}
/** Word wants every cell to end in a paragraph and no table without rows. */
function tidy(n) {
  if (n.t !== 'el') return n;
  n.kids = n.kids.map(tidy).filter((k) => !(k.t === 'el' && k.name === 'w:tbl' && !kidsNamed(k, 'w:tr').length));
  if (n.name === 'w:tc') {
    const last = [...n.kids].reverse().find((k) => k.t === 'el');
    if (!last || last.name !== 'w:p') n.kids.push(el('w:p'));
  }
  return n;
}

/* ---------- the whole file ---------- */

const PART = /^word\/(document|header\d*|footer\d*)\.xml$/;
const relsOf = (part) => part.replace(/^word\//, 'word/_rels/') + '.rels';

async function readZip(bytes) {
  const files = unzip(bytes);
  const out = new Map();
  for (const [name, get] of files) out.set(name, await get());
  return out;
}
const dec = (u8) => new TextDecoder().decode(u8);
const enc = (s) => new TextEncoder().encode(s);

/** Read a template: every part's blocks and the problems found. */
export async function readTemplate(bytes) {
  let files;
  try { files = await readZip(bytes); } catch (e) { throw new Error('That isn’t a Word file (.docx).'); }
  if (!files.has('word/document.xml')) throw new Error('That isn’t a Word file (.docx).');
  const parts = [];
  for (const name of [...files.keys()].filter((n) => PART.test(n)).sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)))) {
    parts.push({ name, ...readPart(dec(files.get(name))) });
  }
  return { files, parts };
}

/**
 * Fill a template with a record. → { bytes, missing: [names], errors: [text], pictures: n }
 * opts.currency: for |currency on calculations.
 */
export async function fillDocx(bytes, scope, opts = {}) {
  const { files, parts } = await readTemplate(bytes);
  const errs = parts.flatMap((p) => p.errs);
  if (errs.length) throw Object.assign(new Error(errs[0]), { template: errs });
  const docXml = dec(files.get('word/document.xml'));
  const pg = /<w:pgSz[^>]*w:w="(\d+)"/.exec(docXml), ml = /<w:pgMar[^>]*w:left="(\d+)"/.exec(docXml), mr = /<w:pgMar[^>]*w:right="(\d+)"/.exec(docXml);
  const usable = pg ? (Number(pg[1]) - Number(ml?.[1] || 1440) - Number(mr?.[1] || 1440)) * 635 : 6.5 * EMU_IN;
  const R = { missing: new Set(), errors: new Set(), warnings: new Set(), pictures: 0, nextId: 9000, maxWidth: usable, currency: opts.currency };
  let mediaN = 0;
  const exts = new Set();
  for (const part of parts) {
    if (!part.container) continue;
    const rels = [];
    R.addImage = (img) => {
      const ext = img.type === 'png' ? 'png' : 'jpeg';
      exts.add(ext);
      const file = `fw${++mediaN}.${ext}`;
      files.set('word/media/' + file, img.bytes);
      const id = `rIdFw${mediaN}`;
      rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${file}"/>`);
      return id;
    };
    part.container.kids = await renderList(part.container.kids, scope, R);
    tidy(part.container);
    const top = part.root.kids.find((k) => k.t === 'el');
    if (rels.length) {
      for (const [ns, uri] of [['wp', 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'], ['r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships']]) {
        if (!new RegExp(`xmlns:${ns}=`).test(top.attrs)) top.attrs += ` xmlns:${ns}="${uri}"`;
      }
      const rn = relsOf(part.name);
      const cur = files.has(rn) ? dec(files.get(rn)) : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      files.set(rn, enc(cur.replace('</Relationships>', rels.join('') + '</Relationships>')));
    }
    files.set(part.name, enc(writeXml(part.root)));
  }
  if (exts.size) {
    let ct = dec(files.get('[Content_Types].xml'));
    for (const e of exts) if (!new RegExp(`Extension="${e}"`, 'i').test(ct)) ct = ct.replace('</Types>', `<Default Extension="${e}" ContentType="image/${e}"/></Types>`);
    files.set('[Content_Types].xml', enc(ct));
  }
  const out = await zip([...files].map(([name, data]) => ({ name, data })));
  return { bytes: out, missing: [...R.missing], errors: [...R.errors, ...R.warnings], pictures: R.pictures };
}

/**
 * Check a template against a form, without a record. → { tags: [{ text, ok, why }], errors: [text] }
 * Each placeholder once, in order.
 */
export async function checkDocx(bytes, schema) {
  const { parts } = await readTemplate(bytes);
  const errors = parts.flatMap((p) => p.errs);
  const seen = new Map();
  const note = (text, ok, why = '') => { const k = text + '\u0000' + why; if (!seen.has(k)) seen.set(k, { text, ok, why }); };
  const condCheck = (cond, sc, text) => {
    try { const names = condNames(parseCond(cond)); const bad = names.filter((n) => !sc.has(n)); note(text, !bad.length, bad.length ? `No field called “${bad[0]}”` : ''); } catch (e) { note(text, false, e.message); }
  };
  const walk = (nodes, sc) => {
    for (const n of nodes) {
      if (n.t === 'block') {
        if (n.k === 'if') { condCheck(n.tag.cond, sc, `{${n.tag.raw}}`); walk(n.body, sc); walk(n.other || [], sc); continue; }
        const child = sc.list(n.tag.name);
        note(`{${n.tag.raw}}`, !!child, child ? '' : `No grid or child form called “${n.tag.name}”`);
        for (const o of n.tag.opts || []) {
          let m;
          if (child && (m = /^where\s+([\s\S]+)$/i.exec(o))) condCheck(m[1], child, `{${n.tag.raw}}`);
          else if (child && (m = /^sort\s+(.+?)(\s+(asc|desc))?$/i.exec(o)) && !child.has(m[1].trim())) note(`{${n.tag.raw}}`, false, `${n.tag.name} has no field called “${m[1].trim()}”`);
          else if (!/^(where|sort)\b/i.test(o)) note(`{${n.tag.raw}}`, false, `“${o}” isn’t an option for {#each}`);
        }
        walk(n.body, child || ANY);
        continue;
      }
      if (n.t !== 'el') continue;
      if (n.name === 'w:r' && n.tag) {
        const t = n.tag;
        if (t.k === 'val') note(`{${t.raw}}`, sc.has(t.name), sc.has(t.name) ? '' : `No field called “${t.name}”`);
        else if (t.k === 'calc') { const e = sc.formula(t.expr); note(`{${t.raw}}`, !e, e || ''); }
        else if (t.k === 'img') { const ok = sc.image(t.name); note(`{${t.raw}}`, ok, ok ? '' : `No photo, signature or image upload called “${t.name}”`); }
        if (t.k !== 'if' && t.k !== 'each') (t.opts || []).forEach((o) => { if (!OPT_OK(o, t.k)) note(`{${t.raw}}`, false, `“${o}” isn’t an option Formwright knows`); });
        continue;
      }
      walk(n.kids, sc);
    }
  };
  parts.forEach((p) => p.container && walk(p.container.kids, schema));
  return { tags: [...seen.values()], errors };
}
const ANY = { has: () => true, list: () => ANY, formula: () => null, image: () => true };
function OPT_OK(o, k) {
  const lo = o.trim().toLowerCase();
  if (k === 'img') return /^(width|height)\s*=\s*[\d.]+\s*(cm|mm|in|px)?$/.test(lo);
  return /^or\s+/.test(lo) || ['short', 'long', 'currency', 'percent', 'upper', 'lower', 'title', 'bullets', 'lines', 'plain'].includes(lo)
    || /^["“].*["”]$/.test(o.trim()) || /^[#0,]+(\.0+)?$/.test(lo) || /^[^/]+\/[^/]*$/.test(o.trim());
}

/** The plain text of a filled document's body (for tests and previews). */
export function docText(xml) {
  const root = parseXml(xml);
  return findAll(root, 'w:p').map((p) => textsOf(p).map(tText).join('')).join('\n');
}
