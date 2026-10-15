// Email PDF: the template, the addresses to suggest, and checking typed addresses.
// Pure functions: no DOM, no Firebase. app.js passes in its lookups and formatting.

export const DEFAULT_SUBJECT = '{Item} {Title} from {Company}';
export const DEFAULT_MESSAGE = 'Hello,\n\nPlease find {item} {Title} attached.\n\nThank you,\n{Sender}\n{Company}';

const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]{2,}$/;
export const isEmail = (s) => EMAIL.test(String(s || '').trim());

/** Typed addresses (commas, semicolons, spaces or new lines between them) → { ok, bad }. */
export function parseEmails(text) {
  const ok = [], bad = [];
  String(text || '').split(/[\s,;]+/).map((x) => x.trim().replace(/^<|>$/g, '')).filter(Boolean).forEach((x) => {
    const e = x.toLowerCase();
    if (!isEmail(e)) bad.push(x);
    else if (!ok.includes(e)) ok.push(e);
  });
  return { ok, bad };
}

/**
 * Fill {placeholders}: any field on the form by its label ({Invoice #}, {Total}), plus
 * {Title}, {Form}, {Item} / {item} (what one record is called), {Company}, {Sender}, {Date}.
 * ctx: { field(label) → text | undefined, title, form, item, company, sender, date }
 * Unknown names are left as they are, so a typo shows up in the preview.
 */
export function fillTemplate(tpl, ctx) {
  const special = {
    title: ctx.title, form: ctx.form, company: ctx.company, sender: ctx.sender, date: ctx.date,
  };
  return String(tpl ?? '').replace(/\{([^{}\n]{1,80})\}/g, (m, name) => {
    const n = name.trim();
    if (n === 'Item') return ctx.item || '';
    if (n === 'item') return String(ctx.item || '').toLowerCase();
    const f = ctx.field ? ctx.field(n) : undefined;
    if (f !== undefined) return f;
    const k = n.toLowerCase();
    if (k in special) return special[k] ?? '';
    return m;
  }).replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ');
}

/**
 * Email addresses to offer: Email fields on the record, the records it belongs to (parent,
 * grandparent), records it links to, and the children of it and its parent (a client's
 * contacts, say). → [{ email, who, where }], the record's own first, no repeats, at most 12.
 * h: { formById, recById, records, recTitle(rec, form) }
 */
export function emailSuggestions(rec, h) {
  const out = [], seen = new Set(), visited = new Set();
  const add = (r, why) => {
    if (!r || visited.has(r.id)) return;
    visited.add(r.id);
    const form = h.formById(r.formId);
    (form?.fields || []).filter((f) => f.type === 'email').forEach((f) => {
      const e = String(r.values?.[f.id] || '').trim().toLowerCase();
      if (!isEmail(e) || seen.has(e)) return;
      seen.add(e);
      out.push({ email: e, who: h.recTitle(r, form), where: `${why}${form ? ' · ' + (f.label || 'Email') : ''}` });
    });
  };
  const formName = (r) => h.formById(r.formId)?.name || 'Record';
  add(rec, 'This record');
  const parent = rec.parentId ? h.recById(rec.parentId) : null;
  const linked = (r) => (h.formById(r.formId)?.fields || []).filter((f) => f.type === 'relation').map((f) => h.recById(r.values?.[f.id])).filter(Boolean);
  linked(rec).forEach((r) => add(r, formName(r)));
  if (parent) {
    add(parent, formName(parent));
    const gp = parent.parentId ? h.recById(parent.parentId) : null;
    if (gp) add(gp, formName(gp));
  }
  h.records.filter((r) => r.parentId === rec.id).forEach((r) => add(r, formName(r)));
  if (parent) h.records.filter((r) => r.parentId === parent.id && r.id !== rec.id).forEach((r) => add(r, formName(r)));
  return out.slice(0, 12);
}
