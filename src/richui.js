// Formatted long text: the editor on a record. The field is an editable box; its toolbar floats just
// above it while you're in it (and is gone while you're reading). The words and their formatting are
// read with richtext.js, which also cleans anything pasted in.
import { esc } from './util.js';
import { editorHTML, toHTML, parseRich, plainToBlocks } from './richtext.js';

export const TEXT_COLORS = [['Default', '#141826'], ['Red', '#b42335'], ['Orange', '#b45309'], ['Green', '#1d7349'], ['Blue', '#3346c8'], ['Purple', '#7434b0']];
export const HIGHLIGHTS = [['No highlight', ''], ['Yellow', '#fff1a8'], ['Green', '#d6f5e0'], ['Blue', '#dfe6ff'], ['Pink', '#fde2ec']];
const BLOCK_NAME = { p: 'Normal text', h3: 'Heading', h4: 'Subheading', blockquote: 'Quote' };

const ico = (d, extra = '') => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${extra}<path d="${d}"/></svg>`;
const DOTS = '<circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>';

/** The editor for a long text field. values: the record's values (for its formatting). */
export function richEditorHTML(f, values, id, ph = '') {
  const bt = (act, label, inner, extra = '') => `<button type="button" class="rtb" data-rt="${act}" aria-label="${label}" title="${label}"${extra}>${inner}</button>`;
  return `<div class="rte" data-rte="${f.id}">
    <div class="in rte-ed" contenteditable="true" id="${id}" data-fid="${f.id}" data-rich="1" role="textbox" aria-multiline="true" aria-label="${esc(f.label || 'Long text')}"${ph ? ` data-ph="${esc(ph)}"` : ''} spellcheck="true">${String(values?.[f.id] ?? '').trim() ? editorHTML(values, f.id) : ''}</div>
    <div class="rte-bar" role="toolbar" aria-label="Formatting for ${esc(f.label || 'this field')}">
      <button type="button" class="rtb rtb-blk" data-rt="pop-block" aria-haspopup="true" aria-expanded="false" title="Text style"><span class="rtb-bl">Normal text</span>${ico('M6 9l6 6 6-6')}</button>
      <span class="rtsep"></span>
      ${bt('bold', 'Bold (Ctrl+B)', '<b>B</b>', ' aria-pressed="false"')}${bt('italic', 'Italic (Ctrl+I)', '<i class="rt-i">I</i>', ' aria-pressed="false"')}${bt('underline', 'Underline (Ctrl+U)', '<u>U</u>', ' aria-pressed="false"')}${bt('strikeThrough', 'Strikethrough', '<s>S</s>', ' aria-pressed="false"')}
      <button type="button" class="rtb rtb-col" data-rt="pop-color" aria-haspopup="true" aria-expanded="false" aria-label="Text colour and highlight" title="Colour and highlight"><span>A</span><span class="rtb-cbar"></span></button>
      <span class="rtsep"></span>
      ${bt('insertUnorderedList', 'Bulleted list', ico('M9 6h11M9 12h11M9 18h11', DOTS), ' aria-pressed="false"')}${bt('insertOrderedList', 'Numbered list', ico('M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M3.5 9h3M3.5 14.5h3l-3 4.5h3'), ' aria-pressed="false"')}${bt('quote', 'Quote', ico('M5 7h5v5c0 3-2 5-4.5 5.5M14 7h5v5c0 3-2 5-4.5 5.5'), ' aria-pressed="false"')}
      <span class="rtsep"></span>
      <button type="button" class="rtb" data-rt="pop-link" aria-haspopup="true" aria-expanded="false" aria-pressed="false" aria-label="Link (Ctrl+K)" title="Link (Ctrl+K)">${ico('M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1')}</button>
      ${bt('clear', 'Clear formatting', ico('M5 6h12M11.5 6L9 18M15 15l5 5M20 15l-5 5'))}
    <div class="rte-pop rte-pblock" data-rtpop="block" hidden role="menu">${Object.entries({ p: 'Normal text', h3: 'Heading', h4: 'Subheading' }).map(([k, l]) => `<button type="button" class="rtmi rtmi-${k}" role="menuitem" data-rt="block" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="rte-pop rte-pcol" data-rtpop="color" hidden><span class="rtp-h">Text colour</span><div class="rtp-sw">${TEXT_COLORS.map(([n, c]) => `<button type="button" class="rtsw" data-rt="color" data-v="${c}" aria-label="${n}" title="${n}" style="color:${c}">A</button>`).join('')}</div>
      <span class="rtp-h">Highlight</span><div class="rtp-sw">${HIGHLIGHTS.map(([n, c]) => `<button type="button" class="rtsw${c ? '' : ' rtsw-none'}" data-rt="hilite" data-v="${c}" aria-label="${n}" title="${n}"${c ? ` style="background:${c}"` : ''}></button>`).join('')}</div></div>
    <div class="rte-pop rte-plink" data-rtpop="link" hidden><input class="in" data-rtlink="1" type="url" placeholder="Paste or type a link" aria-label="Link address"><button type="button" class="btn sm primary" data-rt="link-apply">Apply</button><button type="button" class="btn sm ghost" data-rt="link-remove" hidden>Remove</button></div>
    </div>
  </div>`;
}

/** A formatted long text value, read only. */
export function richViewHTML(values, fid, id = '') {
  return `<div class="in rte-view"${id ? ` id="${id}"` : ''}>${editorHTML(values, fid)}</div>`;
}

/* ---------- behaviour ---------- */
const ranges = new WeakMap(); // editor → its last selection
const edOf = (el) => el?.closest?.('.rte')?.querySelector('.rte-ed');
function selIn(ed) {
  const s = document.getSelection();
  return s && s.rangeCount && ed.contains(s.anchorNode) ? s : null;
}
function restore(ed) {
  ed.focus({ preventScroll: true });
  const r = ranges.get(ed);
  if (!r) return;
  const s = document.getSelection();
  s.removeAllRanges(); s.addRange(r);
}
function closePops(rte, except = '') {
  rte.querySelectorAll('[data-rtpop]').forEach((p) => { if (p.dataset.rtpop !== except) p.hidden = true; });
  rte.querySelectorAll('[data-rt^="pop-"]').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.rt === 'pop-' + except)));
}
const blockOf = (ed, node) => {
  const n = node?.nodeType === 1 ? node : node?.parentElement;
  const b = n?.closest?.('h1,h2,h3,h4,h5,h6,blockquote,li,p,div');
  return b && ed.contains(b) && b !== ed ? b : null;
};
function exec(cmd, val) {
  try { document.execCommand('styleWithCSS', false, cmd === 'foreColor' || cmd === 'hiliteColor'); } catch (e) { /* older browsers */ }
  document.execCommand(cmd, false, val);
}
/** Show which styles apply where the cursor is. */
function paintBar(ed) {
  const rte = ed.closest('.rte'), s = selIn(ed);
  if (!rte || !s) return;
  const q = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };
  ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].forEach((c) => rte.querySelector(`[data-rt="${c}"]`)?.setAttribute('aria-pressed', String(q(c))));
  const n = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
  rte.querySelector('[data-rt="quote"]')?.setAttribute('aria-pressed', String(!!n.closest('blockquote')));
  rte.querySelector('[data-rt="pop-link"]')?.setAttribute('aria-pressed', String(!!n.closest('a')));
  const b = blockOf(ed, s.anchorNode);
  const tag = b ? b.tagName.toLowerCase() : 'p';
  const k = /^h[1-3]$/.test(tag) ? 'h3' : /^h[4-6]$/.test(tag) ? 'h4' : tag === 'blockquote' || n.closest('blockquote') ? 'blockquote' : 'p';
  const l = rte.querySelector('.rtb-bl'); if (l) l.textContent = BLOCK_NAME[k];
  rte.dataset.block = k;
}

