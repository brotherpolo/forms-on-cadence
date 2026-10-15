// A record as a PDF: the drawing. Takes the PDF library (pdf-lib, loaded only when someone
// exports) and a model built by pdfexport.js, and returns the PDF's bytes.
//
// model = {
//   brand: { name, logoKey }            company name and logo (Administration → PDF exports)
//   accent: '#3346c8'                   the form's colour
//   formName, title, meta: [string], parent: string|null
//   items: [fieldItem…]                 from pdfdoc.fieldItem; image/signature items carry imgKey
//   sections: [{ title, count, cols:[{label,num}], rows:[[text]], total:[text]|null, empty }]
//   stamp: 'Exported 14 Oct 2026, 9:01 PM'
// }
// imgs: Map(key → { bytes: Uint8Array, type: 'png'|'jpg' })

import { safeText, wrapText, planTable, fieldRows, fitBox } from './pdfdoc.js';

const M = 54, BOTTOM = M + 30, GUTTER = 24; // ¾-inch margins
const PORTRAIT = [612, 792], LANDSCAPE = [792, 612]; // US Letter
const CW_PORTRAIT = PORTRAIT[0] - 2 * M, CW_LANDSCAPE = LANDSCAPE[0] - 2 * M;
// the page shape being drawn on: a table too wide for portrait gets landscape pages of its own
let W, H, TOP, CW;
const shape = (landscape) => { [W, H] = landscape ? LANDSCAPE : PORTRAIT; TOP = H - M; CW = W - 2 * M; };

const hexRgb = (rgb, hex, fallback) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

