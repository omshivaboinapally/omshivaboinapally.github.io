// Small helpers shared by the build (Node) and Studio (browser).
// Nothing in this file may use Node-only features.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const FOLDER_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PHOTO_EXT_RE = /\.(jpe?g|png|webp)$/i;
export const PHOTO_NAME_RE = /^[a-z0-9][a-z0-9._-]*\.(?:jpe?g|png|webp)$/i;
export const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)\s*$/;

/** Makes text safe to put inside HTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** "Column check, Level 3!" -> "column-check-level-3" */
export function slugify(input, max = 48) {
  const s = String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const dash = cut.lastIndexOf('-');
  return (dash > 12 ? cut.slice(0, dash) : cut).replace(/-+$/, '');
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Today's date in the reader's own time zone, as yyyy-mm-dd. */
export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** "2026-11-10" -> "10 Nov 2026" (fixed format, no locale surprises). */
export function formatDate(iso) {
  if (!isValidDate(iso)) return String(iso ?? '');
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "2024-12-01" -> "Dec 2024" */
export function formatMonthYear(iso) {
  if (!isValidDate(iso)) return String(iso ?? '');
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function pad(n, width = 3) {
  return String(n).padStart(width, '0');
}

/** Revision letters: '' -> A, A -> B, Z -> AA. */
export function nextRevision(rev) {
  if (!rev) return 'A';
  const chars = String(rev).toUpperCase().split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] === 'Z') chars[i] = 'A';
    else {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join('');
    }
  }
  return 'A' + chars.join('');
}

export function folderName(date, slug) {
  return `${date}-${slug}`;
}

/** "2026-11-10-lap-check" -> "lap-check" (the web address never contains the date). */
export function slugFromFolder(folder) {
  return String(folder).replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

/** "01-lap-length-check.jpg" */
export function photoFileName(index, caption, ext) {
  const stem = slugify(caption || 'photo', 36) || 'photo';
  return `${String(index).padStart(2, '0')}-${stem}.${String(ext).toLowerCase().replace('jpeg', 'jpg')}`;
}

/** One safe line for the text inside [] or "" of a Markdown image. */
export function cleanLine(s, max = 200) {
  let t = String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/\[/g, '(').replace(/\]/g, ')').replace(/\\/g, '/');
  t = t.replace(/"([^"]*)"/g, '“$1”').replace(/"/g, '”');
  return t.slice(0, max).trim();
}

export function imageLine(file, alt, caption) {
  const title = cleanLine(caption);
  return `![${cleanLine(alt)}](${file}${title ? ` "${title}"` : ''})`;
}

export function parseImageLine(line) {
  const m = IMAGE_LINE_RE.exec(String(line).trim());
  return m ? { alt: m[1], file: m[2], caption: m[3] ?? '' } : null;
}

/**
 * Splits an entry body into an intro and "## Heading" sections.
 * A run of image lines at the very end of a part becomes that part's photos;
 * everything else stays untouched in `text`, so nothing is lost.
 */
export function parseSections(body) {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const parts = [];
  let cur = { heading: null, lines: [] };
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      parts.push(cur);
      cur = { heading: m[1], lines: [] };
    } else cur.lines.push(line);
  }
  parts.push(cur);
  const [first, ...rest] = parts;
  return {
    intro: splitPhotos(first.lines),
    sections: rest.map((p) => ({ heading: p.heading, ...splitPhotos(p.lines) })),
  };
}

function splitPhotos(lines) {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  const photos = [];
  let i = end;
  while (i > 0) {
    const p = parseImageLine(lines[i - 1]);
    if (!p) break;
    photos.unshift(p);
    i--;
  }
  return { text: lines.slice(0, i).join('\n').trim(), photos };
}

export function buildBody({ intro, sections } = {}) {
  const block = ({ text = '', photos = [] }) =>
    [String(text).trim(), photos.map((p) => imageLine(p.file, p.alt, p.caption)).join('\n')]
      .filter(Boolean)
      .join('\n\n');
  const out = [];
  const first = block(intro ?? {});
  if (first) out.push(first);
  for (const s of sections ?? []) {
    const b = block(s);
    out.push(`## ${cleanLine(s.heading, 80)}${b ? `\n\n${b}` : ''}`);
  }
  return out.join('\n\n');
}
