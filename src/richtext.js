// Formatted long text: reading, cleaning and converting it. Pure functions (no DOM, no Firebase),
// unit-tested; also bundled into the server kit for PDFs.
//
// A long text field's value stays plain text in record.values[fieldId], so lists, search, exports,
// calculations and email placeholders work as they always have. Its formatting, when there is any,
// sits beside it in record.values._rich[fieldId] as cleaned HTML. The formatting only counts while
// its words still match the plain text: anything that changes the text without the editor (an
// import, an automation, a rule clearing it) makes the formatting fall away instead of showing
// stale words.
//
// The model: blocks [{ t: 'p'|'h3'|'h4'|'quote'|'li', list?: 'ul'|'ol', n?: 1…, runs: [run] }]
// run = { s: 'text', b?, i?, u?, x? (strikethrough), c?: '#rrggbb' (colour), h?: '#rrggbb' (highlight), a?: 'https://…' }
// A '\n' in a run is a line break within the block.

export const RICH_KEY = '_rich';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return ENT[e.toLowerCase()] ?? m;
});
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

/** A colour from HTML (#abc, #aabbcc, rgb(…)) as #rrggbb, or '' when it isn't one. */
export function cleanColor(v) {
  const s = String(v || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return '#' + [...m[1]].map((c) => c + c).join('');
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return '';
    return '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  }
  return '';
}
/** A link that's safe to keep (web, email or phone), or ''. */
export function cleanHref(v) {
  const s = String(v || '').trim();
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s.slice(0, 2000);
  if (/^www\./i.test(s)) return 'https://' + s.slice(0, 2000);
  return '';
}

function attrs(src) {
  const a = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(src))) a[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '');
  return a;
}
function styleOf(css) {
  const o = {};
  String(css || '').split(';').forEach((d) => { const i = d.indexOf(':'); if (i > 0) o[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim().toLowerCase(); });
  return o;
}

const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'li', 'ul', 'ol', 'tr', 'pre', 'section', 'article', 'header', 'footer', 'table', 'dl', 'dt', 'dd']);
const SKIP = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'iframe', 'object', 'svg', 'math', 'xml']);
const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'col', 'wbr', 'area', 'base', 'source']);

