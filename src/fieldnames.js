// A field has a caption (label: what people see; several fields may share one) and a system name
// (sysName: unique on its form; what calculations, placeholders, Text view and imports refer to).
// With no system name set, the caption is the system name, as it always was.
// Pure functions (no DOM, no Firebase), unit-tested.

const lc = (s) => String(s ?? '').trim().toLowerCase();

/** A field's system name. */
export const sysOf = (f) => String(f?.sysName || '').trim() || String(f?.label || '').trim();

/**
 * The field a name refers to: by system name, then by ID, then by caption when only one field has
 * that caption (older calculations and templates written with a caption keep working).
 */
export function fieldByName(form, name) {
  const n = lc(name);
  const fs = (form?.fields || []).filter((f) => f.type !== 'heading');
  return fs.find((f) => lc(sysOf(f)) === n) || fs.find((f) => f.id === name) || (() => { const c = fs.filter((f) => lc(f.label) === n); return c.length === 1 ? c[0] : undefined; })();
}

/** Captions used by more than one field (lower case). */
export function sharedCaptions(fields) {
  const n = new Map();
  (fields || []).forEach((f) => { if (f.type !== 'heading') n.set(lc(f.label), (n.get(lc(f.label)) || 0) + 1); });
  return new Set([...n].filter(([, c]) => c > 1).map(([k]) => k));
}

/** How a field is named where it sits beside others (pickers, columns): "Name (Contact details)" when its caption is shared. */
export function shownName(form, f) {
  const label = String(f?.label || 'Untitled field');
  if (!sharedCaptions(form?.fields).has(lc(label))) return label;
  let h = null;
  for (const x of form.fields || []) { if (x.type === 'heading') h = x; if (x.id === f.id) break; }
  const sys = sysOf(f);
  const why = lc(sys) !== lc(label) ? sys : h ? h.label : '';
  return why ? `${label} (${why})` : label;
}

/**
 * Give every field a unique system name: a field whose system name is already taken gets "Caption 2",
 * "Caption 3"… → { fields, given: [{ id, label, sysName }] }. Headings don't take part.
 */
export function uniqueSysNames(fields) {
  const taken = new Set((fields || []).filter((f) => f.type !== 'heading').map((f) => lc(sysOf(f))));
  const seen = new Set();
  const given = [];
  const out = (fields || []).map((f) => {
    if (f.type === 'heading') return f;
    let s = sysOf(f);
    if (!seen.has(lc(s))) { seen.add(lc(s)); return f; }
    const base = String(f.label || 'Field').trim() || 'Field';
    let i = 2; while (taken.has(lc(`${base} ${i}`))) i++;
    s = `${base} ${i}`; taken.add(lc(s)); seen.add(lc(s));
    given.push({ id: f.id, label: f.label, sysName: s });
    return { ...f, sysName: s };
  });
  return { fields: out, given };
}

/** Replace {Old} with {New} in a calculation or template (any case, spaces allowed inside the braces). */
export function renameRefs(text, renames) {
  if (!renames.length) return text;
  const m = new Map(renames.map(([o, n]) => [lc(o), n]));
  return String(text ?? '').replace(/\{([^{}]*)\}/g, (all, n) => (m.has(lc(n)) ? '{' + m.get(lc(n)) + '}' : all));
}
