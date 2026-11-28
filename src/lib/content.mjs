// Loads everything in /content and checks it. Problems are collected, not thrown,
// so one run reports every mistake at once, in plain words.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { parseFrontMatter } from '../shared/frontmatter.mjs';
import { KINDS, LIMITS, docId, validateFields } from '../shared/schema.mjs';
import { FOLDER_RE, PHOTO_EXT_RE, PHOTO_NAME_RE, slugFromFolder } from '../shared/text.mjs';
import { locationData } from './exif.mjs';
import { Problems } from './errors.mjs';
import { scanBody } from './markdown.mjs';

const RESERVED_SLUGS = new Set(Object.values(KINDS).map((k) => k.section));

async function subdirs(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

async function filesIn(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

async function readDoc(root, type, relDir, problems) {
  const rel = `${relDir}/index.md`;
  let source;
  try {
    source = await readFile(path.join(root, rel), 'utf8');
  } catch {
    problems.error(rel, 'This folder has no index.md file.', 'Add an index.md with the fields for this item, or delete the folder.');
    return null;
  }
  const { data, body, errors } = parseFrontMatter(source);
  for (const e of errors) problems.error(rel, `Line ${e.line}: ${e.message}`);
  if (errors.length) return null;
  for (const v of validateFields(type, data)) problems.error(rel, v.message);
  return { data, body, rel, relDir, dir: path.join(root, relDir) };
}

/** Checks one photo file. Returns true when it can be used. */
async function inspectPhoto(doc, folderFiles, file, problems, seen) {
  if (seen.has(file)) return seen.get(file);
  const where = doc.rel;
  const fail = (message, fix) => {
    problems.error(where, message, fix);
    seen.set(file, false);
    return false;
  };
  if (/^[a-z][a-z0-9+.-]*:/i.test(file) || file.includes('/') || file.includes('\\')) {
    return fail(`Photo "${file}" is an address or a path.`, 'Photos must sit in this entry\'s own folder. Write only the file name, like 01-photo.jpg.');
  }
  if (/\.(heic|heif)$/i.test(file)) {
    return fail(`Photo "${file}" is an iPhone HEIC file, which web browsers cannot show.`, 'Export it as a JPEG and add it again. Studio can convert a HEIC photo only if your browser can open it.');
  }
  if (!PHOTO_NAME_RE.test(file)) {
    return fail(`Photo name "${file}" is not allowed.`, 'Use only letters, numbers, dots, dashes or underscores, and end the name with .jpg, .jpeg, .png or .webp.');
  }
  if (!folderFiles.includes(file)) {
    const other = folderFiles.find((f) => f.toLowerCase() === file.toLowerCase());
    return fail(
      `Photo "${file}" is used in the text, but no file with that name is in the folder.`,
      other ? `The folder has "${other}". Capital letters count, so write the name exactly like that.` : 'Add the photo to this folder, or remove the line from the text.',
    );
  }
  const abs = path.join(doc.dir, file);
  const { size } = await stat(abs);
  if (size > LIMITS.photoBytes) {
    return fail(`Photo "${file}" is ${(size / 1048576).toFixed(1)} MB; the limit is 25 MB.`, 'Add it through Studio, which shrinks it, or resize it first.');
  }
  let meta;
  try {
    meta = await sharp(await readFile(abs)).metadata();
  } catch {
    return fail(`Photo "${file}" cannot be read as a picture. The file may be damaged.`, 'Take or export the photo again.');
  }
  const loc = locationData(meta);
  if (loc.found) {
    return fail(
      `Photo "${file}" contains location data (${loc.reason}).`,
      'Add it again through Studio, which removes it, or switch off location tags in your camera app and take the photo again.',
    );
  }
  seen.set(file, true);
  return true;
}

export async function loadContent(root) {
  const problems = new Problems();

  // Profile
  const profileDoc = await readDoc(root, 'profile', 'content/profile', problems);
  let profile = null;
  if (profileDoc) {
    const files = await filesIn(profileDoc.dir);
    const seen = new Map();
    const portrait = profileDoc.data.portrait;
    const portraitOk = portrait ? await inspectPhoto(profileDoc, files, portrait, problems, seen) : false;
    const about = scanBody(profileDoc.body);
    if (about.images.length || about.stray.length) {
      problems.error(
        profileDoc.rel,
        'The About text contains a photo line, which this page does not show.',
        'Remove the line that starts with ![ . Use the Portrait photo field for your picture.',
      );
    }
    const cv = profileDoc.data.cv;
    if (cv && cv.startsWith('files/')) {
      try {
        await stat(path.join(root, 'public', cv));
      } catch {
        problems.error(profileDoc.rel, `The CV file "${cv}" is not in the public/files folder.`, 'Add the PDF to public/files, or clear the CV field.');
      }
    }
    profile = { ...profileDoc, portrait: portraitOk ? portrait : '' };
  }

  // Credentials
  const credentials = [];
  const credNumbers = new Map();
  for (const folder of await subdirs(path.join(root, 'content/credentials'))) {
    const relDir = `content/credentials/${folder}`;
    const doc = await readDoc(root, 'credential', relDir, problems);
    if (!doc) continue;
    const n = doc.data.number;
    if (doc.data.start && doc.data.end && doc.data.end < doc.data.start) {
      problems.error(doc.rel, 'The end date is earlier than the start date.', 'Check both dates.');
    }
    if (n) {
      if (credNumbers.has(n)) problems.error(doc.rel, `Credential number ${n} is already used by ${credNumbers.get(n)}.`, 'Give each credential its own number.');
      else credNumbers.set(n, relDir);
    }
    credentials.push({ ...doc, slug: folder, id: docId('credential', n) });
  }
  credentials.sort((a, b) => String(b.data.end ?? b.data.start ?? '').localeCompare(String(a.data.end ?? a.data.start ?? '')) || a.slug.localeCompare(b.slug));

  // Entries
  const entries = [];
  const slugs = new Map();
  const numbers = new Map();
  for (const folder of await subdirs(path.join(root, 'content/entries'))) {
    const relDir = `content/entries/${folder}`;
    if (!FOLDER_RE.test(folder)) {
      problems.error(relDir, 'The folder name must be a date and then lowercase words joined by dashes, like 2026-11-10-lap-length-check.', 'Rename the folder.');
      continue;
    }
    const doc = await readDoc(root, 'entry', relDir, problems);
    if (!doc) continue;
    const { data } = doc;
    const slug = slugFromFolder(folder);
    if (RESERVED_SLUGS.has(slug)) {
      problems.error(doc.rel, `The web address name "${slug}" is used by the site itself.`, 'Rename the folder so the words after the date are different, for example add a few more words.');
    } else if (slugs.has(slug)) problems.error(doc.rel, `Another entry (${slugs.get(slug)}) has the same web address name "${slug}".`, 'Rename one of the folders so the words after the date differ.');
    else slugs.set(slug, relDir);
    if (!folder.startsWith(`${data.date}-`)) {
      problems.warn(doc.rel, `The folder starts with a different date than the date field (${data.date}). The date field is what the site shows.`);
    }
    if (data.number && KINDS[data.kind]) {
      const key = `${data.kind}:${data.number}`;
      if (numbers.has(key)) problems.error(doc.rel, `${docId(data.kind, data.number)} is already used by ${numbers.get(key)}.`, 'Give each entry of the same kind its own number.');
      else numbers.set(key, relDir);
    } else if (!data.number) {
      problems.warn(doc.rel, 'This entry has no number, so the site shows none. Studio assigns one automatically.');
    }

    const files = await filesIn(doc.dir);
    const seen = new Map();
    const scan = scanBody(doc.body);
    for (const s of scan.stray) {
      problems.error(doc.rel, `A photo (${s.href}) sits inside a sentence, list or quote.`, 'Put each photo on a line of its own: ![description](file.jpg "Caption").');
    }
    const photos = [];
    for (const img of scan.images) {
      const alt = img.alt.trim();
      const caption = img.caption.trim();
      if (!alt) problems.error(doc.rel, `Photo ${img.href} has no description.`, `Write what is visible between the square brackets: ![your description](${img.href} "Caption").`);
      else if ([...alt].length > LIMITS.descriptionChars) problems.error(doc.rel, `The description of photo ${img.href} is too long (${[...alt].length} characters; the limit is ${LIMITS.descriptionChars}).`);
      if (!caption) problems.error(doc.rel, `Photo ${img.href} has no caption.`, `Add a caption in quotes after the file name: ![description](${img.href} "Your caption").`);
      else if ([...caption].length > LIMITS.descriptionChars) problems.error(doc.rel, `The caption of photo ${img.href} is too long (${[...caption].length} characters; the limit is ${LIMITS.descriptionChars}).`);
      if (await inspectPhoto(doc, files, img.href, problems, seen) && !photos.some((p) => p.file === img.href)) {
        photos.push({ file: img.href, alt, caption });
      }
    }
    if (scan.images.length > LIMITS.photosPerEntry) problems.error(doc.rel, `This entry has ${scan.images.length} photos; the limit is ${LIMITS.photosPerEntry}.`, 'Split it into two entries.');

    let coverFile = photos[0]?.file ?? '';
    if (data.cover) {
      if (await inspectPhoto(doc, files, data.cover, problems, seen)) coverFile = data.cover;
    }
    for (const f of files) {
      if (f === 'index.md') continue;
      if (PHOTO_EXT_RE.test(f) && !seen.has(f)) problems.warn(doc.rel, `The photo "${f}" is in the folder but not used in the text, so it is not shown.`, 'Add a line for it in the text, or delete the file.');
      else if (!PHOTO_EXT_RE.test(f) && !/\.(heic|heif)$/i.test(f)) problems.warn(doc.rel, `The file "${f}" is not a photo and is ignored.`);
    }
    const revisions = Array.isArray(data.revisions) ? data.revisions : [];
    const last = revisions[revisions.length - 1];
    entries.push({
      ...doc,
      folder,
      slug,
      id: docId(data.kind, data.number),
      kind: KINDS[data.kind] ?? null,
      title: data.title,
      summary: data.summary,
      date: data.date,
      updated: last?.date ?? data.date,
      revision: last?.rev ?? 'A',
      revisions,
      photos,
      coverFile,
      sample: data.sample === true,
      featured: data.featured === true,
    });
  }
  entries.sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.data.number ?? 0) - (a.data.number ?? 0) || b.folder.localeCompare(a.folder));
  if (entries.filter((e) => e.featured).length > LIMITS.featured) {
    problems.warn('content/entries', `More than ${LIMITS.featured} entries are marked to show on the home page. Only the newest ${LIMITS.featured} will appear.`);
  }
  return { profile, credentials, entries, problems };
}
