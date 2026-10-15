// Administration → PDF exports: the company name and logo printed at the top of every
// record exported as a PDF. Stored in settings/exports (admins write, everyone with access reads).

import { getExportSettings, saveExportSettings } from './store.js';
import { renderMain } from './app.js';
import { esc, toast } from './ui.js';
import { trimBox, fitBox } from './pdfdoc.js';

let ex = null; // { name, logo, dirty, busy, loading }
const MAX_W = 600, MAX_H = 240, MAX_CHARS = 600000;

export const isDirty = () => !!ex?.dirty;
export function leave() { ex = null; }

function load() {
  ex = { name: '', logo: null, dirty: false, busy: false, loading: true };
  getExportSettings(true).then((s) => {
    if (!ex || ex.dirty) return;
    Object.assign(ex, { name: s.companyName || '', logo: s.logo || null, loading: false });
    renderMain();
  });
}

export function viewExports() {
  if (!ex) load();
  if (ex.loading) return `<div class="head"><div class="ttl"><div><h1>PDF exports</h1></div></div></div><div class="panel"><p class="note">Loading…</p></div>`;
  return `
  <div class="head"><div class="ttl"><div><h1>PDF exports</h1><p class="sub">The company name and logo at the top of every record someone exports as a PDF (<b>Export PDF</b> on a record).</p></div></div></div>
  <div class="panel exset">
    <label class="flabel" for="ex-name">Company name</label>
    <input class="in" id="ex-name" data-ex="name" maxlength="120" autocomplete="organization" value="${esc(ex.name)}" placeholder="Your company">
    <div class="flabel" style="margin-top:16px">Logo</div>
    <div class="ex-logo">
      ${ex.logo ? `<img src="${esc(ex.logo)}" alt="Your logo">` : '<span class="note">No logo</span>'}
      <label class="btn sm">${ex.logo ? 'Replace logo' : 'Choose logo'}<input type="file" data-ex="logo" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden></label>
      ${ex.logo ? '<button type="button" class="btn sm ghost" data-act="ex-logo-clear">Remove</button>' : ''}
    </div>
    <p class="help">PNG, JPG or SVG. Empty space around it is trimmed, and it's resized to fit. A logo on a transparent or white background looks best.</p>
    <div class="flabel" style="margin-top:16px">How the top of a PDF looks</div>
    <div class="ex-prev" aria-hidden="true">
      <div class="ex-lh">${ex.logo ? `<img src="${esc(ex.logo)}" alt="">` : ''}${ex.name.trim() ? `<b>${esc(ex.name.trim())}</b>` : ''}${!ex.logo && !ex.name.trim() ? '<span class="note">Nothing yet: PDFs start with the form and record names.</span>' : ''}</div>
      <div class="ex-ttl"><small>FORM NAME</small><b>Record title</b></div>
    </div>
    <div class="actions" style="margin-top:16px"><span class="grow note" role="status">${ex.dirty ? 'Unsaved changes' : ''}</span><button type="button" class="btn primary" data-act="ex-save"${ex.busy || !ex.dirty ? ' disabled' : ''}>${ex.busy ? 'Saving…' : 'Save'}</button></div>
  </div>`;
}

export async function onClick(a) {
  if (!ex) return false;
  if (a === 'ex-logo-clear') { ex.logo = null; ex.dirty = true; renderMain(); return true; }
  if (a === 'ex-save') {
    if (ex.busy || !ex.dirty) return true;
    ex.busy = true; renderMain();
    try {
      await saveExportSettings({ companyName: ex.name, logo: ex.logo });
      ex.dirty = false;
      toast('Saved. New PDFs use it straight away.');
    } catch (e) {
      console.error('[formwright] export settings', e);
      toast(e?.code === 'permission-denied' ? 'Couldn’t save: the database rules need updating (see the install steps).' : 'Couldn’t save. Try again.');
    }
    ex.busy = false; renderMain();
    return true;
  }
  return false;
}

export function onInput(t) {
  if (t.dataset.ex !== 'name' || !ex) return false;
  ex.name = t.value; ex.dirty = true;
  const s = document.querySelector('[data-act="ex-save"]'); if (s) s.disabled = false;
  const st = document.querySelector('.exset [role="status"]'); if (st) st.textContent = 'Unsaved changes';
  const lh = document.querySelector('.ex-lh');
  if (lh) lh.innerHTML = `${ex.logo ? `<img src="${esc(ex.logo)}" alt="">` : ''}${ex.name.trim() ? `<b>${esc(ex.name.trim())}</b>` : ''}`;
  return true;
}

export async function onChange(t) {
  if (t.dataset.ex !== 'logo' || !ex) return false;
  const file = t.files && t.files[0];
  if (!file) return true;
  try {
    ex.logo = await logoData(file);
    ex.dirty = true;
  } catch (e) {
    console.error('[formwright] logo', e);
    toast('That picture couldn’t be read. Try a PNG or JPG.');
  }
  renderMain();
  return true;
}

/** A logo as a small data URL: borders trimmed, at most 600 × 240, PNG if it has see-through parts. */
async function logoData(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    let w = img.naturalWidth || 600, h = img.naturalHeight || 240;
    if (/svg/.test(file.type)) { const s = Math.max(1, 1200 / Math.max(w, h)); w *= s; h *= s; } // draw SVGs large, then trim
    const c = document.createElement('canvas');
    c.width = Math.round(w); c.height = Math.round(h);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, c.width, c.height);
    const px = g.getImageData(0, 0, c.width, c.height);
    const box = trimBox(px.data, c.width, c.height);
    let alpha = false;
    for (let i = 3; i < px.data.length; i += 4) if (px.data[i] < 250) { alpha = true; break; }
    for (let scale = 1; scale > 0.2; scale *= 0.75) {
      const fit = fitBox(box.w, box.h, MAX_W * scale, MAX_H * scale);
      const o = document.createElement('canvas');
      o.width = Math.max(1, Math.round(fit.w)); o.height = Math.max(1, Math.round(fit.h));
      const og = o.getContext('2d');
      if (!alpha) { og.fillStyle = '#fff'; og.fillRect(0, 0, o.width, o.height); }
      og.imageSmoothingQuality = 'high';
      og.drawImage(c, box.x, box.y, box.w, box.h, 0, 0, o.width, o.height);
      const data = alpha ? o.toDataURL('image/png') : o.toDataURL('image/jpeg', 0.9);
      if (data.length <= MAX_CHARS) return data;
    }
    throw new Error('logo too large');
  } finally {
    URL.revokeObjectURL(url);
  }
}
