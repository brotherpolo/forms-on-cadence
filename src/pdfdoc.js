// A record as a PDF: the pure part. Turns fields and values into printable items, wraps text,
// sizes table columns and names the file. No DOM, no Firebase, no PDF library (pdfdraw.js draws).

/** How each field type prints. */
export function fieldKind(type) {
  if (type === 'heading') return 'heading';
  if (type === 'textarea') return 'long';
  if (type === 'image') return 'image';
  if (type === 'signature') return 'signature';
  if (type === 'file') return 'file';
  if (type === 'rating') return 'rating';
  if (type === 'color') return 'color';
  return 'text';
}

const fsize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

/**
 * One field as a printable item. `text` is the value as the app shows it (fmt), '' when empty.
 *   heading   { kind, label, help }
 *   text/long { kind, label, width, text, rich? }   rich: richtext.js blocks, when the long text is formatted
 *   image     { kind, label, width, src: {path,url}|dataURL, name, text }
 *   signature { kind, label, width, src: dataURL, text }
 *   file      { kind, label, width, text: 'name · size' }
 *   rating    { kind, label, width, n, max, text }
 *   color     { kind, label, width, hex, text }
 */
export function fieldItem(f, v, text, rich = null) {
  const kind = fieldKind(f.type);
  const width = f.width === 'half' && kind !== 'long' ? 'half' : 'full';
  const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
  if (kind === 'heading') return { kind, label: f.label || '', help: f.help || '' };
  const base = { kind, label: f.label || '', width, text: text || '' };
  if (empty && f.type !== 'checkbox' && f.type !== 'formula') return { ...base, kind: kind === 'long' ? 'long' : 'text', text: '' };
  switch (kind) {
    case 'image': {
      const src = v && (v.path || v.url) ? { path: v.path || '', url: v.url || '' } : v?.data || '';
      return { ...base, src, name: v?.name || 'Photo', text: v?.name || 'Photo' };
    }
    case 'signature':
      return { ...base, src: typeof v === 'string' && v.startsWith('data:image/') ? v : '', text: 'Signed' };
    case 'file':
      return { ...base, text: [v?.name || 'File', v?.size ? fsize(v.size) : ''].filter(Boolean).join(' · ') };
    case 'rating':
      return { ...base, n: Math.max(0, Math.round(Number(v) || 0)), max: Math.max(1, Number(f.max) || 5), text: `${v} of ${f.max || 5}` };
    case 'color':
      return { ...base, hex: /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : '', text: String(v) };
    default:
      return kind === 'long' && rich && rich.length ? { ...base, rich } : base;
  }
}

/**
 * Lay fields out like the record page: a half-width field shares a line with the next
 * half-width one; full-width fields and headings take a line of their own.
 * → [{ heading }, { cells: [item] | [item, item] }]
 */
export function fieldRows(items) {
  const out = [];
  let pending = null;
  const flush = () => { if (pending) { out.push({ cells: [pending] }); pending = null; } };
  items.forEach((it) => {
    if (it.kind === 'heading') { flush(); out.push({ heading: it }); return; }
    if (it.width === 'half') {
      if (pending) { out.push({ cells: [pending, it] }); pending = null; } else pending = it;
      return;
    }
    flush();
    out.push({ cells: [it] });
  });
  flush();
  return out;
}

// Characters the standard PDF fonts lack, spelled with ones they have.
const SWAP = {
  '→': '->', '←': '<-', '↔': '<->', '≥': '>=', '≤': '<=', '≠': '!=',
  '★': '*', '☆': '-', '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x', '✕': 'x',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '﻿': '',
  '‒': '-', '―': '-', '−': '-', '″': '"', '′': "'", '‐': '-', '‑': '-',
  '▲': '^', '▼': 'v', '●': '•', '◦': '•', '∙': '•',
};

/**
 * Text the font can draw: tabs become spaces, look-alikes swap in, anything else becomes '?'.
 * `has(codePoint)` says whether the font has a character. Line breaks are kept.
 */
export function safeText(s, has) {
  let out = '';
  for (const ch of String(s ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')) {
    if (ch === '\n') { out += ch; continue; }
    const cp = ch.codePointAt(0);
    if (has(cp)) { out += ch; continue; }
    if (SWAP[ch] != null) { out += [...SWAP[ch]].every((c) => has(c.codePointAt(0))) ? SWAP[ch] : '?'; continue; }
    const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, ''); // accents the font lacks: drop the accent
    out += plain && plain !== ch && [...plain].every((c) => has(c.codePointAt(0))) ? plain : '?';
  }
  return out;
}

/**
 * Break text into lines no wider than `width`. `measure(str)` gives a string's width.
 * Keeps the text's own line breaks; a word longer than a line is split.
 */
