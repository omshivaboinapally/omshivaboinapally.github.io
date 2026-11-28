// Finds location (GPS) data inside a photo. Works from sharp's metadata, so it
// covers JPEG, PNG and WebP alike. If the data cannot be read, we assume the
// worst: a photo we cannot vouch for is refused.

function tiffHasGps(buf) {
  let start = -1;
  for (let i = 0; i < Math.min(buf.length - 8, 16); i++) {
    const le = buf[i] === 0x49 && buf[i + 1] === 0x49 && buf[i + 2] === 0x2a && buf[i + 3] === 0x00;
    const be = buf[i] === 0x4d && buf[i + 1] === 0x4d && buf[i + 2] === 0x00 && buf[i + 3] === 0x2a;
    if (le || be) {
      start = i;
      break;
    }
  }
  if (start < 0) return null; // no TIFF header found: cannot tell
  const little = buf[start] === 0x49;
  const u16 = (o) => (little ? buf.readUInt16LE(start + o) : buf.readUInt16BE(start + o));
  const u32 = (o) => (little ? buf.readUInt32LE(start + o) : buf.readUInt32BE(start + o));
  const ifd0 = u32(4);
  const count = u16(ifd0);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (u16(entry) !== 0x8825) continue;
    const gps = u32(entry + 8);
    const n = u16(gps);
    for (let j = 0; j < n; j++) if (u16(gps + 2 + j * 12) !== 0x0000) return true; // anything but GPSVersionID
    return false;
  }
  return false;
}

/** @returns {{ found: boolean, reason?: string }} */
export function locationData(meta) {
  try {
    if (meta.exif && meta.exif.length) {
      const r = tiffHasGps(Buffer.from(meta.exif));
      if (r === true) return { found: true, reason: 'GPS coordinates' };
      if (r === null) return { found: true, reason: 'camera data that could not be read' };
    }
    if (meta.xmp && meta.xmp.length) {
      const xmp = Buffer.from(meta.xmp).toString('latin1');
      if (/GPSLatitude|GPSLongitude/i.test(xmp)) return { found: true, reason: 'GPS coordinates in XMP data' };
    }
    return { found: false };
  } catch {
    return { found: true, reason: 'camera data that could not be read' };
  }
}
