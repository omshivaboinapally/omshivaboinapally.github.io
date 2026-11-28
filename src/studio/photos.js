// Shrinks a chosen photo inside the browser and drops its camera data (place,
// time, device) by redrawing it onto a blank canvas. Only the redrawn picture
// is ever uploaded, so your phone's location tags never leave your phone.

export class PhotoError extends Error {}

export const MAX_SIDE = 2400;

export async function preparePhoto(file, { maxSide = MAX_SIDE, quality = 0.9 } = {}) {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    throw new PhotoError(`"${file.name}" is not a picture.`);
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new PhotoError(
        `This browser cannot open "${file.name}". If it is an iPhone HEIC photo, save or export it as a JPEG and add it again.`,
      );
    }
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    if (!w0 || !h0) throw new PhotoError(`"${file.name}" has no picture in it.`);
    const scale = Math.min(1, maxSide / Math.max(w0, h0));
    const width = Math.max(1, Math.round(w0 * scale));
    const height = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoError(`"${file.name}" is too large for this browser to shrink. Try a smaller photo.`);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new PhotoError(`"${file.name}" could not be shrunk. Try a smaller photo.`);
    return { blob, width, height, previewUrl: URL.createObjectURL(blob) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
