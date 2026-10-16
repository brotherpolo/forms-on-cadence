// "Placeholders for <form>": a Word file listing every placeholder a template for that form can
// use (its fields, its parent's, linked records', grids and child forms with ready-to-copy
// repeats and totals, conditions from its real fields, and what every record has). Built in the
// browser from the form as it is now. Pure (no DOM, no Firebase), unit-tested: uploading the
// result back as a template recognises everything in it.
import { zip } from './xlsx.js';
import { encodeText as T } from './docxxml.js';
import { sysOf, fieldByName } from './fieldnames.js';

const NUM = new Set(['number', 'decimal', 'currency', 'percent', 'range', 'rating']);
const isNum = (f) => NUM.has(f.type) || (f.type === 'formula' && ['number', 'currency', 'percent', 'days', 'hours'].includes(f.format));
const usable = (form) => (form?.fields || []).filter((f) => f.type !== 'heading');

/* ---------- what a template for a form may use (for checking one) ---------- */
const norm = (s) => String(s || '').trim().toLowerCase();
const sing = (s) => norm(s).replace(/s$/, '');
const SYS = new Set(['today', 'now', 'exported by', 'owner', 'created by', 'created', 'last updated', 'item name', 'form name', 'stage', 'company name', 'title']);
const splitName = (name) => { const i = String(name).indexOf(':'); return i > 0 ? [name.slice(0, i).trim(), name.slice(i + 1).trim()] : null; };
/**
 * A form's names for checkDocx: has(name), list(name), formula(expr), image(name).
 * ctx: { formById, parentsOf(formId), itemName(form), checkExpr(form, expr) → error|null }
 */