function act(btn) {
  const rte = btn.closest('.rte'), ed = rte?.querySelector('.rte-ed');
  if (!ed) return;
  const a = btn.dataset.rt, v = btn.dataset.v;
  if (a.startsWith('pop-')) {
    const name = a.slice(4), pop = rte.querySelector(`[data-rtpop="${name}"]`);
    const open = pop.hidden;
    closePops(rte, open ? name : '');
    pop.hidden = !open;
    if (open && name === 'link') {
      const s = selIn(ed) ? document.getSelection() : null;
      const r = ranges.get(ed);
      const node = s?.anchorNode || r?.startContainer;
      const link = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('a');
      const inp = pop.querySelector('[data-rtlink]');
      inp.value = link ? link.getAttribute('href') || '' : '';
      pop.querySelector('[data-rt="link-remove"]').hidden = !link;
      setTimeout(() => inp.focus(), 0);
    }
    return;
  }
  restore(ed);
  switch (a) {
    case 'block': { const cur = rte.dataset.block || 'p'; exec('formatBlock', `<${v === cur && v !== 'p' ? 'p' : v}>`); break; }
    case 'quote': exec('formatBlock', rte.dataset.block === 'blockquote' ? '<p>' : '<blockquote>'); break;
    case 'color': exec('foreColor', v); { const bar = rte.querySelector('.rtb-cbar'); if (bar) bar.style.background = v; } break;
    case 'hilite': exec('hiliteColor', v || 'transparent'); break;
    case 'clear': exec('removeFormat'); exec('unlink'); exec('formatBlock', '<p>'); break;
    case 'link-apply': linkApply(rte, ed); break;
    case 'link-remove': exec('unlink'); break;
    default: exec(a);
  }
  closePops(rte);
  paintBar(ed);
}
function linkApply(rte, ed) {
  const inp = rte.querySelector('[data-rtlink]');
  let v = String(inp?.value || '').trim();
  if (!v) { exec('unlink'); return; }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v) ? 'mailto:' : 'https://') + v;
  const r = ranges.get(ed);
  if (!r || r.collapsed) exec('insertHTML', `<a href="${esc(v)}">${esc(v.replace(/^mailto:/, ''))}</a>&nbsp;`);
  else exec('createLink', v);
}

