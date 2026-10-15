// Form designer → Fields → Text: colours for the text as you type, line numbers, and the sections to jump to.
// Pure functions (no DOM, no Firebase), unit-tested. The parser itself is formtext.js; this only paints.
//
// Each line becomes a list of pieces { t, k }, k being one of:
//   head (# Section), cap (caption), punct (: , [ ]), type (text, dropdown, link to), kw (required, half…),
//   str ("quoted"), opt (a choice in [ ]), num, fn (ROUND), ref ({Field}), op (= + * &), tag (@id),
//   comment (// …), plain, err (not understood), referr ({Field} that isn't on the form).
import { TYPE_WORDS_ALL, SETTING_WORDS } from './formtext.js';
import { esc } from './util.js';

const TYPES = new Set(TYPE_WORDS_ALL);
const KEYS = [...SETTING_WORDS].sort((a, b) => b.length - a.length);
const OTHER_FORMS = /\b(CHILD(SUM|COUNT|AVG|MIN|MAX)|PARENT)\s*\(/i;
const TAG = /(\s+)(@[A-Za-z0-9_-]*)\s*$/;

/** Splits at top-level `sep` (outside quotes and brackets), keeping every character. */
function splitTop(s, sep = ',') {
  const out = []; let cur = '', q = false, d = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\' && i + 1 < s.length) cur += s[++i]; else if (c === '"') q = false; continue; }
    if (c === '"') { q = true; cur += c; continue; }
    if ('[({'.includes(c)) d++;
    if ('])}'.includes(c)) d = Math.max(0, d - 1);
    if (c === sep && !d) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
function topIndex(s, ch) {
  let q = false, d = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') i++; else if (c === '"') q = false; continue; }
    if (c === '"') { q = true; continue; }
    if ('[({'.includes(c)) d++;
    else if ('])}'.includes(c)) d = Math.max(0, d - 1);
    else if (c === ch && !d) return i;
  }
  return -1;
}
const lead = (s) => /^\s*/.exec(s)[0];
const unq = (s) => s.trim().replace(/^"|"$/g, '').replace(/\\(.)/g, '$1').trim();

/** Every name a {reference} may use in this text: captions and system names (lower case). */
export function namesIn(text) {
  const n = new Set();
  String(text ?? '').split('\n').forEach((l) => {
    const b = l.replace(TAG, '');
    if (/^\s*(#|\/\/)/.test(b)) return;
    const i = topIndex(b, ':'); if (i < 1) return;
    n.add(unq(b.slice(0, i)).toLowerCase());
    const sn = /system\s+name\s+"((?:[^"\\]|\\.)*)"/i.exec(b);
    if (sn) n.add(sn[1].replace(/\\(.)/g, '$1').trim().toLowerCase());
  });
  return n;
}

function exprPieces(e, push, known, check) {
  const re = /\{[^}]*\}?|"(?:[^"\\]|\\.)*"?|'[^']*'?|\d+(?:\.\d+)?|\s+|[A-Za-z_][A-Za-z0-9_]*|./g;
  const loose = OTHER_FORMS.test(e); // {refs} inside CHILDSUM(…) or PARENT(…) name other forms' fields
  let m;
  while ((m = re.exec(e))) {
    const t = m[0];
    if (t[0] === '{') push(t, check && !loose && t.endsWith('}') && !known.has(t.slice(1, -1).trim().toLowerCase()) ? 'referr' : 'ref');
    else if (t[0] === '"' || t[0] === "'") push(t, 'str');
    else if (/^\d/.test(t)) push(t, 'num');
    else if (/^\s/.test(t)) push(t, 'plain');
    else if (/^[A-Za-z_]/.test(t)) push(t, /^\s*\(/.test(e.slice(m.index + t.length)) ? 'fn' : 'plain');
    else push(t, 'op');
  }
}

function settingPieces(p, push, check, heading) {
  const w = lead(p); push(w, 'plain');
  const s = p.slice(w.length), low = s.toLowerCase();
  if (!s) return;
  for (const k of heading ? ['help'] : KEYS) {
    if (low === k || low.startsWith(k + ' ') || low.startsWith(k + '"')) {
      push(s.slice(0, k.length), 'kw');
      let v = s.slice(k.length); const vw = lead(v); push(vw, 'plain'); v = v.slice(vw.length);
      const vt = v.replace(/\s+$/, '');
      if (vt) push(vt, vt[0] === '"' ? 'str' : /^-?\d/.test(vt) ? 'num' : k === 'as' ? 'type' : 'plain');
      push(v.slice(vt.length), 'plain');
      return;
    }
  }
  push(s, check ? 'err' : 'plain');
}