/** HTML (from the editor, a paste, or storage) → blocks. Anything not in the model is dropped. */
export function parseRich(html) {
  const blocks = [];
  const ctx = []; // open tags: { tag, fmt?, block? }
  let cur = null;
  const fmtNow = () => {
    const f = {};
    ctx.forEach((c) => { if (c.fmt) Object.assign(f, c.fmt); });
    return f;
  };
  const typeNow = () => {
    let li = null, quote = false, head = '';
    ctx.forEach((c) => { if (c.tag === 'li') li = c; if (c.tag === 'blockquote') quote = true; if (/^h[1-6]$/.test(c.tag)) head = +c.tag[1] <= 3 ? 'h3' : 'h4'; });
    if (li) return { t: 'li', list: li.list };
    if (head) return { t: head };
    return { t: quote ? 'quote' : 'p' };
  };
  const flush = () => {
    if (!cur) return;
    // a trailing line break is the editor's placeholder, not a blank line
    const last = cur.runs[cur.runs.length - 1];
    if (last && last.s.endsWith('\n')) { last.s = last.s.slice(0, -1); if (!last.s) cur.runs.pop(); }
    if (cur.runs.length) {
      cur.runs[0].s = cur.runs[0].s.replace(/^ +/, '');
      const l = cur.runs[cur.runs.length - 1]; l.s = l.s.replace(/ +$/, '');
      cur.runs = cur.runs.filter((r) => r.s);
    }
    blocks.push(cur);
    cur = null;
  };
  const start = () => { if (!cur) cur = { ...typeNow(), runs: [], _open: true }; };
  const add = (s) => {
    if (!s) return;
    start();
    const f = fmtNow();
    const prev = cur.runs[cur.runs.length - 1];
    if (prev && sameFmt(prev, f)) prev.s += s; else cur.runs.push({ s, ...f });
  };
  const listOf = () => { for (let i = ctx.length - 1; i >= 0; i--) if (ctx[i].tag === 'ul' || ctx[i].tag === 'ol') return ctx[i].tag; return 'ul'; };

  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|[^<]+|</g;
  const src = String(html ?? '');
  let m, skip = '';
  while ((m = re.exec(src))) {
    const [all, close, rawTag, rest, selfClose] = m;
    if (!rawTag) {
      if (skip || all[0] === '<' && all.length > 1) continue;
      // text: HTML whitespace collapses; &nbsp; is a real space
      const t = decode(all.replace(/[ \t\r\n\f]+/g, ' ')).replace(/ /g, ' ');
      if (t === ' ' && !cur) continue; // whitespace between blocks
      add(t);
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (skip) { if (close && tag === skip) skip = ''; continue; }
    if (SKIP.has(tag)) { if (!close && !selfClose) skip = tag; continue; }
    if (close) {
      let i = ctx.length - 1;
      while (i >= 0 && ctx[i].tag !== tag) i--;
      if (i < 0) continue;
      const wasBlock = ctx.slice(i).some((c) => c.block);
      ctx.length = i;
      if (wasBlock) flush();
      continue;
    }
    if (tag === 'br') { add('\n'); continue; }
    if (tag === 'td' || tag === 'th') { if (cur && cur.runs.length) add(' '); continue; }
    if (VOID.has(tag)) continue;
    const a = attrs(rest);
    const st = styleOf(a.style);
    const fmt = {};
    if (tag === 'b' || tag === 'strong') fmt.b = true;
    if (tag === 'i' || tag === 'em') fmt.i = true;
    if (tag === 'u' || tag === 'ins') fmt.u = true;
    if (tag === 's' || tag === 'strike' || tag === 'del') fmt.x = true;
    if (tag === 'a') { const h = cleanHref(a.href); if (h) fmt.a = h; }
    if (tag === 'font' && a.color) { const c = cleanColor(a.color); if (c) fmt.c = c; }
    if (st['font-weight'] && (st['font-weight'] === 'bold' || st['font-weight'] === 'bolder' || Number(st['font-weight']) >= 600)) fmt.b = true;
    if (st['font-weight'] && (st['font-weight'] === 'normal' || Number(st['font-weight']) && Number(st['font-weight']) < 600)) fmt.b = false;
    if (st['font-style'] === 'italic') fmt.i = true;
    if (st['font-style'] === 'normal') fmt.i = false;
    const deco = st['text-decoration'] || st['text-decoration-line'] || '';
    if (/underline/.test(deco)) fmt.u = true;
    if (/line-through/.test(deco)) fmt.x = true;
    if (st.color) { const c = cleanColor(st.color); if (c) fmt.c = c; }
    const bg = st['background-color'] || st.background;
    if (bg) { const c = cleanColor(bg); if (c && c !== '#ffffff') fmt.h = c; }
    const block = BLOCKS.has(tag);
    const entry = { tag, fmt: Object.keys(fmt).length ? fmt : null, block };
    if (tag === 'li') entry.list = listOf();
    if (block) flush();
    if (!selfClose) ctx.push(entry);
  }
  flush();
  // tidy: false flags out, empty runs gone, list numbers, no runaway blank lines
  const out = [];
  blocks.forEach((b) => {
    delete b._open;
    b.runs = b.runs.map(tidyRun).filter((r) => r.s);
    if (b.t !== 'li') delete b.list;
    const prev = out[out.length - 1];
    if (!b.runs.length && b.t !== 'p') b.t = 'p';
    if (!b.runs.length && prev && !prev.runs.length) return; // one blank line is enough
    out.push(b);
  });
  while (out.length && !out[0].runs.length) out.shift();
  while (out.length && !out[out.length - 1].runs.length) out.pop();
  number(out);
  return out;
}
function tidyRun(r) {
  const o = { s: r.s };
  ['b', 'i', 'u', 'x'].forEach((k) => { if (r[k]) o[k] = true; });
  if (r.a) o.a = r.a;
  if (r.c && r.c !== '#141826' && r.c !== '#000000') o.c = r.c;
  if (r.h) o.h = r.h;
  return o;
}
function sameFmt(a, b) {
  return ['b', 'i', 'u', 'x', 'a', 'c', 'h'].every((k) => (a[k] || false) === (b[k] || false));
}
function number(blocks) {
  let n = 0, prev = null;
  blocks.forEach((b) => {
    if (b.t === 'li' && b.list === 'ol') { n = prev && prev.t === 'li' && prev.list === 'ol' ? n + 1 : 1; b.n = n; } else delete b.n;
    prev = b;
  });
}

/** Plain text → blocks (one paragraph a line). */
export function plainToBlocks(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => ({ t: 'p', runs: l ? [{ s: l }] : [] }));
}