/** Typing shortcuts: # Heading, ## Subheading, - or * bullets, 1. numbers, > quote, **bold**, *italic*, _italic_. */
const MARKS = [[/^#$/, ['formatBlock', '<h3>']], [/^##$/, ['formatBlock', '<h4>']], [/^[-*]$/, ['insertUnorderedList']], [/^1[.)]$/, ['insertOrderedList']], [/^>$/, ['formatBlock', '<blockquote>']]];
function shortcut(ed, data) {
  const s = selIn(ed);
  if (!s || !s.isCollapsed) return;
  const node = s.anchorNode, off = s.anchorOffset;
  if (!node || node.nodeType !== 3) return;
  if (data === ' ') {
    const b = blockOf(ed, node);
    if (b && b.tagName === 'LI') return;
    const r = document.createRange();
    r.setStart(b || ed, 0); r.setEnd(node, off);
    const typed = r.toString().replace(/ /g, ' ');
    if (!typed.endsWith(' ') || typed.length > 4) return;
    const mark = typed.slice(0, -1);
    const hit = MARKS.find(([re]) => re.test(mark));
    if (!hit) return;
    s.removeAllRanges(); s.addRange(r);
    exec('delete');
    exec(...hit[1]);
    return;
  }
  if (data !== '*' && data !== '_') return;
  const before = node.data.slice(0, off);
  let m = /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/.exec(before), tag = 'b';
  if (!m) { m = /(?:^|[\s(])([*_])([^*_\s](?:[^*_]*[^*_\s])?)\1$/.exec(before); tag = 'i'; if (m) m = [m[0].replace(/^[\s(]/, ''), m[2]]; }
  if (!m) return;
  const r = document.createRange();
  r.setStart(node, off - m[0].length); r.setEnd(node, off);
  s.removeAllRanges(); s.addRange(r);
  exec('insertHTML', `<${tag}>${esc(m[1])}</${tag}>`);
  const cmd = tag === 'b' ? 'bold' : 'italic';
  try { if (document.queryCommandState(cmd)) exec(cmd); } catch (e) { /* fine */ }
}

let wired = false;
export function initRichUI() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  // keep the text selected while using the toolbar
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest?.('.rte-bar, .rte-pop') && !e.target.closest('input')) e.preventDefault();
  }, true);
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-rt]');
    if (b && b.closest('.rte')) { e.preventDefault(); act(b); return; }
    // a click elsewhere closes any open menu
    document.querySelectorAll('.rte-pop:not([hidden])').forEach((p) => { if (!p.closest('.rte').contains(e.target)) closePops(p.closest('.rte')); });
  });
  document.addEventListener('selectionchange', () => {
    const s = document.getSelection();
    if (!s || !s.rangeCount) return;
    const n = s.anchorNode, ed = (n?.nodeType === 1 ? n : n?.parentElement)?.closest?.('.rte-ed');
    if (!ed) return;
    ranges.set(ed, s.getRangeAt(0).cloneRange());
    paintBar(ed);
  });
  document.addEventListener('focusin', (e) => {
    if (e.target.classList?.contains('rte-ed')) { try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (err) { /* fine */ } }
  });
  document.addEventListener('focusout', (e) => {
    const rte = e.target.closest?.('.rte');
    if (rte && !(e.relatedTarget && rte.contains(e.relatedTarget))) closePops(rte);
  });
  document.addEventListener('keydown', (e) => {
    const inLink = e.target.dataset?.rtlink;
    if (inLink && e.key === 'Enter') { e.preventDefault(); act(e.target.closest('.rte').querySelector('[data-rt="link-apply"]')); return; }
    if (inLink && e.key === 'Escape') { e.preventDefault(); const rte = e.target.closest('.rte'); closePops(rte); restore(rte.querySelector('.rte-ed')); return; }
    if (e.key === 'Escape' && e.target.closest?.('.rte') && e.target.closest('.rte').querySelector('.rte-pop:not([hidden])')) { closePops(e.target.closest('.rte')); return; }
    if (!e.target.classList?.contains('rte-ed')) return;
    // Enter on an empty quote or heading line goes back to normal text (as in most editors)
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      const ed = e.target, s = selIn(ed), bl = s && s.isCollapsed ? blockOf(ed, s.anchorNode) : null;
      if (bl && /^(BLOCKQUOTE|H[1-6])$/.test(bl.tagName) && !bl.textContent.replace(/\u00a0/g, ' ').trim()) { e.preventDefault(); exec('formatBlock', '<p>'); paintBar(ed); return; }
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); act(e.target.closest('.rte').querySelector('[data-rt="pop-link"]')); }
  });
  document.addEventListener('input', (e) => {
    const ed = e.target;
    if (!ed.classList?.contains('rte-ed') || e.inputType !== 'insertText') return;
    shortcut(ed, e.data);
  }, true);
  // paste: keep only what the editor understands
  document.addEventListener('paste', (e) => {
    const ed = e.target.closest?.('.rte-ed');
    if (!ed) return;
    const cd = e.clipboardData; if (!cd) return;
    const html = cd.getData('text/html'), text = cd.getData('text/plain');
    e.preventDefault();
    if (html) exec('insertHTML', toHTML(parseRich(html)) || esc(text));
    else if (text.includes('\n')) exec('insertHTML', toHTML(plainToBlocks(text)));
    else exec('insertText', text);
  });
}