function typePieces(p, push, check) {
  const w = lead(p); push(w, 'plain');
  const s = p.slice(w.length);
  const lk = /^(link(?:\s+to)?)(\s+)(.*)$/i.exec(s);
  if (lk) { push(lk[1], 'type'); push(lk[2], 'plain'); push(lk[3], 'cap'); return; }
  const b = s.indexOf('[');
  const word = b < 0 ? s : s.slice(0, b);
  const tw = word.replace(/\s+$/, '');
  if (tw) push(tw, TYPES.has(tw.toLowerCase().replace(/\s+/g, ' ')) ? 'type' : check ? 'err' : 'plain');
  push(word.slice(tw.length), 'plain');
  if (b < 0) return;
  const close = s.lastIndexOf(']');
  push('[', 'punct');
  splitTop(s.slice(b + 1, close < 0 ? s.length : close)).forEach((o, i) => {
    if (i) push(',', 'punct');
    const ow = lead(o); push(ow, 'plain');
    const ot = o.slice(ow.length);
    if (ot) push(ot, ot[0] === '"' ? 'str' : 'opt');
  });
  if (close >= 0) { push(']', 'punct'); push(s.slice(close + 1), 'plain'); }
}

/**
 * One line as coloured pieces → { pieces, kind: 'blank'|'comment'|'heading'|'field', bad }.
 * check: mark what isn't understood (off for the line being typed, so a half-written word isn't red).
 */
export function lineParts(line, known = new Set(), check = true) {
  const pieces = []; let bad = false, kind = 'field';
  const push = (t, k) => { if (!t) return; const l = pieces[pieces.length - 1]; if (l && l.k === k) l.t += t; else pieces.push({ t, k }); if (k === 'err' || k === 'referr') bad = true; };
  if (!line.trim()) return { pieces, kind: 'blank', bad };
  if (/^\s*\/\//.test(line)) { push(line, 'comment'); return { pieces, kind: 'comment', bad }; }
  const tm = TAG.exec(line);
  const body = tm ? line.slice(0, tm.index) : line;
  if (/^\s*#/.test(body)) {
    kind = 'heading';
    const parts = splitTop(body);
    push(parts[0], 'head');
    parts.slice(1).forEach((p) => { push(',', 'punct'); settingPieces(p, push, check, true); });
  } else {
    const ci = topIndex(body, ':');
    if (ci < 0) push(body, 'cap');
    else {
      push(body.slice(0, ci), 'cap'); push(':', 'punct');
      let rest = body.slice(ci + 1), expr = null;
      const ei = topIndex(rest, '=');
      if (ei >= 0) { expr = rest.slice(ei + 1); rest = rest.slice(0, ei); }
      splitTop(rest).forEach((p, i) => { if (i) push(',', 'punct'); if (i === 0) typePieces(p, push, check); else settingPieces(p, push, check, false); });
      if (expr !== null) { push('=', 'op'); exprPieces(expr, push, known, check); }
    }
  }
  if (tm) { push(tm[1], 'plain'); push(tm[2], 'tag'); }
  return { pieces, kind, bad };
}

/** The sections, in order: [{ line (1-based), name }]. */
export function sectionsIn(text) {
  const out = [];
  String(text ?? '').split('\n').forEach((l, i) => {
    if (!/^\s*#/.test(l)) return;
    const name = unq(splitTop(l.replace(TAG, '').replace(/^\s*#+\s*/, ''))[0] || '');
    out.push({ line: i + 1, name: name || 'Untitled section' });
  });
  return out;
}

/**
 * The painted text and its line numbers, as HTML.
 * opts.caretLine (1-based): left unchecked while it's being typed. opts.problems: Map line → message
 * (from the parser), shown on that line's number.
 */
export function paint(text, { caretLine = 0, problems = new Map() } = {}) {
  const known = namesIn(text);
  const lines = String(text ?? '').split('\n');
  let code = '', gut = '', count = 0;
  lines.forEach((l, i) => {
    const n = i + 1, typing = n === caretLine;
    const r = lineParts(l, known, !typing);
    const why = typing ? '' : problems.get(n) || (r.bad ? 'Something on this line isn’t understood.' : '');
    if (why) count++;
    const cls = 'tx-l' + (r.kind === 'heading' ? ' tx-h' : '');
    code += `<div class="${cls}">${r.pieces.map((p) => `<span class="tx-${p.k}">${esc(p.t)}</span>`).join('')}</div>`;
    gut += `<div class="${cls}${why ? ' tx-bad' : ''}"${why ? ` title="${esc(why)}"` : ''}>${n}</div>`;
  });
  return { code, gut, count };
}