export function wrapText(text, width, measure) {
  const lines = [];
  String(text ?? '').split('\n').forEach((para) => {
    const words = para.split(/ +/);
    let line = '';
    words.forEach((w) => {
      const tryLine = line ? line + ' ' + w : w;
      if (measure(tryLine) <= width) { line = tryLine; return; }
      if (line) lines.push(line);
      line = '';
      // a word wider than the line: cut it up, never leaving a piece of fewer than 3 characters
      let rest = w;
      while (measure(rest) > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n)) > width) n--;
        if (rest.length - n < 3 && rest.length > 3) n = Math.min(n, rest.length - 3);
        if (n < 3 && rest.length >= 6) n = 3;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    });
    lines.push(line);
  });
  return lines;
}

/**
 * Column widths for a table that fills `avail`: each column wants its widest cell (capped),
 * never narrower than its header's longest word or `min`; extra room is shared out.
 */
export function colWidths(cols, rows, measure, avail, { min = 36, cap = 220, pad = 10 } = {}) {
  const n = cols.length;
  if (!n) return [];
  const want = cols.map((c, i) => {
    let w = Math.max(...String(c.label || '').split(/\s+/).map((s) => measure(s, true)), 0);
    rows.forEach((r) => { w = Math.max(w, Math.min(cap, measure(String(r[i] ?? '')))); });
    return Math.max(min, Math.min(cap, w) + pad);
  });
  const total = want.reduce((a, b) => a + b, 0);
  if (total <= avail) {
    const extra = (avail - total) / n;
    return want.map((w) => w + extra);
  }
  // too wide: shrink the wide columns first, keeping every column at least `min`
  const floor = Math.min(min, avail / n);
  let w = want.slice();
  for (let guard = 0; guard < 20; guard++) {
    const over = w.reduce((a, b) => a + b, 0) - avail;
    if (over <= 0.01) break;
    const big = w.map((x, i) => (x > floor ? i : -1)).filter((i) => i >= 0);
    if (!big.length) break;
    const room = big.reduce((a, i) => a + (w[i] - floor), 0);
    w = w.map((x, i) => (big.includes(i) ? x - over * ((x - floor) / room) : x));
  }
  return w;
}