export async function drawPdf(L, model, imgs = new Map()) {
  const { PDFDocument, StandardFonts, rgb } = L;
  shape(false);
  const pdf = await PDFDocument.create();
  const F = await pdf.embedFont(StandardFonts.Helvetica);
  const B = await pdf.embedFont(StandardFonts.HelveticaBold);
  const I = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const chars = new Set(F.getCharacterSet());
  const T = (s) => safeText(s, (cp) => chars.has(cp));

  const INK = rgb(0.1, 0.11, 0.14), MUTE = rgb(0.4, 0.43, 0.49), RULE = rgb(0.84, 0.85, 0.88);
  const FAINT = rgb(0.955, 0.96, 0.968), ACC = hexRgb(rgb, model.accent, rgb(0.2, 0.27, 0.78));

  const title = T(model.title || 'Untitled');
  const brandName = T(model.brand?.name || '');
  pdf.setTitle([T(model.formName), title].filter(Boolean).join(' - '));
  if (brandName) pdf.setAuthor(brandName);
  pdf.setCreator('Formwright');
  pdf.setProducer('Formwright');

  // pictures: embed each once; one that won't embed is printed as its name instead
  const pics = new Map();
  for (const [key, im] of imgs) {
    try { pics.set(key, im.type === 'png' ? await pdf.embedPng(im.bytes) : await pdf.embedJpg(im.bytes)); } catch (e) { /* unreadable picture */ }
  }

  let page = null, y = 0;
  const widthOf = (font, size) => (s) => font.widthOfTextAtSize(s, size);
  const one = (s, font, size, w) => { // one line, cut with … when too long
    s = T(s);
    if (font.widthOfTextAtSize(s, size) <= w) return s;
    while (s.length > 1 && font.widthOfTextAtSize(s + '…', size) > w) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  };
  const text = (s, x, yy, font, size, color = INK) => { if (s) page.drawText(s, { x, y: yy, font, size, color }); };
  const rule = (yy, color = RULE, x = M, w = CW, t = 0.6) => page.drawLine({ start: { x, y: yy }, end: { x: x + w, y: yy }, thickness: t, color });

  function newPage() {
    page = pdf.addPage([W, H]);
    y = TOP;
    if (pdf.getPageCount() > 1) { // running header
      const left = brandName || T(model.formName);
      text(one(left, B, 8, CW / 2 - 8), M, TOP - 8, B, 8, MUTE);
      const right = one(title, F, 8, CW / 2 - 8);
      text(right, M + CW - F.widthOfTextAtSize(right, 8), TOP - 8, F, 8, MUTE);
      rule(TOP - 15);
      y = TOP - 34;
    }
  }
  const room = () => y - BOTTOM;
  const ensure = (h) => { if (h > room() && y < TOP - 40) newPage(); };

  newPage();

  /* ---------- letterhead ---------- */
  const logo = model.brand?.logoKey ? pics.get(model.brand.logoKey) : null;
  if (logo || brandName) {
    let lh = 0, lw = 0;
    if (logo) {
      const s = fitBox(logo.width, logo.height, 170, 52, 0.75);
      lw = s.w; lh = s.h;
      page.drawImage(logo, { x: M, y: TOP - lh, width: lw, height: lh });
    }
    if (brandName) {
      const size = logo ? 13 : 15;
      const x = logo ? M + lw + 14 : M;
      const nm = one(brandName, B, size, CW - (x - M));
      const mid = logo ? TOP - lh / 2 - size * 0.35 : TOP - size;
      text(nm, x, mid, B, size, INK);
      lh = Math.max(lh, logo ? 0 : size + 2);
    }
    y = TOP - lh - 14;
    rule(y, RULE, M, CW, 0.8);
    y -= 28;
  }

  /* ---------- title block ---------- */
  const fname = T(String(model.formName || '').toUpperCase());
  if (fname) { text(one(fname, B, 8.5, CW), M, y, B, 8.5, ACC); y -= 26; }
  wrapText(title, CW, widthOf(B, 20)).forEach((ln, i) => { if (i) y -= 24; text(ln, M, y, B, 20, INK); });
  y -= 18;
  const meta = T((model.meta || []).filter(Boolean).join('   ·   '));
  if (meta) wrapText(meta, CW, widthOf(F, 9)).forEach((ln) => { text(ln, M, y, F, 9, MUTE); y -= 13; });
  if (model.parent) {
    const p = T(model.parent);
    const lab = 'Belongs to  ';
    text(lab, M, y, F, 9, MUTE);
    text(one(p, B, 9, CW - F.widthOfTextAtSize(lab, 9)), M + F.widthOfTextAtSize(lab, 9), y, B, 9, INK);
    y -= 13;
  }
  y -= 14;

  /* ---------- section headings ---------- */
  const SEC = 12.5;
  function heading(label, extra, help) {
    ensure(SEC + 70);
    if (y < TOP - 40) y -= 10;
    const lab = one(label, B, SEC, CW - 60);
    text(lab, M, y, B, SEC, INK);
    if (extra) text(T(extra), M + B.widthOfTextAtSize(lab, SEC) + 8, y, F, 10, MUTE);
    y -= 8;
    page.drawRectangle({ x: M, y: y - 0.4, width: 26, height: 1.6, color: ACC });
    rule(y, RULE, M + 26, CW - 26);
    y -= 18;
    if (help) { wrapText(T(help), CW, widthOf(I, 9)).forEach((ln) => { ensure(12); text(ln, M, y, I, 9, MUTE); y -= 12; }); y -= 6; }
  }

  /* ---------- fields ---------- */
  const LAB = 8.5, LABH = 13, VAL = 10.5, VALH = 14, ROWGAP = 12;
  function star(cx, cy, r, filled) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
      pts.push(`${(Math.cos(a) * rr).toFixed(2)} ${(Math.sin(a) * rr).toFixed(2)}`);
    }
    const path = 'M ' + pts.join(' L ') + ' Z';
    page.drawSvgPath(path, { x: cx, y: cy, color: filled ? ACC : undefined, borderColor: filled ? ACC : MUTE, borderWidth: 0.7 });
  }
  /** a field's height at a width, and how to draw it from its top */
  function cell(it, w) {
    const lab = wrapText(T(it.label), w, widthOf(F, LAB));
    const labH = lab.length * 11 + 2;
    const drawLab = (x, top) => lab.forEach((ln, i) => text(ln, x, top - LAB - i * 11, F, LAB, MUTE));
    const pic = (it.kind === 'image' || it.kind === 'signature') && it.imgKey ? pics.get(it.imgKey) : null;
    if (pic && it.kind === 'image') {
      const s = fitBox(pic.width, pic.height, w, 230, 0.75);
      return { h: labH + 4 + s.h, draw: (x, top) => { drawLab(x, top); page.drawImage(pic, { x, y: top - labH - 4 - s.h, width: s.w, height: s.h }); } };
    }
    if (pic && it.kind === 'signature') {
      const s = fitBox(pic.width, pic.height, Math.min(w, 230), 62, 0.5);
      const lw = Math.max(160, Math.min(w, s.w + 20));
      return { h: labH + 4 + s.h + 6, draw: (x, top) => { drawLab(x, top); const yy = top - labH - 4 - s.h; page.drawImage(pic, { x, y: yy, width: s.w, height: s.h }); rule(yy - 3, MUTE, x, lw, 0.6); } };
    }
    if (it.kind === 'rating' && it.max) {
      return { h: labH + VALH, draw: (x, top) => { drawLab(x, top); for (let i = 0; i < Math.min(it.max, 10); i++) star(x + 6 + i * 14, top - labH - 7, 5.6, i < it.n); } };
    }
    if (it.kind === 'color' && it.hex) {
      return { h: labH + VALH, draw: (x, top) => { drawLab(x, top); page.drawRectangle({ x, y: top - labH - 11, width: 11, height: 11, color: hexRgb(rgb, it.hex, MUTE), borderColor: RULE, borderWidth: 0.5 }); text(T(it.text), x + 16, top - labH - 10, F, VAL, INK); } };
    }
    let val = T(it.text);
    let font = F;
    if ((it.kind === 'image' || it.kind === 'signature') && !pic && it.text) { val = it.kind === 'signature' ? 'Signed (the signature couldn’t be included)' : T(it.text) + ' (the photo couldn’t be included)'; font = I; }
    const lines = val ? wrapText(val, w, widthOf(font, VAL)) : [''];
    return { h: labH + lines.length * VALH, lines, labH, font, drawLab, draw: (x, top) => { drawLab(x, top); lines.forEach((ln, i) => text(ln, x, top - labH - VAL - i * VALH + 1, font, VAL, INK)); } };
  }

  const halfW = (CW - GUTTER) / 2;
  fieldRows(model.items || []).forEach((row) => {
    if (row.heading) { heading(row.heading.label, '', row.heading.help); return; }
    const w = row.cells.length === 2 || row.cells[0].width === 'half' ? halfW : CW;
    const cs = row.cells.map((it) => cell(it, w));
    const h = Math.max(...cs.map((c) => c.h));
    if (cs.length === 1 && cs[0].lines && h > room()) {
      // long text: flow it across pages, keeping the label with its first lines
      const c = cs[0];
      ensure(c.labH + VALH * 2);
      c.drawLab(M, y);
      y -= c.labH;
      c.lines.forEach((ln) => { if (VALH > room()) newPage(); text(ln, M, y - VAL + 1, c.font, VAL, INK); y -= VALH; });
      y -= ROWGAP;
      return;
    }
    ensure(h);
    cs.forEach((c, i) => c.draw(M + i * (halfW + GUTTER), y));
    y -= h + ROWGAP;
  });

  /* ---------- grids, child records, tasks ---------- */
  let backToPortrait = false;
  (model.sections || []).forEach((s) => {
    const cols = s.cols || [];
    const rows = s.rows || [];
    const PX = 5, PY = 4.5;
    const all = rows.concat(s.total ? [s.total] : []).map((r) => r.map((c) => T(c)));
    const plan = planTable(cols.map((c) => ({ label: T(c.label), num: !!c.num })), all, (sz, bold) => widthOf(bold ? B : F, sz),
      { spaces: [{ avail: CW_PORTRAIT }, { avail: CW_LANDSCAPE, landscape: true }], pad: PX * 2 });
    const { size, widths } = plan;
    const lh = size * 1.32;
    if (plan.landscape && rows.length) { shape(true); newPage(); backToPortrait = true; }
    else if (backToPortrait) { shape(false); newPage(); backToPortrait = false; }
    const wrapRow = (r, font) => r.map((c, i) => wrapText(c, Math.max(8, widths[i] - PX * 2), widthOf(font, size)));
    const head = wrapRow(cols.map((c) => T(c.label)), B);
    const headH = Math.max(...head.map((l) => l.length)) * lh + PY * 2;
    const drawRowCells = (lines, font, top, color = INK) => {
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((ln, j) => {
          const tw = font.widthOfTextAtSize(ln, size);
          const tx = cols[i]?.num ? x + widths[i] - PX - tw : x + PX;
          text(ln, tx, top - PY - size * 0.8 - j * lh, font, size, color);
        });
        x += widths[i];
      });
    };
    const drawHead = () => {
      page.drawRectangle({ x: M, y: y - headH, width: CW, height: headH, color: FAINT });
      drawRowCells(head, B, y, MUTE);
      y -= headH;
      rule(y, MUTE, M, CW, 0.6);
    };

    const body = rows.map((r) => wrapRow(r.map((c) => T(c)), F));
    const firstH = body.length ? Math.max(...body[0].map((l) => l.length)) * lh + PY * 2 : 0;
    ensure(SEC + 70 + headH + firstH);
    heading(s.title, s.count != null ? String(s.count) : '', '');
    if (!rows.length) { ensure(14); text(T(s.empty || 'None.'), M, y, I, 9.5, MUTE); y -= 22; return; }
    y += 6;
    drawHead();
    const maxLines = Math.floor((TOP - 34 - BOTTOM - headH - PY * 2) / lh);
    const totLines = s.total ? wrapRow(s.total.map((c) => T(c)), B) : null;
    const totH = totLines ? Math.max(...totLines.map((l) => l.length)) * lh + PY * 2 : 0;
    body.forEach((lines, bi) => {
      lines = lines.map((ls) => (ls.length > maxLines ? ls.slice(0, maxLines - 1).concat(['…']) : ls));
      const h = Math.max(...lines.map((l) => l.length)) * lh + PY * 2;
      if (h + (bi === body.length - 1 ? totH : 0) > room()) { // the total stays with the last row
        newPage();
        text(one(T(s.title) + ' (continued)', B, 9, CW), M, y, B, 9, MUTE);
        y -= 10;
        drawHead();
      }
      drawRowCells(lines, F, y);
      y -= h;
      rule(y);
    });
    if (totLines) {
      rule(y, MUTE, M, CW, 0.8);
      drawRowCells(totLines, B, y);
      y -= totH;
    }
    y -= 20;
  });

  /* ---------- footers (each page its own shape) ---------- */
  const pages = pdf.getPages(), n = pages.length;
  pages.forEach((p, i) => {
    page = p;
    shape(p.getWidth() > p.getHeight());
    rule(M + 14, RULE);
    const stamp = one(model.stamp || '', F, 8, CW - 80);
    text(stamp, M, M + 2, F, 8, MUTE);
    const pn = `Page ${i + 1} of ${n}`;
    text(pn, M + CW - F.widthOfTextAtSize(pn, 8), M + 2, F, 8, MUTE);
  });

  return pdf.save();
}
