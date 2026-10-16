// A small XML reader and writer for Word documents (docx.js). Pure, no DOM, unit-tested.
// Elements keep their attributes as written; text is decoded on reading and encoded on writing.
//   el:   { t: 'el', name, attrs: ' w:val="x"', kids: [], self: bool }
//   text: { t: 'text', v: 'decoded text' }
//   raw:  { t: 'raw', v: '<?xml …?>' } (declarations and comments, kept as they are)

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decodeXml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return ENT[e.toLowerCase()] ?? m;
});
const BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export const encodeText = (s) => String(s ?? '').replace(BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const encodeAttr = (s) => encodeText(s).replace(/"/g, '&quot;');

/** XML text → a root { t: 'el', name: '#root', kids }. */
export function parseXml(xml) {
  const root = { t: 'el', name: '#root', attrs: '', kids: [] };
  const stack = [root];
  const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([^\s>/]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[6] != null) { top.kids.push({ t: 'text', v: decodeXml(m[6]) }); continue; }
    if (m[1] != null) { top.kids.push({ t: 'text', v: m[1] }); continue; }
    if (m[3] == null) { top.kids.push({ t: 'raw', v: m[0] }); continue; }
    if (m[2] === '/') {
      // close the nearest matching element (Word's XML is well formed; this just doesn't crash if not)
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].name === m[3]) { stack.length = i; break; }
      continue;
    }
    const el = { t: 'el', name: m[3], attrs: m[4] || '', kids: [], self: m[5] === '/' };
    top.kids.push(el);
    if (!el.self) stack.push(el);
  }
  return root;
}

/** Back to XML text. */
export function writeXml(node) {
  if (node.t === 'text') return encodeText(node.v);
  if (node.t === 'raw') return node.v;
  const inner = node.kids.map(writeXml).join('');
  if (node.name === '#root') return inner;
  if (!inner && node.self) return `<${node.name}${node.attrs}/>`;
  return `<${node.name}${node.attrs}>${inner}</${node.name}>`;
}

export const el = (name, attrs = '', kids = []) => ({ t: 'el', name, attrs, kids, self: !kids.length });
export const txt = (v) => ({ t: 'text', v });
export const clone = (n) => (n.t === 'el' ? { ...n, kids: n.kids.map(clone) } : { ...n });
export const kidsNamed = (n, name) => (n.kids || []).filter((k) => k.t === 'el' && k.name === name);
export const firstNamed = (n, name) => (n.kids || []).find((k) => k.t === 'el' && k.name === name) || null;

/** Every element called name under n, in order (not looking inside matches). */
export function findAll(n, name, out = []) {
  for (const k of n.kids || []) {
    if (k.t !== 'el') continue;
    if (k.name === name) out.push(k); else findAll(k, name, out);
  }
  return out;
}

/** An attribute's value: attr(node, 'w:val'). */
export function attr(n, name) {
  const m = new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`).exec(n.attrs || '');
  return m ? decodeXml(m[1]) : null;
}
export function setAttr(n, name, value) {
  const re = new RegExp(`\\s${name.replace(':', '\\:')}="[^"]*"`);
  const a = ` ${name}="${encodeAttr(value)}"`;
  n.attrs = re.test(n.attrs || '') ? n.attrs.replace(re, a) : (n.attrs || '') + a;
}
