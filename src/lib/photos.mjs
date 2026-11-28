// Makes the web versions of every photo: AVIF (up to 2400 px wide) and JPEG
// (up to 1600 px). Results are cached by the photo's content, so a photo that
// has not changed is never processed twice.

import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const VERSION = 'v1';
export const AVIF_WIDTHS = [480, 960, 1600, 2400];
export const JPEG_WIDTHS = [480, 960, 1600];

/** Widths to make for a photo that is `source` pixels wide. Never enlarges. */
export function planWidths(source, targets) {
  const max = Math.min(source, targets[targets.length - 1]);
  const widths = targets.filter((w) => w < max * 0.9);
  widths.push(max);
  return [...new Set(widths)];
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export class PhotoPipeline {
  constructor({ root, outDir, base }) {
    this.cacheDir = path.join(root, '.cache', 'photos');
    this.outDir = outDir;
    this.base = base;
    this.seen = new Set();
    this.memo = new Map();
    this.stats = { reused: 0, made: 0 };
  }

  process(absPath, group) {
    const key = `${absPath}|${group}`;
    if (!this.memo.has(key)) this.memo.set(key, this.#process(absPath, group));
    return this.memo.get(key);
  }

  async #process(absPath, group) {
    const bytes = await readFile(absPath);
    const key = createHash('sha256').update(VERSION).update(bytes).digest('hex').slice(0, 12);
    const stem = path.basename(absPath).replace(/\.[^.]+$/, '');
    const dir = path.join(this.cacheDir, key);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
      this.stats.reused++;
    } catch {
      manifest = await this.#make(bytes, dir);
      await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
      this.stats.made++;
    }
    this.seen.add(key);
    const folder = path.join(this.outDir, 'media', group);
    await mkdir(folder, { recursive: true });
    const name = (w, ext) => `${stem}.${key}-${w}.${ext}`;
    for (const w of manifest.avif) await copyFile(path.join(dir, `${w}.avif`), path.join(folder, name(w, 'avif')));
    for (const w of manifest.jpeg) await copyFile(path.join(dir, `${w}.jpg`), path.join(folder, name(w, 'jpg')));
    const url = (f) => `${this.base}media/${group}/${f}`;
    return {
      file: path.basename(absPath),
      width: manifest.width,
      height: manifest.height,
      avif: manifest.avif.map((w) => ({ w, url: url(name(w, 'avif')) })),
      jpeg: manifest.jpeg.map((w) => ({ w, url: url(name(w, 'jpg')) })),
    };
  }

  async #make(bytes, dir) {
    await mkdir(dir, { recursive: true });
    const meta = await sharp(bytes).metadata();
    const turned = (meta.orientation ?? 1) >= 5;
    const width = turned ? meta.height : meta.width;
    const height = turned ? meta.width : meta.height;
    const avif = planWidths(width, AVIF_WIDTHS);
    const jpeg = planWidths(width, JPEG_WIDTHS);
    const start = () => sharp(bytes).rotate(); // turns the picture upright; all camera data is dropped
    for (const w of avif) {
      await start().resize({ width: w, withoutEnlargement: true }).avif({ quality: 55, effort: 4 }).toFile(path.join(dir, `${w}.avif`));
    }
    for (const w of jpeg) {
      await start()
        .resize({ width: w, withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 78, mozjpeg: true })
        .toFile(path.join(dir, `${w}.jpg`));
    }
    return { width, height, avif, jpeg };
  }

  /** Deletes cached photos that this build did not use. */
  async prune() {
    let names = [];
    try {
      names = await readdir(this.cacheDir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const n of names) {
      if (!this.seen.has(n)) {
        await rm(path.join(this.cacheDir, n), { recursive: true, force: true });
        removed++;
      }
    }
    return removed;
  }
}

/** Small square-ish version of a photo as a Buffer, used for share previews. */
export async function shareImage(absPath, width = 1200, height = 630) {
  return sharp(await readFile(absPath))
    .rotate()
    .resize({ width, height, fit: 'cover', position: 'attention' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}
