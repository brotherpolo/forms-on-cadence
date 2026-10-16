// Form designer canvas: field type colours, sections and folding. Pure functions (no DOM), unit-tested.

/** Each category's hue and saturation; types in a category are shades of it. */
export const CATEGORY_HUES = {
  'Text': [222, 22], 'Contact': [184, 78], 'Numbers': [28, 88], 'Date & time': [272, 52],
  'Choices': [146, 55], 'Media': [332, 62], 'Relations': [204, 72],
};
const hsl = (h, s, l) => `hsl(${h} ${Math.round(s)}% ${Math.round(l * 10) / 10}%)`;

/**
 * types: [[id, label, glyph, category], …] in palette order.
 * → { [id]: { light: {fg, bg, ring}, dark: {fg, bg, ring}, style } } — style sets the CSS variables
 * the glyph uses (light and dark both, so a theme switch needs no re-render). A category's first
 * type is its deepest shade, its last the lightest. Section headings aren't coloured here.
 */
export function typeColors(types) {
  const out = {};
  const byCat = new Map();
  types.forEach((t) => { if (CATEGORY_HUES[t[3]]) { if (!byCat.has(t[3])) byCat.set(t[3], []); byCat.get(t[3]).push(t[0]); } });
  byCat.forEach((ids, cat) => {
    const [h, s] = CATEGORY_HUES[cat];
    ids.forEach((id, i) => {
      const k = ids.length > 1 ? i / (ids.length - 1) : 0.5;
      const light = { fg: hsl(h, s, 26 + k * 16), bg: hsl(h, Math.min(100, s + 10), 86 + k * 9), ring: hsl(h, s, 78 + k * 9) };
      const dark = { fg: hsl(h, Math.min(90, s + 10), 82 - k * 18), bg: hsl(h, s * 0.55, 20 + k * 10), ring: hsl(h, s * 0.55, 28 + k * 10) };
      out[id] = { cat, light, dark, style: `--gl:${light.fg};--glb:${light.bg};--glr:${light.ring};--gd:${dark.fg};--gdb:${dark.bg};--gdr:${dark.ring}` };
    });
  });
  return out;
}
/** A category's colour for its heading in the palette: its middle shade. */
export function categoryStyle(types, colors, cat) {
  const ids = types.filter((t) => t[3] === cat).map((t) => t[0]);
  const mid = colors[ids[Math.floor((ids.length - 1) / 2)]];
  return mid ? `--gl:${mid.light.fg};--gd:${mid.dark.fg}` : '';
}

/**
 * The canvas, row by row: [{ field, section (its heading's id, or null before the first),
 * hidden (inside a folded section), count (a heading's number of fields), last (last in its section) }]
 */
export function canvasRows(fields, folded = new Set()) {
  const rows = [];
  let sec = null, head = null;
  (fields || []).forEach((f) => {
    if (f.type === 'heading') {
      sec = f.id;
      head = { field: f, section: null, hidden: false, count: 0, folded: folded.has(f.id), kids: [] };
      rows.push(head);
      return;
    }
    const r = { field: f, section: sec, hidden: !!(head && head.folded), last: false };
    if (head) { head.count++; head.kids.push(f); }
    rows.push(r);
  });
  rows.forEach((r, i) => { if (r.section && !(rows[i + 1] && rows[i + 1].section === r.section)) r.last = true; });
  return rows;
}

/** A field and, for a folded section's heading, everything in its section: the ids that move together. */
export function blockOf(fields, id, folded = new Set()) {
  const i = (fields || []).findIndex((f) => f.id === id);
  if (i < 0) return [];
  if (fields[i].type !== 'heading' || !folded.has(id)) return [id];
  const ids = [id];
  for (let j = i + 1; j < fields.length && fields[j].type !== 'heading'; j++) ids.push(fields[j].id);
  return ids;
}

/** Move these fields (in their order) to just before `beforeId` (null: the end). → new list, or null when nothing moved. */
export function moveBefore(fields, ids, beforeId) {
  const set = new Set(ids);
  if (beforeId && set.has(beforeId)) return null;
  const moving = fields.filter((f) => set.has(f.id));
  const rest = fields.filter((f) => !set.has(f.id));
  const at = beforeId ? rest.findIndex((f) => f.id === beforeId) : rest.length;
  const next = [...rest.slice(0, at < 0 ? rest.length : at), ...moving, ...rest.slice(at < 0 ? rest.length : at)];
  return next.every((f, k) => f === fields[k]) ? null : next;
}

/**
 * Keyboard: move a visible row one place up or down among the visible rows (a folded section
 * counts as one place; moving down past it puts the field at the end of that section).
 * visibleIds: the rows shown, in order. → the id to move before (null: the end), or undefined: can't move.
 */
export function stepTarget(visibleIds, id, dir) {
  const p = visibleIds.indexOf(id);
  if (p < 0) return undefined;
  if (dir < 0) return p === 0 ? undefined : visibleIds[p - 1];
  if (p === visibleIds.length - 1) return undefined;
  return visibleIds[p + 2] ?? null;
}

/** The heading whose section holds this field (null when it's before the first section). */
export function sectionOf(fields, id) {
  let sec = null;
  for (const f of fields || []) { if (f.type === 'heading') sec = f.id; if (f.id === id) return f.type === 'heading' ? null : sec; }
  return null;
}

/** A folded section is dropped whole between sections: a drop inside another section lands at that section's end. */
export function snapBefore(fields, beforeId) {
  if (beforeId == null) return null;
  const i = (fields || []).findIndex((f) => f.id === beforeId);
  if (i < 0) return null;
  for (let j = i; j < fields.length; j++) if (fields[j].type === 'heading') return fields[j].id;
  return null;
}
/** Arrow keys on a folded section: past the whole next (or previous) section. → id to move before, null (the end), or undefined. */
export function sectionStep(fields, id, dir) {
  const heads = (fields || []).filter((f) => f.type === 'heading').map((f) => f.id);
  const k = heads.indexOf(id);
  if (k < 0) return undefined;
  if (dir < 0) return k === 0 ? undefined : heads[k - 1];
  if (k === heads.length - 1) return undefined;
  return heads[k + 2] ?? null;
}
