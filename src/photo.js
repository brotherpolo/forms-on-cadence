// Smaller photos: a photo is turned upright and scaled down before it's uploaded, so saving is
// quicker on mobile data, storage stays small and PDFs build faster. Files (File upload fields)
// are always uploaded exactly as they are.

export const MAX_EDGE = 2000;   // pixels on the longest side: sharp on screen, in PDFs and printed
export const QUALITY = 0.85;    // JPEG quality
export const KEEP_UNDER = 400 * 1024; // a JPEG already this small and this size is left alone

/** The size to scale to: never larger than it is. */
export function targetSize(w, h, max = MAX_EDGE) {
  const s = Math.min(1, max / Math.max(w || 1, h || 1));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scaled: s < 1 };
}

/** "IMG_0042.HEIC" → "IMG_0042.jpg" */
export const jpgName = (name) => String(name || 'photo').replace(/\.[^./\\]+$/, '') + '.jpg';

/**
 * The photo to upload: a smaller JPEG, or the original when it can't be read here (some phones'
 * HEIC photos on some browsers), it's already small, or shrinking wouldn't help.
 * The new copy carries no location or camera details.
 */
export async function shrinkPhoto(file) {
  if (!file || /gif|svg/i.test(file.type || '')) return file;
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { return file; }
  try {
    const t = targetSize(bmp.width, bmp.height);
    if (!t.scaled && file.size <= KEEP_UNDER && /jpe?g/i.test(file.type || '')) return file;
    const c = document.createElement('canvas');
    c.width = t.w; c.height = t.h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, t.w, t.h); // see-through parts become white
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, t.w, t.h);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], jpgName(file.name), { type: 'image/jpeg', lastModified: file.lastModified || Date.now() });
  } finally { bmp.close?.(); }
}
