// Export PDF: gathers the pictures a record's PDF needs, draws it (pdfdraw.js, with pdf-lib
// loaded only now) and downloads it. app.js builds the model from the record.

import { getExportSettings, fileBlob } from './store.js';
import { fileName } from './pdfdoc.js';

// pdf-lib is served as a plain file from public/vendor, so the build leaves it alone
const PDF_LIB = '/vendor/pdf-lib.min.js';
const MAX_PX = 1600; // photos are scaled down to this, which keeps PDFs small and still sharp

const isPng = (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpg = (b) => b[0] === 0xff && b[1] === 0xd8;

export function dataUrlBytes(s) {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(s || ''));
  if (!m) return null;
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A photo as a JPEG the PDF can hold: turned upright and scaled down. Anything the browser can show works. */
export async function photoBytes(blob) {
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const s = Math.min(1, MAX_PX / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    return { bytes: new Uint8Array(await out.arrayBuffer()), type: 'jpg' };
  } catch (e) {
    const b = new Uint8Array(await blob.arrayBuffer()); // the browser couldn't redraw it: use it as it is if the PDF can
    if (isJpg(b)) return { bytes: b, type: 'jpg' };
    if (isPng(b)) return { bytes: b, type: 'png' };
    throw e;
  }
}

/**
 * Make the PDF: → { bytes, name, missing }. (Export PDF downloads it; Email PDF sends it.)
 * model: as pdfdraw.js describes, except image and signature items keep `src` (a data URL,
 * or { path, url } of an upload) and brand comes from Administration → PDF exports.
 * Returns { name, missing } — missing = pictures that couldn't be included.
 */
export async function makeRecordPdf(model) {
  const [L, { drawPdf }, brand] = await Promise.all([import(/* @vite-ignore */ PDF_LIB), import('./pdfdraw.js'), getExportSettings()]);
  const imgs = new Map();
  let missing = 0;
  const logo = dataUrlBytes(brand.logo);
  if (logo) imgs.set('logo', { bytes: logo, type: isPng(logo) ? 'png' : 'jpg' });
  model.brand = { name: brand.companyName || '', logoKey: logo ? 'logo' : '' };

  await Promise.all((model.items || []).map(async (it, i) => {
    if ((it.kind !== 'image' && it.kind !== 'signature') || !it.src) return;
    const key = 'i' + i;
    try {
      if (typeof it.src === 'string') {
        const b = dataUrlBytes(it.src);
        if (!b) throw new Error('not a picture');
        imgs.set(key, it.kind === 'signature' && isPng(b) ? { bytes: b, type: 'png' } : await photoBytes(new Blob([b])));
      } else {
        imgs.set(key, await photoBytes(await fileBlob(it.src)));
      }
      it.imgKey = key;
    } catch (e) {
      console.warn('[formwright] PDF picture left out:', it.label, e);
      missing++;
    }
  }));

  const bytes = await drawPdf(L, model, imgs);
  return { bytes, name: fileName(model.formName, model.title), missing, company: brand.companyName || '' };
}

/** Make the PDF and download it. → { name, missing } */
export async function exportRecordPdf(model) {
  const { bytes, name, missing } = await makeRecordPdf(model);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { name, missing };
}

/** Bytes as base64, for sending the PDF to the server. */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