/** Blocks → the plain text kept in the record (bullets as •, numbers as 1.). */
export function toText(blocks) {
  return (blocks || []).map((b) => {
    const s = b.runs.map((r) => r.s).join('');
    if (b.t === 'li') return (b.list === 'ol' ? `${b.n || 1}. ` : '• ') + s;
    return s;
  }).join('\n');
}

function runHTML(r) {
  let h = escText(r.s).replace(/\n/g, '<br>');
  const css = [];
  if (r.c) css.push('color: ' + r.c);
  if (r.h) css.push('background-color: ' + r.h);
  if (css.length) h = `<span style="${css.join('; ')}">${h}</span>`;
  if (r.x) h = `<s>${h}</s>`;
  if (r.u) h = `<u>${h}</u>`;
  if (r.i) h = `<i>${h}</i>`;
  if (r.b) h = `<b>${h}</b>`;
  if (r.a) h = `<a href="${escAttr(r.a)}" target="_blank" rel="noopener noreferrer">${h}</a>`;
  return h;
}
/** Blocks → clean HTML (what's stored and what the editor shows). */
export function toHTML(blocks) {
  let out = '', list = '';
  (blocks || []).forEach((b) => {
    if (list && !(b.t === 'li' && b.list === list)) { out += `</${list}>`; list = ''; }
    const inner = b.runs.map(runHTML).join('') || '<br>';
    if (b.t === 'li') { if (!list) { list = b.list || 'ul'; out += `<${list}>`; } out += `<li>${inner}</li>`; return; }
    if (b.t === 'quote') out += `<blockquote>${inner}</blockquote>`;
    else if (b.t === 'h3' || b.t === 'h4') out += `<${b.t}>${inner}</${b.t}>`;
    else out += `<p>${inner}</p>`;
  });
  if (list) out += `</${list}>`;
  return out;
}

/** True when the blocks are just plain paragraphs (nothing worth keeping as formatting). */
export function isPlain(blocks) {
  return (blocks || []).every((b) => b.t === 'p' && b.runs.every((r) => Object.keys(r).length === 1));
}

const norm = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trim();

/** A field's formatted blocks, or null when it has none (or they no longer match its text). */
export function richBlocks(values, fid) {
  const html = values?.[RICH_KEY]?.[fid];
  if (!html || typeof html !== 'string') return null;
  const b = parseRich(html);
  return norm(toText(b)) === norm(values[fid]) ? b : null;
}

/** What the editor shows for a field: its formatting, or its plain text as paragraphs. */
export function editorHTML(values, fid) {
  return toHTML(richBlocks(values, fid) || plainToBlocks(values?.[fid]));
}

/**
 * The editor's HTML → { text, html } to store; html is null when there's no formatting to keep.
 * Stored HTML is always re-made from the model, so nothing outside it survives.
 */
export function fromEditor(html) {
  const b = parseRich(html);
  const text = toText(b);
  return { text, html: !text.trim() || isPlain(b) ? null : toHTML(b) };
}

/** values with this field's formatting set (or removed). Returns a new object. */
export function withRich(values, fid, html) {
  const r = { ...(values?.[RICH_KEY] || {}) };
  if (html) r[fid] = html; else delete r[fid];
  const out = { ...(values || {}) };
  if (Object.keys(r).length) out[RICH_KEY] = r; else delete out[RICH_KEY];
  return out;
}