/** A file name from the form and the record's title: "Site visit - Smith house.pdf". */
export function fileName(formName, title) {
  const clean = (s) => String(s || '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const base = [clean(formName), clean(title)].filter(Boolean).join(' - ').slice(0, 120).trim() || 'Record';
  return base.replace(/[. ]+$/, '') + '.pdf';
}

/** Fit an image of w × h into a box, never enlarging it past `scaleMax` × its pixel size. */
export function fitBox(w, h, maxW, maxH, scaleMax = 1) {
  if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
  const s = Math.min(maxW / w, maxH / h, scaleMax);
  return { w: w * s, h: h * s };
}

/**
 * The part of a picture that isn't empty border: pixels that are see-through or near-white
 * count as border. `data` is RGBA (canvas getImageData). Keeps a 2-pixel margin.
 */
export function trimBox(data, w, h, pad = 2) {
  const bg = (i) => data[i + 3] < 16 || (data[i] > 244 && data[i + 1] > 244 && data[i + 2] > 244);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bg((y * w + x) * 4)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h }; // all border: keep it all
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Fit a table without breaking words: each column is at least as wide as its longest word
 * (numbers, dates and amounts keep their whole value on one line); long-text columns give
 * up room first. Tries each text size in turn, then each page shape (portrait, then
 * landscape). Only when nothing fits are very long words allowed to break.
 *   cols: [{ label, num }], rows: [[text]], measure(size, bold) → (text) → width
 *   spaces: [{ avail, landscape }]
 * → { size, widths, landscape, broken }
 */
export function planTable(cols, rows, measure, { spaces, sizes = [9.5, 8.5, 7.5, 7], pad = 10, cap = 230, maxWord = 0.4, short = 20 } = {}) {
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const tryFit = (sp, size, strict, roomy) => {
    const mF = measure(size, false), mB = measure(size, true);
    const minW = [], want = [];
    cols.forEach((c, i) => {
      const head = Math.max(0, ...String(c.label || '').split(/\s+/).map((w) => mB(w)));
      let longest = 0, full = 0, whole = 0;
      rows.forEach((r) => {
        const t = String(r[i] ?? '');
        const w = mF(t);
        full = Math.max(full, w);
        if (t.length <= short) whole = Math.max(whole, w); // short values (dates, codes, names) stay on one line
        t.split(/\s+/).forEach((x) => { longest = Math.max(longest, mF(x)); });
      });
      let keep = c.num ? full : Math.max(strict ? whole : 0, Math.min(longest, sp.avail * maxWord)); // a giant word (a web address) may wrap
      if (roomy && !c.num) keep = Math.max(keep, Math.min(full, sp.avail * 0.22)); // long text gets a readable width, not a sliver
      minW[i] = Math.max(head, keep) + pad + 0.5;
      want[i] = Math.max(minW[i], Math.min(cap, full) + pad + 0.5);
    });
    if (sum(minW) > sp.avail + 0.01) return null;
    const total = sum(want);
    if (total <= sp.avail) return want.map((w) => w + (sp.avail - total) * (w / total)); // room to spare: share it out
    const flex = sum(want.map((w, i) => w - minW[i])) || 1, over = total - sp.avail;
    return want.map((w, i) => w - (w - minW[i]) * (over / flex));
  };
  // best first: long text roomy and short values whole; then short values whole; then whole words only.
  // At each step: portrait at each text size, then landscape.
  // (Very small text is kept for last: a landscape page at a normal size reads better.)
  for (const [strict, roomy, sz] of [[true, true, sizes.slice(0, 2)], [true, false, sizes.slice(0, 3)], [false, false, sizes]]) {
    for (const sp of spaces) {
      for (const size of sz) {
        const widths = tryFit(sp, size, strict, roomy);
        if (widths) return { size, widths, landscape: !!sp.landscape, broken: false };
      }
    }
  }
  const sp = spaces[spaces.length - 1], size = sizes[sizes.length - 1];
  const widths = colWidths(cols.map((c) => ({ label: c.label })), rows, (t, b) => measure(size, b)(t), sp.avail, { min: 30, cap, pad });
  return { size, widths, landscape: !!sp.landscape, broken: true };
}

/**
 * Lay formatted long text out in lines (richtext.js blocks). measure(fontKey, size, str) → width,
 * fontKey being 'r', 'b', 'i' or 'bi'. Returns [{ h, base, items: [{ s, x, font, size, c, h, u, x2, a }], bar }]:
 * h is the line's height, base the baseline's distance from its top, x from the text's left.
 */
export function layoutRich(blocks, width, measure, { size = 10.5, lh = 14 } = {}) {
  const STY = { p: { size, lh, b: false, gap: 4 }, h3: { size: size * 1.3, lh: lh * 1.3, b: true, gap: 4, before: 4 }, h4: { size: size * 1.08, lh: lh * 1.08, b: true, gap: 3, before: 2 }, quote: { size, lh, b: false, gap: 4, indent: 11, mute: true }, li: { size, lh, b: false, gap: 2, indent: 15 } };
  const out = [];
  (blocks || []).forEach((bk, bi) => {
    const st = STY[bk.t] || STY.p;
    const indent = st.indent || 0, avail = Math.max(20, width - indent);
    const next = blocks[bi + 1];
    const gap = !next ? 0 : bk.t === 'li' && next.t === 'li' ? st.gap : (STY[bk.t] || STY.p).gap + 1;
    const lines = [];
    let line = { items: [], w: 0 };
    const push = () => { lines.push(line); line = { items: [], w: 0 }; };
    const fk = (r) => ((r.b || st.b) && r.i ? 'bi' : (r.b || st.b) ? 'b' : r.i ? 'i' : 'r');
    const put = (s, r) => {
      const font = fk(r), w = measure(font, st.size, s);
      const last = line.items[line.items.length - 1];
      const same = last && last.font === font && last.c === r.c && last.hl === r.h && !!last.u === !!(r.u || r.a) && !!last.st === !!r.x && last.a === r.a;
      if (same) { last.s += s; last.w += w; } else line.items.push({ s, x: indent + line.w, w, font, size: st.size, c: r.c || '', hl: r.h || '', u: !!(r.u || r.a), st: !!r.x, a: r.a || '', mute: !!st.mute });
      line.w += w;
    };
    bk.runs.forEach((r) => {
      String(r.s).split(/(\n| +)/).forEach((tok) => {
        if (!tok) return;
        if (tok === '\n') { push(); return; }
        if (/^ +$/.test(tok)) { if (line.items.length) put(tok, r); return; }
        let w = measure(fk(r), st.size, tok);
        if (line.w + w > avail && line.items.length) {
          // drop trailing spaces, then start a new line
          const l = line.items[line.items.length - 1]; const t = l.s.replace(/ +$/, ''); if (t !== l.s) { const cut = measure(l.font, st.size, l.s) - measure(l.font, st.size, t); l.s = t; l.w -= cut; line.w -= cut; if (!l.s) line.items.pop(); }
          push();
        }
        let rest = tok;
        while (w > avail && rest.length > 1) { // one word wider than the line
          let n = rest.length - 1;
          while (n > 1 && measure(fk(r), st.size, rest.slice(0, n)) > avail - line.w) n--;
          put(rest.slice(0, n), r); push(); rest = rest.slice(n); w = measure(fk(r), st.size, rest);
        }
        put(rest, r);
      });
    });
    push();
    lines.forEach((l, i) => {
      const first = i === 0, lastL = i === lines.length - 1;
      const top = first && bi > 0 ? st.before || 0 : 0;
      out.push({ h: st.lh + top + (lastL ? gap : 0), base: top + st.size * 0.82 + (st.lh - st.size) / 2, items: l.items, bar: bk.t === 'quote', barH: st.lh,
        prefix: first && bk.t === 'li' ? { s: bk.list === 'ol' ? `${bk.n || 1}.` : '•', size: st.size } : null });
    });
  });
  return out;
}