export function formSchema(form, ctx, depth = 0) {
  const match = (f, name) => norm(name) === 'parent' || norm(f.name) === norm(name) || sing(f.name) === sing(name) || norm(ctx.itemName(f)) === norm(name);
  const linked = (pre) => {
    if (depth > 4) return null;
    const rf = fieldByName(form, pre);
    if (rf && rf.type === 'relation') { const lf = ctx.formById(rf.relForm); return lf ? formSchema(lf, ctx, depth + 1) : null; }
    const pf = ctx.parentsOf(form.id).find((f) => match(f, pre));
    return pf ? formSchema(pf, ctx, depth + 1) : null;
  };
  const child = (name) => (form.children || []).map((c) => ctx.formById(c.formId)).find((cf) => cf && (norm(cf.name) === norm(name) || sing(cf.name) === sing(name) || norm(ctx.itemName(cf)) === norm(name)));
  return {
    has(name) {
      const f = fieldByName(form, name);
      if (f && f.type !== 'heading') return true;
      const sp = splitName(name);
      if (sp) { const sc = linked(sp[0]); return !!sc && sc.has(sp[1]); }
      return SYS.has(norm(name));
    },
    list(name) { const cf = child(name); return cf ? formSchema(cf, ctx, depth + 1) : null; },
    formula(expr) { return ctx.checkExpr(form, expr); },
    image(name) {
      const f = fieldByName(form, name);
      if (f) return ['image', 'signature', 'file'].includes(f.type);
      const sp = splitName(name);
      if (sp) { const sc = linked(sp[0]); return !!sc && sc.image(sp[1]); }
      return norm(name) === 'logo';
    },
  };
}
/** A field name as a condition can read it: in [brackets] when it has words or signs conditions use. */
export const condName = (f) => { const n = sysOf(f); return /\b(and|or|not|contains)\b|[()"“”<>=!≠≥≤[\]]/i.test(n) ? `[${n}]` : n; };

/** The placeholder and a short note for one field. prefix: "Client: " for a parent's field. */
export function fieldLine(f, prefix = '', ctx = {}) {
  const n = prefix + sysOf(f);
  switch (f.type) {
    case 'date': return { ph: `{${n}|long}`, note: prefix ? '' : 'or |short, or a pattern like |"MMM d, yyyy"' };
    case 'datetime': return { ph: `{${n}|long}` };
    case 'checkbox': return { ph: `{${n}|Yes/No}`, note: prefix ? '' : 'on its own: ✓ when ticked' };
    case 'multiselect': return { ph: `{${n}|bullets}`, note: 'several choices: a bulleted list' };
    case 'textarea': return { ph: `{${n}}`, note: f.plain ? 'long text' : 'long text: put it on a line of its own to keep its formatting' };
    case 'image': return { ph: `{%${n}|width=8cm}`, note: 'a picture' };
    case 'signature': return { ph: `{%${n}|height=2cm}`, note: 'a signature' };
    case 'file': return { ph: `{${n}}`, note: 'a file: gives its name' };
    case 'formula': return { ph: `{${n}}`, note: 'calculated' };
    case 'rating': return { ph: `{${n}}`, note: 'shown as stars' };
    case 'relation': { const lf = ctx.formById?.(f.relForm); return { ph: `{${n}}`, note: lf ? `a link: the ${ctx.itemName(lf).toLowerCase()}’s name` : 'a link' }; }
    default: return { ph: `{${n}}` };
  }
}

/** Rows for a form's fields, with its section headings as sub-rows. */
function fieldRows(form, prefix, ctx) {
  const rows = [];
  for (const f of form.fields || []) {
    if (f.type === 'heading') { if (f.label) rows.push({ sub: f.label }); continue; }
    const l = fieldLine(f, prefix, ctx);
    rows.push({ label: f.label || sysOf(f), ph: l.ph, note: l.note || '' });
    if (f.type === 'relation' && !prefix) {
      const lf = ctx.formById(f.relForm);
      const g = lf && usable(lf).find((x) => x.type !== 'relation' && x.id !== lf.titleField) || (lf && usable(lf)[0]);
      if (g) rows.push({ label: `… the ${ctx.itemName(lf).toLowerCase()}’s ${g.label}`, ph: fieldLine(g, sysOf(f) + ': ', ctx).ph.replace(/^\{%/, '{%'), note: `any ${lf.name} field works this way` });
    }
  }
  return rows;
}

/**
 * What goes in the file. ctx: { formById, parentsOf(formId), itemName(form), wfOn(form), gridCols(rel, cf), now: Date }
 * → { title, intro, sections: [{ title, note, rows?, grid?, each?, lines? }] }
 */
export function placeholderModel(form, ctx) {
  const item = ctx.itemName(form);
  const sections = [];
  sections.push({ title: `This ${item.toLowerCase()}`, rows: fieldRows(form, '', ctx) });
  for (const pf of ctx.parentsOf(form.id)) {
    const pi = ctx.itemName(pf);
    sections.push({ title: `The ${pi.toLowerCase()} it belongs to`, note: `Fields of the ${pf.name} record this ${item.toLowerCase()} belongs to.`, rows: fieldRows(pf, pi + ': ', ctx) });
  }
  for (const rel of form.children || []) {
    const cf = ctx.formById(rel.formId);
    if (!cf || cf.id === form.id) continue;
    const ci = ctx.itemName(cf).toLowerCase();
    const nums = usable(cf).filter(isNum);
    const totals = [{ label: `Number of ${cf.name.toLowerCase()}`, ph: `{= CHILDCOUNT("${cf.name}")}` },
      ...nums.map((f) => ({ label: `Total ${f.label}`, ph: `{= CHILDSUM("${cf.name}", "${sysOf(f)}")${f.type === 'currency' || f.format === 'currency' ? '|currency' : ''}}` }))];
    if (rel.display === 'grid') {
      const cols = (ctx.gridCols ? ctx.gridCols(rel, cf) : usable(cf)).filter((f) => !['textarea', 'image', 'signature', 'file'].includes(f.type)).slice(0, 5);
      sections.push({ title: `${cf.name} (grid)`, note: `A table that repeats a row per ${ci}. Copy the whole table; add or remove columns as you like.`, grid: { name: cf.name, cols: cols.map((f) => ({ label: f.label, ph: fieldLine(f, '', ctx).ph.replace(/^\{%/, '{%') })) }, each: { name: cf.name, rows: fieldRows(cf, '', ctx) }, rows: [{ sub: 'Totals (anywhere in the document)' }, ...totals] });
    } else {
      const first = usable(cf).slice(0, 2).map((f) => fieldLine(f, '', ctx).ph);
      sections.push({ title: `${cf.name} (child records)`, note: `One paragraph per ${ci}. Copy these three lines; the first and last disappear in the document.`, lines: [`{#each ${cf.name}}`, first.join(', ') || '…', '{/each}'], each: { name: cf.name, rows: fieldRows(cf, '', ctx) }, rows: [{ sub: 'Totals (anywhere in the document)' }, ...totals] });
    }
  }
  // conditions from this form's real fields
  const conds = [];
  const sel = usable(form).find((f) => (f.type === 'select' || f.type === 'radio') && (f.options || []).length);
  if (sel) {
    const opts = sel.options.map(String);
    conds.push({ label: 'Only for one choice', ph: `{#if ${condName(sel)} = "${opts[Math.min(1, opts.length - 1)]}"} … {/if}`, note: `${sel.label}’s choices: ${opts.slice(0, 8).join(', ')}${opts.length > 8 ? '…' : ''}` });
    conds.push({ label: 'One or the other', ph: `{#if ${condName(sel)} = "${opts[opts.length - 1]}"} … {#else} … {/if}` });
  }
  const num = usable(form).find(isNum);
  if (num) conds.push({ label: 'A number', ph: `{#if ${condName(num)} > 1000} … {/if}` });
  const box = usable(form).find((f) => f.type === 'checkbox');
  if (box) conds.push({ label: 'When ticked', ph: `{#if ${condName(box)}} … {/if}` });
  const filled = usable(form).find((f) => ['textarea', 'text'].includes(f.type) && f.id !== form.titleField) || usable(form).find((f) => f.type === 'text');
  if (filled) conds.push({ label: 'Only when filled in', ph: `{#if ${condName(filled)}} … {/if}` });
  for (const rel of form.children || []) {
    const cf = ctx.formById(rel.formId);
    if (!cf) continue;
    const cb = usable(cf).find((f) => f.type === 'checkbox'), cn = usable(cf).find(isNum);
    if (cb) conds.push({ label: `Only some ${cf.name.toLowerCase()}`, ph: `{#each ${cf.name}|where ${condName(cb)}} … {/each}` });
    else if (cn) conds.push({ label: `Only some ${cf.name.toLowerCase()}`, ph: `{#each ${cf.name}|where ${condName(cn)} > 0} … {/each}` });
    const sk = usable(cf).find((f) => f.type === 'date' || f.type === 'datetime') || cn;
    if (sk) conds.push({ label: 'In another order', ph: `{#each ${cf.name}|sort ${sysOf(sk)} desc} … {/each}` });
  }
  if (conds.length) sections.push({ title: 'Show or hide parts', note: 'Put each end on a line of its own to show or hide whole paragraphs, or keep both ends in one sentence.', rows: conds });
  const has = (n) => usable(form).some((f) => sysOf(f).toLowerCase() === n);
  const every = [['Today', '{Today|long}'], ['Exported by', '{Exported by}'], ['Owner', '{Owner}'], ['Created', '{Created|short}'], ['Created by', '{Created by}'], ['Last updated', '{Last updated|short}'],
    ['Title', '{Title}', 'what the record list shows'], ['Item name', '{Item name}', `“${item}”`], ['Form name', '{Form name}'],
    ...(ctx.wfOn(form) ? [['Workflow stage', '{Stage}']] : []), ['Company name', '{Company name}', 'from PDF exports'], ['Company logo', '{%Logo|height=1.5cm}']]
    .filter(([, ph]) => !has(ph.replace(/^\{%?|[|}].*$/g, '').toLowerCase())) // a field with the same name wins
    .map(([label, ph, note]) => ({ label, ph, note: note || '' }));
  sections.push({ title: 'Every record', rows: every });
  const d = ctx.now || new Date();
  return {
    title: `Placeholders for ${form.name || 'this form'}`,
    intro: `Made by Formwright on ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} from the ${form.name || ''} form as it is now. Copy any placeholder (the blue text) into your own Word document. Everything here is recognised when you add a template to ${form.name || 'this form'}. Options after the bar are suggestions; the sample template lists them all.`,
    sections,
  };
}

/* ---------- writing the Word file ---------- */
const ACC = '3346C8', MUTED = '5A6174', LINE = 'D6D9E3', SOFT = 'EEF0FD', GREY = 'F3F4F7';
const run = (text, o = {}) => {
  if (!text) return '';
  const pr = [o.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : '', o.bold ? '<w:b/>' : '', o.italic ? '<w:i/>' : '', `<w:color w:val="${o.code ? ACC : o.color || '141826'}"/>`, `<w:sz w:val="${o.size || (o.code ? 19 : 20)}"/>`].join('');
  return `<w:r><w:rPr>${pr}</w:rPr><w:t xml:space="preserve">${T(text)}</w:t></w:r>`;
};
const para = (runs, o = {}) => `<w:p><w:pPr>${o.keep ? '<w:keepNext/>' : ''}<w:spacing w:before="${o.before || 0}" w:after="${o.after ?? 100}"/></w:pPr>${runs}</w:p>`;
const borders = `<w:tcBorders>${['top', 'left', 'bottom', 'right'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="${LINE}"/>`).join('')}</w:tcBorders>`;
const cell = (w, content, o = {}) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ''}${borders}${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}</w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>${content}</w:p></w:tc>`;
const table = (widths, rows) => `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="110" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;
const W = 9360, C = [3000, 6360];
const head = (cols, widths) => `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cols.map((c, i) => cell(widths[i], run(c, { bold: true }), { fill: SOFT })).join('')}</w:tr>`;
function rowsTable(rows) {
  return table(C, [head(['Field', 'Placeholder'], C), ...rows.map((r) => (r.sub
    ? `<w:tr>${cell(W, run(r.sub, { bold: true, color: MUTED, size: 18 }), { span: 2, fill: GREY })}</w:tr>`
    : `<w:tr>${cell(C[0], run(r.label))}${cell(C[1], run(r.ph, { code: true }) + (r.note ? run('  ' + r.note, { italic: true, color: MUTED, size: 17 }) : ''))}</w:tr>`))]);
}

/** The model as a .docx (bytes). */
export async function placeholderDocx(model) {
  const body = [];
  body.push(para(run(model.title, { bold: true, size: 40, color: '1F3A8A' }), { after: 80 }));
  body.push(para(run(model.intro, { color: MUTED, size: 19 }), { after: 160 }));
  for (const s of model.sections) {
    body.push(para(run(s.title, { bold: true, size: 28 }), { before: 300, after: 80, keep: true }));
    if (s.note) body.push(para(run(s.note, { color: MUTED, size: 19 }), { keep: true }));
    if (s.grid) {
      const n = Math.max(1, s.grid.cols.length);
      const w = Array.from({ length: n }, () => Math.floor(W / n));
      w[n - 1] += W - w.reduce((a, b) => a + b, 0);
      const cells = s.grid.cols.length ? s.grid.cols : [{ label: 'Row', ph: '…' }];
      body.push(table(w, [head(cells.map((c) => c.label), w), `<w:tr>${cells.map((c, i) => cell(w[i], run((i === 0 ? `{#each ${s.grid.name}}` : '') + c.ph + (i === n - 1 ? '{/each}' : ''), { code: true }))).join('')}</w:tr>`]));
      body.push(para('', { after: 60 }));
    }
    if (s.lines) s.lines.forEach((l) => body.push(para(run(l, { code: true }), { after: 40 })));
    if (s.each) {
      // the fields of each row, inside a repeat of their own so they're recognised where they are
      body.push(para(run(`Every field of one ${s.each.name.toLowerCase()} (these work between the two lines around this table):`, { color: MUTED, size: 19 }), { before: 120, keep: true }));
      body.push(para(run(`{#each ${s.each.name}}`, { code: true }), { after: 40, keep: true }));
      body.push(rowsTable(s.each.rows));
      body.push(para(run('{/each}', { code: true }), { before: 40 }));
    }
    if (s.rows && s.rows.length) body.push(rowsTable(s.rows));
  }
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1300" w:right="1440" w:bottom="1300" w:left="1440" w:header="600" w:footer="600" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
  const enc = (s) => new TextEncoder().encode(s);
  return zip([
    { name: '[Content_Types].xml', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>') },
    { name: '_rels/.rels', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/_rels/document.xml.rels', data: enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>') },
    { name: 'word/document.xml', data: enc(doc) },
    { name: 'word/styles.xml', data: enc(styles) },
  ]);
}
