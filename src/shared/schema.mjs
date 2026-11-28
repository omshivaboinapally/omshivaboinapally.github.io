// One source of truth for every field. The build checks content against it
// and Studio builds its forms from it, so the two can never disagree.

import { isValidDate, pad } from './text.mjs';

export const KINDS = {
  'site-note': { label: 'Site note', plural: 'Site notes', prefix: 'SN', section: 'site-notes' },
  project: { label: 'Project', plural: 'Projects', prefix: 'PR', section: 'projects' },
  report: { label: 'Report', plural: 'Reports', prefix: 'RP', section: 'reports' },
};

export const LIMITS = { photoBytes: 25 * 1024 * 1024, photosPerEntry: 60, featured: 3, descriptionChars: 200 };

/** SN-007, PR-001, RP-002, CR-001 */
export function docId(kind, number) {
  const prefix = kind === 'credential' ? 'CR' : KINDS[kind]?.prefix;
  return prefix && Number.isInteger(number) && number > 0 ? `${prefix}-${pad(number)}` : '';
}

const text = (key, label, o = {}) => ({ key, label, type: 'text', ...o });

export const PERMISSION_LABEL = 'I have permission to show this.';
export const PRIVACY_LABEL = 'No faces, number plates, client names or exact addresses are visible, or I covered them.';

const ENTRY_FIELDS = [
  text('title', 'Title', { required: true, min: 3, max: 80, placeholder: 'Column reinforcement check, level 3', hint: 'Say what it is, in plain words.' }),
  {
    key: 'kind',
    label: 'Kind',
    type: 'choice',
    required: true,
    options: Object.entries(KINDS).map(([value, k]) => ({ value, label: k.label })),
  },
  { key: 'date', label: 'Date', type: 'date', required: true, hint: 'The day of the visit or the work.' },
  text('summary', 'Summary', {
    required: true,
    min: 40,
    max: 200,
    multiline: true,
    hint: 'One or two sentences. Shown on cards and when your link is shared.',
  }),
  text('place', 'Place', { max: 80, placeholder: 'Residential tower, Hyderabad', hint: 'Keep it general: the area and kind of site, not the site name or street.' }),
  text('stage', 'Stage or subject', { max: 60, placeholder: 'Column reinforcement' }),
  { key: 'topics', label: 'Topics', type: 'list', maxItems: 6, maxLength: 30, hint: 'Short words, separated by commas.' },
  { key: 'tools', label: 'Tools', type: 'list', maxItems: 8, maxLength: 30, hint: 'Software or instruments used, separated by commas.' },
  { key: 'links', label: 'Links', type: 'links', maxItems: 6, hint: 'Reports or files hosted elsewhere. Web addresses must start with https://' },
  text('cover', 'Cover photo', { max: 120, system: true }),
  { key: 'featured', label: 'Show on the home page', type: 'bool' },
  { key: 'permission', label: PERMISSION_LABEL, type: 'confirm' },
  { key: 'privacyChecked', label: PRIVACY_LABEL, type: 'confirm' },
  { key: 'number', label: 'Number', type: 'number', system: true },
  { key: 'revisions', label: 'Revisions', type: 'revisions', system: true },
  { key: 'sample', label: 'Sample', type: 'bool', system: true },
];

const CREDENTIAL_FIELDS = [
  text('title', 'Title', { required: true, max: 90, placeholder: 'Supervisor Structure (CON/Q0111)' }),
  text('issuer', 'Issuer', { required: true, max: 90, placeholder: 'National Academy of Construction' }),
  text('place', 'Place', { max: 80 }),
  { key: 'start', label: 'Start date', type: 'date' },
  { key: 'end', label: 'End date', type: 'date' },
  text('level', 'Level', { max: 40, placeholder: 'Basic level' }),
  text('summary', 'Summary', { max: 200, multiline: true }),
  { key: 'number', label: 'Number', type: 'number', system: true },
];

const PROFILE_FIELDS = [
  text('name', 'Full name', { required: true, max: 80 }),
  text('shortName', 'Short name', { max: 40, hint: 'Shown in the page header.' }),
  text('headline', 'Headline', { required: true, max: 160, multiline: true, hint: 'One honest sentence about who you are and what you do.' }),
  text('location', 'Location', { max: 60, placeholder: 'Hyderabad, India' }),
  { key: 'email', label: 'Email', type: 'email', hint: 'Shown on the Contact page, which anyone can read, and spam programs collect addresses from web pages. Leave it empty to keep your email off the site.' },
  { key: 'linkedin', label: 'LinkedIn address', type: 'url' },
  { key: 'github', label: 'GitHub address', type: 'url' },
  { key: 'cv', label: 'CV file', type: 'path', hint: 'A PDF you added to public/files, written like files/cv.pdf, or a full https:// address.' },
  text('portrait', 'Portrait photo', { max: 120, hint: 'File name of a photo in the profile folder.' }),
  text('description', 'Search description', { max: 160, multiline: true, hint: 'Shown by search engines under your name.' }),
  text('availability', 'Availability', { max: 140, placeholder: 'Looking for an internship in site execution' }),
  {
    key: 'siteUrl',
    label: 'Website address',
    type: 'url',
    hint: 'Only if you use your own domain, for example https://www.yourname.in',
    check: (v) => {
      const message = 'Website address must be just the domain, like https://www.yourname.in';
      try {
        const u = new URL(v);
        return u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password ? '' : message;
      } catch {
        return message;
      }
    },
  },
];

export const SCHEMA = {
  entry: {
    label: 'Entry',
    root: 'content/entries',
    order: ['title', 'kind', 'number', 'date', 'summary', 'place', 'stage', 'topics', 'tools', 'links', 'cover', 'featured', 'permission', 'privacyChecked', 'revisions', 'sample'],
    fields: ENTRY_FIELDS,
  },
  credential: {
    label: 'Credential',
    root: 'content/credentials',
    order: ['title', 'issuer', 'number', 'place', 'start', 'end', 'level', 'summary'],
    fields: CREDENTIAL_FIELDS,
  },
  profile: {
    label: 'Profile',
    root: 'content/profile',
    order: ['name', 'shortName', 'headline', 'location', 'email', 'linkedin', 'github', 'cv', 'portrait', 'description', 'availability', 'siteUrl'],
    fields: PROFILE_FIELDS,
  },
};

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function isHttps(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname.includes('.');
  } catch {
    return false;
  }
}

function checkField(f, v) {
  const L = f.label;
  const bad = (message) => [{ field: f.key, message }];
  if (f.type === 'confirm') return v === true ? [] : bad(`Confirm before publishing: "${f.label}"`);
  if (isEmpty(v)) return f.required ? bad(`${L} is required.`) : [];
  switch (f.type) {
    case 'text':
    case 'email':
    case 'url':
    case 'path': {
      if (typeof v !== 'string') return bad(`${L} must be text.`);
      const n = [...v].length;
      if (f.min && n < f.min) return bad(`${L} is too short: ${n} characters, it needs at least ${f.min}.`);
      if (f.max && n > f.max) return bad(`${L} is too long: ${n} characters, the limit is ${f.max}.`);
      if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return bad(`${L} does not look like an email address.`);
      if (f.type === 'url' && !isHttps(v)) return bad(`${L} must be a full web address that starts with https://`);
      if (f.type === 'path' && !(isHttps(v) || /^files\/[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/.test(v))) {
        return bad(`${L} must be a web address starting with https:// or a PDF in public/files, written like files/cv.pdf`);
      }
      if (f.check) {
        const msg = f.check(v);
        if (msg) return bad(msg);
      }
      return [];
    }
    case 'date':
      return isValidDate(v) ? [] : bad(`${L} must be a real date written like 2026-11-10.`);
    case 'choice':
      return f.options.some((o) => o.value === v) ? [] : bad(`${L} must be one of: ${f.options.map((o) => o.value).join(', ')}.`);
    case 'number':
      return Number.isInteger(v) && v >= 1 ? [] : bad(`${L} must be a whole number, 1 or more.`);
    case 'bool':
      return typeof v === 'boolean' ? [] : bad(`${L} must be true or false.`);
    case 'list': {
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return bad(`${L} must be a list of words, written like ["One", "Two"].`);
      if (v.length > f.maxItems) return bad(`${L} can have at most ${f.maxItems} items; there are ${v.length}.`);
      if (v.some((x) => [...x].length > f.maxLength)) return bad(`Each item in ${L} can be at most ${f.maxLength} characters.`);
      return [];
    }
    case 'links': {
      if (!Array.isArray(v) || v.some((x) => !x || typeof x !== 'object')) {
        return bad(`${L} must be written like [{"label": "Report", "url": "https://example.com/report.pdf"}].`);
      }
      if (v.length > f.maxItems) return bad(`${L} can have at most ${f.maxItems} items; there are ${v.length}.`);
      for (const l of v) {
        if (typeof l.label !== 'string' || !l.label.trim() || [...l.label].length > 60) return bad(`Each link needs a label of up to 60 characters.`);
        if (typeof l.url !== 'string' || !isHttps(l.url)) return bad(`The link "${l.label}" must have a web address that starts with https://`);
      }
      return [];
    }
    case 'revisions': {
      if (!Array.isArray(v)) return bad(`${L} must be a list.`);
      for (const r of v) {
        if (!r || !/^[A-Z]{1,3}$/.test(r.rev ?? '') || !isValidDate(r.date)) {
          return bad(`Each revision needs a letter (A, B, ...) and a real date written like 2026-11-10.`);
        }
        if (r.note !== undefined && (typeof r.note !== 'string' || [...r.note].length > 140)) return bad(`A revision note can be at most 140 characters.`);
      }
      return [];
    }
    default:
      return [];
  }
}

/** @returns {{ field: string, message: string }[]} */
export function validateFields(type, data) {
  const out = [];
  for (const f of SCHEMA[type].fields) out.push(...checkField(f, data[f.key]));
  return out;
}
