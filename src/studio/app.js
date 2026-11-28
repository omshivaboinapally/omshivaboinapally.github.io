// Studio: the owner's page for adding, changing and deleting what is on the site.
// It talks to GitHub with the owner's own access token. Nothing here can run
// for anyone else, because GitHub only accepts changes from the token's owner.

import { KINDS, LIMITS, SCHEMA, docId, validateFields } from './shared/schema.mjs';
import { composeDocument, parseFrontMatter } from './shared/frontmatter.mjs';
import { createMarkdown } from './shared/render.mjs';
import { buildBody, formatDate, folderName, nextRevision, parseSections, photoFileName, slugFromFolder, slugify, todayISO } from './shared/text.mjs';
import { Marked } from './vendor/marked.esm.js';
import { buildField, h, uid } from './forms.js';
import { createClient, GitHubError, pool } from './github.js';
import { PhotoError, preparePhoto } from './photos.js';
import { deleteDraft, listDrafts, loadBlob, loadDraft, saveBlob, saveDraft } from './drafts.js';

const { renderBody } = createMarkdown(Marked);
const app = document.getElementById('app');
const live = document.getElementById('live');

let config = null;
let auth = null;
let client = null;
let repo = null;
let routeId = 0;
let busy = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const announce = (message) => {
  live.textContent = '';
  setTimeout(() => {
    live.textContent = message;
  }, 50);
};
const when = (ms) => new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/* ---------- Sign-in storage ---------- */

const AUTH_KEY = 'portfolio-studio.auth';
const stores = [() => sessionStorage, () => localStorage];

function readAuth() {
  for (const get of stores) {
    try {
      const raw = get().getItem(AUTH_KEY);
      const a = raw ? JSON.parse(raw) : null;
      if (a?.token && a?.owner && a?.repo) return a;
    } catch {
      /* storage is not available */
    }
  }
  return null;
}

function clearAuth() {
  for (const get of stores) {
    try {
      get().removeItem(AUTH_KEY);
    } catch {
      /* nothing stored */
    }
  }
}

function writeAuth(value, remember) {
  clearAuth();
  try {
    (remember ? localStorage : sessionStorage).setItem(AUTH_KEY, JSON.stringify({ ...value, remember }));
  } catch {
    /* the token then lasts only until this page is closed */
  }
}

/* ---------- Small pieces of screen ---------- */

const notice = (kind, title, body) =>
  h('div', { class: `notice notice--${kind}`, role: kind === 'error' ? 'alert' : 'status' }, title ? h('strong', null, title) : null, body ? h('p', null, body) : null);

function errorNotice(err) {
  if (err instanceof GitHubError) {
    const box = notice('error', err.message, err.hint);
    if (err.code === 'auth') {
      // Unfinished drafts stay on this device, so signing in again loses nothing.
      box.append(h('p', null, h('button', { type: 'button', class: 'btn btn--small', onClick: () => { clearAuth(); auth = null; client = null; repo = null; route(); } }, 'Sign in with a new token')));
    }
    return box;
  }
  return notice('error', err?.message || 'Something went wrong.', 'Nothing was changed. Try again.');
}

const topBar = () =>
  h(
    'header',
    { class: 's-bar' },
    h(
      'div',
      { class: 's-bar__in' },
      h('span', { class: 's-bar__name' }, 'Studio'),
      auth ? h('span', { class: 's-bar__repo' }, `${auth.owner}/${auth.repo}`) : null,
      h('a', { href: '../' }, 'View site'),
      auth && !busy ? h('button', { type: 'button', class: 'linklike', onClick: signOut }, 'Sign out') : null,
    ),
  );

function screen(title, ...nodes) {
  document.title = `${title} - Studio`;
  app.replaceChildren(topBar(), h('main', { class: 's-main' }, ...nodes));
  const heading = app.querySelector('h1');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}

const linkButton = (href, label, cls = 'btn') => h('a', { class: cls, href }, label);

function signOut() {
  if (busy) return;
  clearAuth();
  auth = null;
  client = null;
  repo = null;
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  route();
}

/* ---------- Sign in ---------- */

function renderSignIn(problem) {
  const ownerRepo = config.owner && config.repo ? `${config.owner}/${config.repo}` : '';
  const repoInput = h('input', { id: 'repo', type: 'text', value: ownerRepo, placeholder: 'your-username/your-repository', autocomplete: 'off', spellcheck: 'false', readonly: Boolean(ownerRepo) });
  const token = h('input', { id: 'token', type: 'password', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'token-hint' });
  const remember = h('input', { type: 'checkbox', id: 'remember' });
  const message = h('div', null, problem ? errorNotice(problem) : null);
  const submit = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Sign in');

  const form = h(
    'form',
    {
      class: 's-form',
      novalidate: true,
      onSubmit: async (ev) => {
        ev.preventDefault();
        const [owner, name] = repoInput.value.trim().split('/');
        const value = token.value.trim();
        if (!owner || !name) return message.replaceChildren(notice('error', 'Write the repository as your-username/your-repository.'));
        if (!value) return message.replaceChildren(notice('error', 'Paste your access token first.'));
        submit.disabled = true;
        submit.textContent = 'Checking…';
        message.replaceChildren();
        try {
          const test = createClient({ apiBase: config.apiBase, owner, repo: name, branch: config.branch, token: value });
          await test.checkAccess();
          auth = { owner, repo: name, token: value };
          client = test;
          writeAuth(auth, remember.checked);
          token.value = '';
          history.replaceState(null, '', `${location.pathname}${location.search}#/`);
          route();
        } catch (err) {
          submit.disabled = false;
          submit.textContent = 'Sign in';
          message.replaceChildren(errorNotice(err));
        }
      },
    },
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'repo' }, 'Repository'), repoInput),
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'token' }, 'Access token'), h('p', { class: 'field__hint', id: 'token-hint' }, 'It starts with github_pat_. It stays in this browser and is sent only to GitHub.'), token),
    h('div', { class: 'field field--check' }, h('label', { class: 'check', for: 'remember' }, remember, h('span', null, 'Keep me signed in on this device. Tick this only on your own phone or computer.'))),
    message,
    submit,
  );

  screen(
    'Sign in',
    h('h1', null, 'Studio'),
    h('p', { class: 'lede' }, 'Add, change and delete the entries on your portfolio. Only you can do this: it needs an access token that you create on GitHub and can cancel at any time.'),
    form,
    h(
      'details',
      { class: 'help' },
      h('summary', null, 'How do I get a token?'),
      h(
        'ol',
        null,
        h('li', null, 'Open ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', rel: 'noopener noreferrer' }, 'github.com/settings/personal-access-tokens/new'), ' and sign in.'),
        h('li', null, 'Give it a name such as "Portfolio Studio" and choose how long it should last. Ninety days is a good choice.'),
        h('li', null, 'Under "Repository access", choose "Only select repositories" and pick this repository.'),
        h('li', null, 'Under "Permissions", open "Repository permissions", find "Contents" and set it to "Read and write".'),
        h('li', null, 'Press "Generate token", copy it, and paste it above.'),
      ),
      h('p', null, 'When the token expires, make a new one the same way. You can cancel it at any time on the same GitHub page.'),
    ),
  );
}

/* ---------- Reading the repository ---------- */

const byNewest = (a, b) => String(b.data.date ?? '').localeCompare(String(a.data.date ?? '')) || (b.data.number ?? 0) - (a.data.number ?? 0);

let repoLoading = null;
function loadRepo() {
  repoLoading ??= readRepo().finally(() => {
    repoLoading = null;
  });
  return repoLoading;
}

async function readRepo() {
  const head = await client.getHead();
  const tree = await client.listTree(head.treeSha);
  const blobs = tree.filter((n) => n.type === 'blob');
  const folders = (re) => [...new Set(blobs.map((n) => re.exec(n.path)?.[1]).filter(Boolean))].sort();
  const readDoc = async (dir) => {
    const files = blobs.filter((n) => n.path.startsWith(`${dir}/`)).map((n) => ({ name: n.path.slice(dir.length + 1), path: n.path, sha: n.sha }));
    const index = files.find((f) => f.name === 'index.md');
    if (!index) return null;
    const { data, body, errors } = parseFrontMatter(await client.readText(index.sha));
    return { dir, data, body, files, indexSha: index.sha, broken: errors.length > 0 };
  };
  const entries = (await pool(folders(/^content\/entries\/([^/]+)\//), 6, async (folder) => {
    const doc = await readDoc(`content/entries/${folder}`);
    return doc && { folder, ...doc };
  })).filter(Boolean);
  entries.sort(byNewest);
  const credentials = (await pool(folders(/^content\/credentials\/([^/]+)\//), 6, async (folder) => {
    const doc = await readDoc(`content/credentials/${folder}`);
    return doc && { folder, ...doc };
  })).filter(Boolean);
  credentials.sort((a, b) => (a.data.number ?? 0) - (b.data.number ?? 0));
  const profile = await readDoc('content/profile');
  let photoMap = {};
  try {
    const res = await fetch('./photos.json', { cache: 'no-store' });
    if (res.ok) photoMap = await res.json();
  } catch {
    /* thumbnails of existing photos are optional */
  }
  repo = { head, entries, credentials, profile, photoMap };
}

/* ---------- Routing ---------- */

let flushDraft = null; // set by the entry editor: saves the unfinished draft now

async function route() {
  flushDraft?.();
  flushDraft = null;
  const my = ++routeId;
  if (!auth) return renderSignIn();
  try {
    if (!client) client = createClient({ apiBase: config.apiBase, owner: auth.owner, repo: auth.repo, branch: config.branch, token: auth.token });
    if (!repo) {
      screen('Loading', h('h1', null, 'Loading your portfolio'), h('p', { role: 'status' }, 'Reading your entries from GitHub…'));
      await loadRepo();
      if (my !== routeId) return;
    }
    const [a, b, c] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (!a) return await renderHome();
    if (a === 'new') return await entryEditor({ mode: 'new' });
    if (a === 'edit' && b) return await entryEditor({ mode: 'edit', folder: b });
    if (a === 'profile') return profileEditor();
    if (a === 'credential' && b === 'new') return credentialEditor({ mode: 'new' });
    if (a === 'credential' && b === 'edit' && c) return credentialEditor({ mode: 'edit', folder: c });
    return await renderHome();
  } catch (err) {
    if (my !== routeId) return;
    if (err instanceof GitHubError && err.code === 'auth') {
      clearAuth();
      auth = null;
      client = null;
      repo = null;
      return renderSignIn(err);
    }
    screen('Problem', h('h1', null, 'Studio could not load'), errorNotice(err), h('button', { type: 'button', class: 'btn', onClick: () => { repo = null; route(); } }, 'Try again'));
  }
}

/* ---------- Home ---------- */

async function renderHome() {
  const my = routeId;
  const drafts = (await listDrafts()).filter((d) => d.key.startsWith('entry:'));
  if (my !== routeId) return;
  const hasSample = repo.entries.some((e) => e.data.sample === true);

  const draftRow = (d) => {
    const isNew = d.key === 'entry:new';
    const folder = isNew ? null : d.key.slice('entry:edit:'.length);
    const live = isNew ? null : repo.entries.find((e) => e.folder === folder);
    const stale = !isNew && (!live || live.indexSha !== d.value?.baseSha);
    return h(
      'li',
      { class: 's-row' },
      h(
        'div',
        { class: 's-row__text' },
        h('strong', null, d.value?.fields?.title || 'Untitled draft'),
        h('span', { class: 's-row__meta' }, stale ? `Out of date: this entry changed after you started. Saved ${when(d.savedAt)}` : `Saved on this device, ${when(d.savedAt)}`),
      ),
      h(
        'div',
        { class: 's-row__actions' },
        stale ? null : linkButton(isNew ? '#/new' : `#/edit/${encodeURIComponent(folder)}`, 'Continue', 'btn btn--small'),
        h('button', { type: 'button', class: 'btn btn--small', onClick: async () => { await deleteDraft(d.key); if (routeId === my) renderHome(); } }, 'Discard'),
      ),
    );
  };

  const entryRow = (e) => {
    const d = e.data;
    const id = docId(d.kind, d.number);
    return h(
      'li',
      { class: 's-row' },
      h(
        'div',
        { class: 's-row__text' },
        h('span', { class: 'label' }, id || 'No number'),
        h('strong', null, d.title || e.folder),
        h('span', { class: 's-row__meta' }, `${KINDS[d.kind]?.label ?? 'Entry'}${d.sample ? ' (sample)' : ''}, ${d.date ? formatDate(d.date) : 'no date'}${e.broken ? ', has a problem' : ''}`),
      ),
      h('div', { class: 's-row__actions' }, e.broken ? null : linkButton(`#/edit/${encodeURIComponent(e.folder)}`, 'Edit', 'btn btn--small'), h('button', { type: 'button', class: 'btn btn--small btn--danger', onClick: () => deleteDialog({ kind: 'entry', item: e }) }, 'Delete')),
    );
  };
  const credRow = (c) =>
    h(
      'li',
      { class: 's-row' },
      h('div', { class: 's-row__text' }, h('span', { class: 'label' }, docId('credential', c.data.number) || 'No number'), h('strong', null, c.data.title || c.folder), h('span', { class: 's-row__meta' }, c.data.issuer ?? '')),
      h('div', { class: 's-row__actions' }, linkButton(`#/credential/edit/${encodeURIComponent(c.folder)}`, 'Edit', 'btn btn--small'), h('button', { type: 'button', class: 'btn btn--small btn--danger', onClick: () => deleteDialog({ kind: 'credential', item: c }) }, 'Delete')),
    );

  screen(
    'Your portfolio',
    h('h1', null, 'Your portfolio'),
    hasSample ? notice('info', 'You still have sample entries.', 'Delete them when you have added your own. While every entry on the site is a sample, search engines are asked not to list it.') : null,
    drafts.length
      ? h(
          'section',
          { class: 's-section', 'aria-labelledby': 'drafts-h' },
          h('h2', { id: 'drafts-h' }, 'Unfinished drafts'),
          h('ul', { class: 's-list' }, drafts.map(draftRow)),
        )
      : null,
    h('p', null, linkButton('#/new', 'New entry', 'btn btn--primary')),
    h('section', { class: 's-section', 'aria-labelledby': 'entries-h' }, h('h2', { id: 'entries-h' }, 'Entries'), repo.entries.length ? h('ul', { class: 's-list' }, repo.entries.map(entryRow)) : h('p', { class: 'empty' }, 'No entries yet.')),
    h('section', { class: 's-section', 'aria-labelledby': 'cred-h' }, h('h2', { id: 'cred-h' }, 'Credentials'), repo.credentials.length ? h('ul', { class: 's-list' }, repo.credentials.map(credRow)) : h('p', { class: 'empty' }, 'No credentials yet.'), h('p', null, linkButton('#/credential/new', 'Add a credential', 'btn btn--small'))),
    h('section', { class: 's-section', 'aria-labelledby': 'about-h' }, h('h2', { id: 'about-h' }, 'About you'), h('p', null, 'Your name, headline, contact details, portrait and About text.'), h('p', null, linkButton('#/profile', 'Edit profile and About', 'btn btn--small'))),
  );
}

/* ---------- Publishing and watching the build ---------- */

async function runCommit({ message, changes, heading }) {
  busy = true;
  const bar = h('progress', { max: 100, value: 0 });
  const status = h('p', { role: 'status' }, 'Starting…');
  screen('Publishing', h('h1', null, heading), status, bar, h('p', { class: 'field__hint' }, 'Keep this page open until it says your change is saved.'));
  try {
    const { sha } = await client.commit({
      message,
      changes,
      onProgress: (p) => {
        if (p.phase === 'upload') {
          status.textContent = p.total ? `Uploading ${Math.min(p.done + 1, p.total)} of ${p.total}…` : 'Preparing…';
          bar.value = p.total ? Math.round((p.done / p.total) * 85) : 40;
        } else {
          status.textContent = 'Saving to GitHub…';
          bar.value = 92;
        }
      },
    });
    repo = null;
    return sha;
  } finally {
    busy = false;
  }
}

async function watchBuild(sha, my, onTick) {
  const interval = Number(config.pollMs) || 8000;
  const started = Date.now();
  const checked = new Map();
  for (;;) {
    if (my !== routeId) return 'left';
    let info = null;
    try {
      const res = await fetch(`../build.json?x=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) info = await res.json();
    } catch {
      info = null;
    }
    if (info?.commit) {
      if (info.commit === sha) return 'live';
      // One question to GitHub per distinct live version: "does it contain my change?"
      if (!checked.has(info.commit)) checked.set(info.commit, await client.includesCommit(sha, info.commit));
      if (checked.get(info.commit)) return 'live';
    }
    if (Date.now() - started > 10 * 60 * 1000) return 'slow';
    onTick?.(Math.round((Date.now() - started) / 1000));
    await sleep(interval);
  }
}

async function showPublished({ heading, detail, pageHref, sha }) {
  const my = routeId;
  const state = h('p', { role: 'status', class: 'build-state' }, 'Your site is rebuilding. This usually takes one to three minutes.');
  const open = h('p', { hidden: true }, linkButton(pageHref ?? '../', pageHref ? 'Open the page' : 'Open the site', 'btn btn--primary'));
  screen(
    heading,
    h('h1', null, heading),
    notice('ok', 'Saved to GitHub', detail),
    state,
    open,
    h('p', null, linkButton('#/', 'Back to all entries', 'btn')),
  );
  const result = await watchBuild(sha, my);
  if (result === 'live') {
    state.textContent = 'Live. Your change is on the site.';
    open.hidden = false;
    announce('Your change is live.');
  } else if (result === 'slow') {
    state.replaceChildren('This is taking longer than usual. Your change is saved. You can see the build on the ', h('a', { href: `https://github.com/${auth.owner}/${auth.repo}/actions`, rel: 'noopener noreferrer' }, 'Actions page on GitHub'), '.');
    open.hidden = false;
  }
}

function showFailure(err, back) {
  screen('Not saved', h('h1', null, 'Not saved'), errorNotice(err), h('p', null, 'Nothing was changed on your site.'), h('p', null, h('button', { type: 'button', class: 'btn btn--primary', onClick: back }, 'Back to editing')));
}

/* ---------- Deleting ---------- */

function deleteDialog({ kind, item }) {
  const d = item.data;
  const id = kind === 'entry' ? docId(d.kind, d.number) : docId('credential', d.number);
  const word = id || 'delete';
  const input = h('input', { id: 'confirm-word', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'confirm-hint' });
  const go = h('button', { type: 'button', class: 'btn btn--danger', disabled: true }, 'Delete for good');
  const dialog = h(
    'dialog',
    { class: 's-dialog', 'aria-labelledby': 'del-h' },
    h('h2', { id: 'del-h' }, `Delete ${id ? `${id}: ` : ''}${d.title || item.folder}?`),
    h('p', null, 'This takes it off your live site. GitHub keeps the old version in the history of your repository, so if a photo should never have been shared, the repository itself must be cleaned too.'),
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'confirm-word' }, `Type ${word} to confirm`), h('p', { class: 'field__hint', id: 'confirm-hint' }, 'This stops a delete by accident.'), input),
    h('div', { class: 's-actions' }, h('button', { type: 'button', class: 'btn', onClick: () => dialog.close() }, 'Cancel'), go),
  );
  input.addEventListener('input', () => {
    go.disabled = input.value.trim().toLowerCase() !== word.toLowerCase();
  });
  go.addEventListener('click', async () => {
    dialog.close();
    const my = routeId;
    const changes = item.files.map((f) => ({ path: f.path, remove: true }));
    try {
      const sha = await runCommit({ message: `Delete ${id ? `${id}: ` : ''}${d.title || item.folder}`.slice(0, 72), changes, heading: 'Deleting' });
      if (kind === 'entry') await deleteDraft(`entry:edit:${item.folder}`);
      await showPublished({ heading: 'Deleted', detail: `${d.title || item.folder} is removed from your site.`, pageHref: null, sha });
    } catch (err) {
      if (my === routeId) showFailure(err, () => route());
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  input.focus();
}

/* ---------- Entry editor ---------- */

const defaultSections = () => ['What I saw', 'What I checked', 'What I learned'].map((heading) => ({ heading, text: '', photos: [] }));

function blankModel() {
  return {
    mode: 'new',
    folder: null,
    baseSha: null,
    number: null,
    revisions: [],
    sample: false,
    keepSample: false,
    extra: {},
    fields: { title: '', kind: 'site-note', date: todayISO(), summary: '', place: '', stage: '', topics: [], tools: [], links: [], featured: false, permission: false, privacyChecked: false },
    intro: { text: '', photos: [] },
    sections: defaultSections(),
    cover: '',
    revisionNote: '',
    minor: false,
    originalFiles: [],
  };
}

function modelFromEntry(entry) {
  const d = entry.data;
  const { intro, sections } = parseSections(entry.body);
  const photo = (p) => ({ id: uid('p'), source: 'repo', file: p.file, alt: p.alt, caption: p.caption, previewUrl: repo.photoMap[`${entry.dir}/${p.file}`] ?? '' });
  const model = {
    mode: 'edit',
    folder: entry.folder,
    baseSha: entry.indexSha,
    number: d.number ?? null,
    revisions: Array.isArray(d.revisions) ? d.revisions : [],
    sample: d.sample === true,
    keepSample: d.sample === true,
    extra: Object.fromEntries(Object.entries(d).filter(([k]) => !SCHEMA.entry.order.includes(k))),
    fields: {
      title: d.title ?? '',
      kind: d.kind ?? 'site-note',
      date: d.date ?? todayISO(),
      summary: d.summary ?? '',
      place: d.place ?? '',
      stage: d.stage ?? '',
      topics: d.topics ?? [],
      tools: d.tools ?? [],
      links: d.links ?? [],
      featured: d.featured === true,
      permission: d.permission === true,
      privacyChecked: d.privacyChecked === true,
    },
    intro: { text: intro.text, photos: intro.photos.map(photo) },
    sections: sections.map((s) => ({ heading: s.heading, text: s.text, photos: s.photos.map(photo) })),
    cover: '',
    revisionNote: '',
    minor: false,
    originalFiles: [],
  };
  const all = [...model.intro.photos, ...model.sections.flatMap((s) => s.photos)];
  model.originalFiles = all.map((p) => p.file);
  model.cover = all.find((p) => p.file === d.cover)?.id ?? '';
  return model;
}

async function reviveModel(saved, key) {
  const model = structuredClone(saved);
  let lost = 0;
  const fix = async (list) => {
    const out = [];
    for (const p of list) {
      if (p.busy) continue;
      if (p.source !== 'new') {
        out.push(p);
        continue;
      }
      const blob = await loadBlob(key, p.id);
      if (!blob) {
        lost += 1;
        continue;
      }
      out.push({ ...p, blob, stored: true, previewUrl: URL.createObjectURL(blob) });
    }
    return out;
  };
  model.intro.photos = await fix(model.intro.photos);
  for (const s of model.sections) s.photos = await fix(s.photos);
  return { model, lost };
}

const cleanText = (t) =>
  String(t ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();

// "![" is how the site writes a photo. Typed by hand, it would make the build stop.
const hasPhotoSyntax = (t) => t.includes('![');
const PHOTO_SYNTAX_MESSAGE = 'contains the characters ![ which the site uses for photos. Use "Add photos" instead, or remove those characters.';

const PREVIEW_PLACEHOLDER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067" viewBox="0 0 1600 1067"><rect width="1600" height="1067" fill="#e9ebe8"/><text x="800" y="533" font-family="sans-serif" font-size="44" text-anchor="middle" fill="#4f5a61">Preview not available until this photo is published</text></svg>',
)}`;

async function entryEditor({ mode, folder }) {
  const my = routeId;
  const entry = mode === 'edit' ? repo.entries.find((e) => e.folder === folder) : null;
  if (mode === 'edit' && (!entry || entry.broken)) {
    return screen('Not found', h('h1', null, 'That entry cannot be edited here'), notice('error', 'It was not found, or its file has a mistake in it.', 'Open it on GitHub to fix the file, or delete it from the list.'), linkButton('#/', 'Back to all entries'));
  }
  const key = mode === 'new' ? 'entry:new' : `entry:edit:${folder}`;
  let model = mode === 'new' ? blankModel() : modelFromEntry(entry);
  let restored = null;
  let lostPhotos = 0;
  const draft = await loadDraft(key);
  if (my !== routeId) return;
  if (draft?.value && (mode === 'new' || draft.value.baseSha === entry.indexSha)) {
    const revived = await reviveModel(draft.value, key);
    if (my !== routeId) return;
    model = revived.model;
    lostPhotos = revived.lost;
    restored = draft.savedAt;
  }

  /* fields */
  const refs = {};
  let saveTimer = null;
  let closed = false;
  let working = false;
  const status = h('p', { class: 's-status' });
  const defs = SCHEMA.entry.fields.filter((f) => !f.system);
  const syncFields = () => {
    for (const [k, ref] of Object.entries(refs)) model.fields[k] = ref.read();
  };
  // What goes into a draft: everything except the photo files themselves, which are stored once, separately.
  const snapshot = () => {
    syncFields();
    const strip = (list) =>
      list
        .filter((p) => !p.busy && (p.source === 'repo' || p.stored))
        .map((p) => {
          const { blob, ...rest } = p;
          return p.source === 'new' ? { ...rest, previewUrl: '' } : rest;
        });
    return structuredClone({ ...model, intro: { ...model.intro, photos: strip(model.intro.photos) }, sections: model.sections.map((s) => ({ ...s, photos: strip(s.photos) })) });
  };
  let dirty = false;
  const save = async () => {
    if (closed) return;
    dirty = false;
    const ok = await saveDraft(key, snapshot());
    status.textContent = ok ? 'Draft saved on this device.' : 'This browser cannot keep drafts. Publish before you close the page.';
  };
  const touch = () => {
    if (closed) return;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1000);
  };
  // Leaving the screen, locking the phone or closing the tab saves the draft straight away.
  flushDraft = () => {
    clearTimeout(saveTimer);
    if (dirty) save();
  };
  for (const def of defs) refs[def.key] = buildField(def, model.fields[def.key], { onInput: touch });
  if (mode === 'edit') for (const input of refs.kind.el.querySelectorAll('input')) input.disabled = true;

  /* photos and text */
  const blocksEl = h('div', { class: 's-blocks' });
  const problemsBox = h('div', { class: 's-problems', tabindex: '-1' });
  const allPhotos = () => [...model.intro.photos, ...model.sections.flatMap((s) => s.photos)].filter((p) => !p.busy);
  const coverId = () => model.cover || allPhotos()[0]?.id || '';

  function renderBlocks(focusKeys) {
    blocksEl.replaceChildren(
      blockEl(model.intro, { intro: true }),
      ...model.sections.map((s, i) => blockEl(s, { index: i })),
      h('p', null, h('button', { type: 'button', class: 'btn', onClick: () => { model.sections.push({ heading: '', text: '', photos: [] }); renderBlocks(`section-heading-${model.sections.length - 1}`); touch(); } }, 'Add a section')),
    );
    for (const k of [focusKeys].flat().filter(Boolean)) {
      const el = blocksEl.querySelector(`[data-key="${k}"]`);
      if (el && !el.disabled) {
        el.focus();
        break;
      }
    }
  }

  async function addFiles(block, fileList) {
    const files = [...fileList];
    const slots = files.map((f) => ({ id: uid('p'), source: 'new', busy: true, name: f.name, file: '', alt: '', caption: '' }));
    block.photos.push(...slots);
    renderBlocks();
    for (const [i, file] of files.entries()) {
      const slot = slots[i];
      try {
        const done = await preparePhoto(file);
        const stored = await saveBlob(key, slot.id, done.blob);
        Object.assign(slot, { busy: false, blob: done.blob, stored, width: done.width, height: done.height, previewUrl: done.previewUrl });
        announce(`Photo ${i + 1} of ${files.length} is ready.`);
      } catch (err) {
        block.photos = block.photos.filter((p) => p !== slot);
        problemsBox.replaceChildren(notice('error', err instanceof PhotoError ? err.message : `"${file.name}" could not be added.`));
      }
      renderBlocks();
      touch();
    }
  }

  function photoCard(block, bk, p, index) {
    const ids = { cap: `cap-${p.id}`, alt: `alt-${p.id}` };
    const move = (by) => {
      const to = index + by;
      if (to < 0 || to >= block.photos.length) return;
      [block.photos[index], block.photos[to]] = [block.photos[to], block.photos[index]];
      const first = by < 0 ? 'earlier' : 'later';
      renderBlocks([`photo-${p.id}-${first}`, `photo-${p.id}-${first === 'earlier' ? 'later' : 'earlier'}`]);
      touch();
    };
    if (p.busy) return h('li', { class: 'photo', 'aria-busy': 'true' }, h('div', { class: 'photo__img' }, 'Preparing…'), h('p', { class: 'photo__name' }, p.name));
    return h(
      'li',
      { class: 'photo' },
      p.previewUrl ? h('img', { class: 'photo__img', src: p.previewUrl, alt: '' }) : h('div', { class: 'photo__img' }, p.file),
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.cap }, 'Caption (required)'), h('textarea', { id: ids.cap, rows: 2, value: p.caption, placeholder: 'Reinforcement at the column base', onInput: (e) => { p.caption = e.target.value; touch(); } })),
      h(
        'div',
        { class: 'field' },
        h('label', { class: 'field__label', for: ids.alt }, 'Description for people who cannot see it (required)'),
        h('textarea', { id: ids.alt, rows: 2, value: p.alt, placeholder: 'Steel bars tied with wire inside a timber form', onInput: (e) => { p.alt = e.target.value; touch(); } }),
        h('button', { type: 'button', class: 'linklike', onClick: () => { p.alt = p.caption; document.getElementById(ids.alt).value = p.caption; touch(); } }, 'Use the caption'),
      ),
      h('label', { class: 'check check--small' }, h('input', { type: 'radio', name: 'cover', checked: coverId() === p.id, onChange: () => { model.cover = p.id; touch(); } }), h('span', null, 'Cover photo')),
      h(
        'div',
        { class: 's-actions s-actions--tight' },
        h('button', { type: 'button', class: 'btn btn--small', 'data-key': `photo-${p.id}-earlier`, disabled: index === 0, onClick: () => move(-1) }, 'Earlier'),
        h('button', { type: 'button', class: 'btn btn--small', 'data-key': `photo-${p.id}-later`, disabled: index === block.photos.length - 1, onClick: () => move(1) }, 'Later'),
        h('button', { type: 'button', class: 'btn btn--small btn--danger', onClick: () => { block.photos = block.photos.filter((x) => x !== p); if (model.cover === p.id) model.cover = ''; renderBlocks(`add-${bk}`); touch(); } }, 'Remove'),
      ),
    );
  }

  function blockEl(block, { intro = false, index = 0 } = {}) {
    const bk = intro ? 'intro' : String(index);
    const textId = uid('text');
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, 'data-test': 'file', onChange: (e) => { const files = e.target.files; if (files?.length) addFiles(block, files); e.target.value = ''; } });
    const root = h('section', { class: 's-block', 'aria-label': intro ? 'Opening text' : `Section ${index + 1}` });
    if (!intro) {
      const hid = uid('head');
      root.append(h('div', { class: 'field' }, h('label', { class: 'field__label', for: hid }, 'Heading'), h('input', { id: hid, type: 'text', value: block.heading, placeholder: 'What I saw', 'data-key': `section-heading-${index}`, onInput: (e) => { block.heading = e.target.value; touch(); } })));
    }
    root.append(h('div', { class: 'field' }, h('label', { class: 'field__label', for: textId }, intro ? 'Opening text (optional)' : 'Text'), h('textarea', { id: textId, rows: intro ? 4 : 7, value: block.text, onInput: (e) => { block.text = e.target.value; touch(); } })));
    if (block.photos.length) root.append(h('ul', { class: 'photos' }, block.photos.map((p, i) => photoCard(block, bk, p, i))));
    root.append(h('div', { class: 's-actions' }, h('button', { type: 'button', class: 'btn', 'data-key': `add-${bk}`, onClick: () => fileInput.click() }, 'Add photos'), fileInput));
    if (!intro) {
      const swap = (to) => {
        [model.sections[index], model.sections[to]] = [model.sections[to], model.sections[index]];
        renderBlocks();
        touch();
      };
      root.append(
        h(
          'div',
          { class: 's-actions s-actions--tight' },
          h('button', { type: 'button', class: 'btn btn--small', disabled: index === 0, onClick: () => swap(index - 1) }, 'Move section up'),
          h('button', { type: 'button', class: 'btn btn--small', disabled: index === model.sections.length - 1, onClick: () => swap(index + 1) }, 'Move section down'),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn--small btn--danger',
              onClick: () => {
                if ((block.text.trim() || block.photos.length) && !confirm('Remove this section and its photos?')) return;
                model.sections.splice(index, 1);
                renderBlocks();
                touch();
              },
            },
            'Remove section',
          ),
        ),
      );
    }
    return root;
  }

  /* checks: the same rules the build applies, so a published entry never stops the build */
  function validate() {
    syncFields();
    const problems = [];
    const add = (message, focus) => problems.push({ message, focus });
    for (const ref of Object.values(refs)) ref.setError('');
    for (const v of validateFields('entry', model.fields)) {
      refs[v.field]?.setError(v.message);
      add(v.message, () => refs[v.field]?.focus());
    }
    if (model.fields.featured) {
      const others = repo.entries.filter((e) => e.data.featured === true && e.folder !== folder).length;
      if (others >= LIMITS.featured) add(`Only ${LIMITS.featured} entries can be shown on the home page, and ${others} already are. Untick this box, or untick another entry first.`, () => refs.featured?.focus());
    }
    const headFocus = (i) => () => blocksEl.querySelector(`[data-key="section-heading-${i}"]`)?.focus();
    if (hasPhotoSyntax(model.intro.text)) add(`The opening text ${PHOTO_SYNTAX_MESSAGE}`);
    model.sections.forEach((s, i) => {
      const head = s.heading.trim();
      if (!head) add(`Section ${i + 1} needs a heading, or remove the section.`, headFocus(i));
      else if ([...head].length > 80) add(`The heading "${head.slice(0, 20)}…" is too long. The limit is 80 characters.`, headFocus(i));
      if (!s.text.trim() && !s.photos.length) add(`The section "${head || i + 1}" is empty. Add text or a photo, or remove it.`, headFocus(i));
      if (hasPhotoSyntax(s.text)) add(`The section "${head || i + 1}" ${PHOTO_SYNTAX_MESSAGE}`, headFocus(i));
    });
    const photos = [...model.intro.photos, ...model.sections.flatMap((s) => s.photos)];
    if (photos.some((p) => p.busy)) add('A photo is still being prepared. Wait a moment and try again.');
    photos.filter((p) => !p.busy).forEach((p, i) => {
      const label = `Photo ${i + 1}`;
      const focusCap = () => document.getElementById(`cap-${p.id}`)?.focus();
      const focusAlt = () => document.getElementById(`alt-${p.id}`)?.focus();
      if (!p.caption.trim()) add(`${label} needs a caption.`, focusCap);
      else if ([...p.caption].length > LIMITS.descriptionChars) add(`The caption of ${label} is too long. The limit is ${LIMITS.descriptionChars} characters.`, focusCap);
      if (!p.alt.trim()) add(`${label} needs a description for people who cannot see it.`, focusAlt);
      else if ([...p.alt].length > LIMITS.descriptionChars) add(`The description of ${label} is too long. The limit is ${LIMITS.descriptionChars} characters.`, focusAlt);
    });
    if (photos.length > LIMITS.photosPerEntry) add(`An entry can have at most ${LIMITS.photosPerEntry} photos. Split it into two entries.`);
    if (!model.intro.text.trim() && !model.sections.some((s) => s.text.trim()) && !photos.length) add('Add some text or at least one photo.');
    if (mode === 'edit' && !model.minor) {
      const n = [...model.revisionNote.trim()].length;
      if (n < 3) add('Say what changed, in a few words. Or tick "Minor fix" if nothing worth recording changed.', () => document.getElementById('rev-note')?.focus());
      else if (n > 140) add('"What changed" is too long. The limit is 140 characters.', () => document.getElementById('rev-note')?.focus());
    }
    return problems;
  }

  function showProblems(problems) {
    if (!problems.length) return problemsBox.replaceChildren();
    problemsBox.replaceChildren(
      h(
        'div',
        { class: 'notice notice--error', role: 'alert' },
        h('strong', null, `Fix ${problems.length === 1 ? 'this' : 'these'} before publishing`),
        h('ul', null, problems.map((p) => h('li', null, p.focus ? h('button', { type: 'button', class: 'linklike', onClick: p.focus }, p.message) : p.message))),
      ),
    );
    problemsBox.focus();
  }

  /* what will be committed */
  function assemble() {
    const f = model.fields;
    const isNew = mode === 'new';
    const today = todayISO();
    const kind = f.kind;
    const live = isNew ? null : repo.entries.find((e) => e.folder === folder);
    const number = isNew ? 1 + Math.max(0, ...repo.entries.filter((e) => e.data.kind === kind).map((e) => e.data.number ?? 0)) : model.number;
    let dirName = folder;
    if (isNew) {
      const taken = new Set([...repo.entries.map((e) => slugFromFolder(e.folder)), ...Object.values(KINDS).map((k) => k.section)]);
      const base = slugify(f.title) || 'entry';
      let slug = base;
      for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
      dirName = folderName(f.date, slug);
    }
    const dir = `content/entries/${dirName}`;
    const existing = new Set(isNew ? [] : live.files.map((x) => x.name));
    let n = 0;
    const finalize = (list) =>
      list.map((p) => {
        n += 1;
        if (p.source === 'new') {
          const first = photoFileName(n, p.caption, 'jpg');
          let name = first;
          for (let i = 2; existing.has(name); i++) name = first.replace(/\.jpg$/, `-${i}.jpg`);
          existing.add(name);
          p.file = name;
        }
        return { file: p.file, alt: p.alt.trim(), caption: p.caption.trim(), ref: p };
      });
    const intro = { text: cleanText(model.intro.text), photos: finalize(model.intro.photos) };
    const sections = model.sections.map((s) => ({ heading: s.heading.trim(), text: cleanText(s.text), photos: finalize(s.photos) }));
    const finals = [...intro.photos, ...sections.flatMap((s) => s.photos)];
    const coverPhoto = model.cover ? finals.find((x) => x.ref.id === model.cover) : null;

    let revisions = model.revisions;
    if (isNew) revisions = [{ rev: 'A', date: today, note: 'First issue' }];
    else if (!model.minor) revisions = [...model.revisions, { rev: nextRevision(model.revisions.at(-1)?.rev), date: today, note: model.revisionNote.trim() }];

    const data = {
      ...model.extra,
      title: f.title,
      kind,
      number,
      date: f.date,
      summary: f.summary,
      place: f.place,
      stage: f.stage,
      topics: f.topics,
      tools: f.tools,
      links: f.links,
      cover: coverPhoto && coverPhoto !== finals[0] ? coverPhoto.file : '',
      permission: true,
      privacyChecked: true,
      revisions,
    };
    if (f.featured) data.featured = true;
    if (!isNew && model.sample && model.keepSample) data.sample = true;

    const changes = [{ path: `${dir}/index.md`, text: composeDocument(data, buildBody({ intro, sections }), SCHEMA.entry.order) }];
    for (const x of finals) if (x.ref.source === 'new') changes.push({ path: `${dir}/${x.file}`, blob: x.ref.blob });
    const keep = new Set(finals.map((x) => x.file));
    for (const name of model.originalFiles) if (!keep.has(name)) changes.push({ path: `${dir}/${name}`, remove: true });
    const id = docId(kind, number);
    return { changes, id, slug: slugFromFolder(dirName), message: `${isNew ? 'Add' : 'Update'} ${id}: ${f.title}`.slice(0, 72), title: f.title };
  }

  const titleText = () => (mode === 'new' ? 'New entry' : `Edit ${docId(model.fields.kind, model.number) || folder}`);
  const publishButton = h('button', { type: 'button', class: 'btn btn--primary', onClick: () => publish() }, mode === 'new' ? 'Publish' : 'Publish changes');

  async function publish() {
    if (busy || working) return;
    const problems = validate();
    showProblems(problems);
    if (problems.length) return;
    working = true;
    publishButton.disabled = true;
    status.textContent = 'Checking GitHub…';
    const resume = () => {
      working = false;
      publishButton.disabled = false;
      status.textContent = '';
    };
    try {
      // Someone (you, on another device) may have changed the site since this page was opened.
      const head = await client.getHead();
      if (head.commitSha !== repo.head.commitSha) {
        await loadRepo();
        if (mode === 'edit') {
          const now = repo.entries.find((e) => e.folder === folder);
          if (!now) throw new Error('This entry was deleted somewhere else, so it cannot be saved here.');
          if (now.indexSha !== model.baseSha) throw new Error('This entry was changed somewhere else after you opened it. Your draft is kept on this device. Go back to the list and open the entry again to see the new version.');
        }
      }
    } catch (err) {
      resume();
      problemsBox.replaceChildren(errorNotice(err));
      problemsBox.focus();
      return;
    }
    // Whatever happens next, the draft on this device is up to date first.
    clearTimeout(saveTimer);
    if (dirty) await save();
    closed = true;
    const plan = assemble();
    const back = () => {
      closed = false;
      resume();
      showEditor();
    };
    try {
      const sha = await runCommit({ message: plan.message, changes: plan.changes, heading: 'Publishing' });
      await deleteDraft(key);
      await showPublished({
        heading: mode === 'new' ? 'Published' : 'Updated',
        detail: `${plan.id}: ${plan.title} is saved.`,
        pageHref: `../work/${plan.slug}/`,
        sha,
      });
    } catch (err) {
      showFailure(err, back);
    }
  }

  /* preview: drawn by the same code that draws the real page */
  function preview() {
    syncFields();
    const names = new Map();
    const tag = (list) =>
      list
        .filter((p) => !p.busy)
        .map((p) => {
          const file = `${p.id}.jpg`;
          names.set(file, p);
          return { file, alt: p.alt.trim() || 'Photo', caption: p.caption.trim() || 'Photo' };
        });
    const markdown = buildBody({
      intro: { text: cleanText(model.intro.text), photos: tag(model.intro.photos) },
      sections: model.sections.map((s) => ({ heading: s.heading.trim() || 'Untitled section', text: cleanText(s.text), photos: tag(s.photos) })),
    });
    const { html } = renderBody(markdown, {
      base: '../',
      photo: (file) => {
        const p = names.get(file);
        if (!p) return null;
        return { file, width: p.width ?? 1600, height: p.height ?? 1067, avif: [], jpeg: [{ w: 960, url: p.previewUrl || PREVIEW_PLACEHOLDER }] };
      },
    });
    const prose = h('div', { class: 'prose' });
    prose.innerHTML = html; // made by the same renderer as the site, which escapes everything that was typed in
    prose.addEventListener('click', (e) => {
      if (e.target.closest('a[data-lightbox]')) e.preventDefault();
    });
    const f = model.fields;
    screen(
      'Preview',
      h('h1', null, 'Preview'),
      notice('info', 'This is a preview.', 'On the live page, the number, kind, date and details appear in a block beside the text.'),
      h('article', { class: 'sheet sheet--preview' }, h('header', { class: 'sheet__head' }, h('h2', { class: 'preview-title' }, f.title || 'Untitled'), h('p', { class: 'summary' }, f.summary)), prose),
      h('p', null, h('button', { type: 'button', class: 'btn btn--primary', onClick: () => showEditor() }, 'Back to editing')),
    );
  }

  /* put the screen together */
  const mainDefs = defs.filter((d) => d.type !== 'confirm');
  const lastDefs = defs.filter((d) => d.type === 'confirm');
  const editorNodes = [
    h('p', null, linkButton('#/', 'All entries', 'linklike')),
    h('h1', null, titleText()),
    restored ? notice('info', 'Your unfinished draft is back.', `Saved on this device, ${when(restored)}.`) : null,
    lostPhotos ? notice('error', `${lostPhotos === 1 ? 'One photo' : `${lostPhotos} photos`} from the draft could not be restored.`, 'Add them again with "Add photos".') : null,
    mode === 'edit' && model.sample ? notice('info', 'This is a sample entry.', 'Delete it from the list, or turn it into your own entry and untick the box near the bottom.') : null,
    h(
      'form',
      { class: 's-form', novalidate: true, onSubmit: (e) => e.preventDefault() },
      h(
        'section',
        { class: 's-section', 'aria-labelledby': 'about-entry' },
        h('h2', { id: 'about-entry' }, 'About this entry'),
        mainDefs.map((d) => refs[d.key].el),
        mode === 'edit' ? h('p', { class: 'field__hint' }, 'The kind cannot be changed after publishing. To change it, delete this entry and add a new one.') : null,
      ),
      h(
        'section',
        { class: 's-section', 'aria-labelledby': 'text-h' },
        h('h2', { id: 'text-h' }, 'Text and photos'),
        h('p', { class: 'field__hint' }, 'Write short paragraphs with a blank line between them. Start a line with - to make a list. To add a link, write [the words](https://the-address). Each photo needs a caption, which is shown under it, and a description, which is read aloud to people who cannot see it. Photos are shrunk on your device and their location data is removed before anything is sent.'),
        blocksEl,
      ),
      h(
        'section',
        { class: 's-section', 'aria-labelledby': 'final-h' },
        h('h2', { id: 'final-h' }, 'Before you publish'),
        lastDefs.map((d) => refs[d.key].el),
        mode === 'edit' && model.sample
          ? h('div', { class: 'field field--check' }, h('label', { class: 'check', for: 'keep-sample' }, h('input', { id: 'keep-sample', type: 'checkbox', checked: model.keepSample, onChange: (e) => { model.keepSample = e.target.checked; touch(); } }), h('span', null, 'This is still a sample. It shows a Sample label on the page.')))
          : null,
        mode === 'edit'
          ? h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'rev-note' }, 'What changed?'), h('p', { class: 'field__hint' }, 'A few words. Shown in the revision record at the bottom of the page.'), h('input', { id: 'rev-note', type: 'text', value: model.revisionNote, placeholder: 'Added the second photo set', onInput: (e) => { model.revisionNote = e.target.value; touch(); } }))
          : null,
        mode === 'edit'
          ? h('div', { class: 'field field--check' }, h('label', { class: 'check', for: 'minor' }, h('input', { id: 'minor', type: 'checkbox', checked: model.minor, onChange: (e) => { model.minor = e.target.checked; touch(); } }), h('span', null, 'Minor fix. Do not record a new revision.')))
          : null,
      ),
      problemsBox,
      h('div', { class: 's-actions' }, h('button', { type: 'button', class: 'btn', onClick: preview }, 'Preview'), publishButton),
      status,
    ),
    mode === 'edit'
      ? h('section', { class: 's-section s-danger', 'aria-labelledby': 'danger-h' }, h('h2', { id: 'danger-h' }, 'Delete this entry'), h('p', null, 'This takes it off your live site.'), h('button', { type: 'button', class: 'btn btn--danger', onClick: () => deleteDialog({ kind: 'entry', item: entry }) }, 'Delete entry'))
      : null,
  ];
  const showEditor = () => {
    screen(titleText(), ...editorNodes);
    renderBlocks();
  };
  showEditor();
  if (restored) status.textContent = 'Draft restored from this device.';
}

/* ---------- Profile ---------- */

function problemsNotice(title, problems, refs) {
  return h(
    'div',
    { class: 'notice notice--error', role: 'alert' },
    h('strong', null, title),
    h('ul', null, problems.map((p) => h('li', null, refs?.[p.field] ? h('button', { type: 'button', class: 'linklike', onClick: () => refs[p.field].focus() }, p.message) : p.message))),
  );
}

function profileEditor() {
  const doc = repo.profile;
  if (!doc) return screen('Profile', h('h1', null, 'Profile'), notice('error', 'The profile file was not found.', 'Check that content/profile/index.md exists in your repository.'), linkButton('#/', 'Back'));
  const d = doc.data;
  const defs = SCHEMA.profile.fields.filter((f) => f.key !== 'portrait');
  const basic = defs.filter((f) => !['cv', 'siteUrl'].includes(f.key));
  const advanced = defs.filter((f) => ['cv', 'siteUrl'].includes(f.key));
  const refs = {};
  for (const def of defs) refs[def.key] = buildField(def, d[def.key] ?? '', {});
  const messages = h('div', { class: 's-problems', tabindex: '-1' });
  const about = h('textarea', { id: 'about', rows: 10, value: doc.body.trim() });
  const portrait = { file: d.portrait ?? '', blob: null, previewUrl: d.portrait ? repo.photoMap[`${doc.dir}/${d.portrait}`] ?? '' : '', remove: false };
  const portraitBox = h('div', { class: 'portrait-box' });
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    hidden: true,
    'data-test': 'file',
    onChange: async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const done = await preparePhoto(file, { maxSide: 1200 });
        Object.assign(portrait, { blob: done.blob, previewUrl: done.previewUrl, remove: false });
        drawPortrait();
      } catch (err) {
        messages.replaceChildren(notice('error', err.message));
      }
    },
  });
  const drawPortrait = () => {
    const has = !portrait.remove && (portrait.blob || portrait.file);
    portraitBox.replaceChildren(
      has ? (portrait.previewUrl ? h('img', { class: 'photo__img portrait-img', src: portrait.previewUrl, alt: 'Your portrait' }) : h('p', null, `Current portrait: ${portrait.file}`)) : h('p', { class: 'field__hint' }, 'No portrait.'),
      h(
        'div',
        { class: 's-actions s-actions--tight' },
        h('button', { type: 'button', class: 'btn btn--small', onClick: () => fileInput.click() }, has ? 'Choose another photo' : 'Choose a photo'),
        has ? h('button', { type: 'button', class: 'btn btn--small btn--danger', onClick: () => { portrait.remove = true; portrait.blob = null; drawPortrait(); } }, 'Remove') : null,
      ),
    );
  };
  drawPortrait();

  let working = false;
  const saveButton = h('button', { type: 'button', class: 'btn btn--primary', onClick: () => publish() }, 'Save and publish');
  const publish = async () => {
    if (busy || working) return;
    const fields = Object.fromEntries(Object.entries(refs).map(([k, r]) => [k, r.read()]));
    for (const r of Object.values(refs)) r.setError('');
    const keepFile = portrait.remove ? '' : portrait.blob ? 'portrait.jpg' : portrait.file;
    const problems = validateFields('profile', { ...fields, portrait: keepFile });
    for (const v of problems) refs[v.field]?.setError(v.message);
    if (hasPhotoSyntax(about.value)) problems.push({ field: 'about', message: `The About text ${PHOTO_SYNTAX_MESSAGE}` });
    if (problems.length) {
      messages.replaceChildren(problemsNotice('Fix these before saving', problems, { ...refs, about: { focus: () => about.focus() } }));
      messages.focus();
      return;
    }
    messages.replaceChildren();
    const data = { ...Object.fromEntries(Object.entries(d).filter(([k]) => !SCHEMA.profile.order.includes(k))), ...fields, portrait: keepFile };
    const changes = [{ path: `${doc.dir}/index.md`, text: composeDocument(data, cleanText(about.value), SCHEMA.profile.order) }];
    if (portrait.blob) changes.push({ path: `${doc.dir}/portrait.jpg`, blob: portrait.blob });
    if (d.portrait && d.portrait !== keepFile) changes.push({ path: `${doc.dir}/${d.portrait}`, remove: true });
    working = true;
    saveButton.disabled = true;
    try {
      const sha = await runCommit({ message: 'Update profile and About text', changes, heading: 'Publishing' });
      await showPublished({ heading: 'Profile updated', detail: 'Your profile is saved.', pageHref: '../about/', sha });
    } catch (err) {
      showFailure(err, () => {
        working = false;
        saveButton.disabled = false;
        showForm();
      });
    }
  };

  const nodes = [
    h('p', null, linkButton('#/', 'All entries', 'linklike')),
    h('h1', null, 'Profile and About'),
    h(
      'form',
      { class: 's-form', novalidate: true, onSubmit: (e) => e.preventDefault() },
      h('section', { class: 's-section' }, basic.map((x) => refs[x.key].el)),
      h('section', { class: 's-section', 'aria-labelledby': 'portrait-h' }, h('h2', { id: 'portrait-h' }, 'Portrait'), portraitBox, fileInput),
      h('section', { class: 's-section', 'aria-labelledby': 'about-h2' }, h('h2', { id: 'about-h2' }, 'About text'), h('label', { class: 'field__label', for: 'about' }, 'Shown on the About page'), h('p', { class: 'field__hint' }, 'Short paragraphs with a blank line between them.'), about),
      h('details', { class: 'help' }, h('summary', null, 'Advanced'), advanced.map((x) => refs[x.key].el)),
      messages,
      h('div', { class: 's-actions' }, saveButton),
    ),
  ];
  const showForm = () => screen('Profile', ...nodes);
  showForm();
}

/* ---------- Credentials ---------- */

function credentialEditor({ mode, folder }) {
  const item = mode === 'edit' ? repo.credentials.find((c) => c.folder === folder) : null;
  if (mode === 'edit' && !item) return screen('Not found', h('h1', null, 'That credential was not found'), linkButton('#/', 'Back'));
  const d = item?.data ?? {};
  const defs = SCHEMA.credential.fields.filter((f) => !f.system);
  const refs = {};
  for (const def of defs) refs[def.key] = buildField(def, d[def.key] ?? '', {});
  const messages = h('div', { class: 's-problems', tabindex: '-1' });
  let working = false;
  const saveButton = h('button', { type: 'button', class: 'btn btn--primary', onClick: () => publish() }, 'Save and publish');
  const publish = async () => {
    if (busy || working) return;
    const fields = Object.fromEntries(Object.entries(refs).map(([k, r]) => [k, r.read()]));
    for (const r of Object.values(refs)) r.setError('');
    const problems = validateFields('credential', fields);
    if (fields.start && fields.end && fields.end < fields.start) problems.push({ field: 'end', message: 'End date is earlier than the start date.' });
    for (const v of problems) refs[v.field]?.setError(v.message);
    if (problems.length) {
      messages.replaceChildren(problemsNotice('Fix these before saving', problems, refs));
      messages.focus();
      return;
    }
    messages.replaceChildren();
    const isNew = mode === 'new';
    const number = isNew ? 1 + Math.max(0, ...repo.credentials.map((c) => c.data.number ?? 0)) : d.number;
    let dirName = folder;
    if (isNew) {
      const taken = new Set(repo.credentials.map((c) => c.folder));
      const base = slugify(fields.title) || 'credential';
      dirName = base;
      for (let i = 2; taken.has(dirName); i++) dirName = `${base}-${i}`;
    }
    const data = { ...Object.fromEntries(Object.entries(d).filter(([k]) => !SCHEMA.credential.order.includes(k))), ...fields, number };
    const path = `content/credentials/${dirName}/index.md`;
    working = true;
    saveButton.disabled = true;
    try {
      const sha = await runCommit({
        message: `${isNew ? 'Add' : 'Update'} ${docId('credential', number)}: ${fields.title}`.slice(0, 72),
        changes: [{ path, text: composeDocument(data, item?.body ?? '', SCHEMA.credential.order) }],
        heading: 'Publishing',
      });
      await showPublished({ heading: isNew ? 'Credential added' : 'Credential updated', detail: `${fields.title} is saved.`, pageHref: '../credentials/', sha });
    } catch (err) {
      showFailure(err, () => {
        working = false;
        saveButton.disabled = false;
        showForm();
      });
    }
  };
  const title = mode === 'new' ? 'Add a credential' : 'Edit credential';
  const nodes = [
    h('p', null, linkButton('#/', 'All entries', 'linklike')),
    h('h1', null, title),
    h('p', { class: 'field__hint' }, 'Do not add certificate numbers or scans. Only the title, who issued it and when.'),
    h('form', { class: 's-form', novalidate: true, onSubmit: (e) => e.preventDefault() }, defs.map((x) => refs[x.key].el), messages, h('div', { class: 's-actions' }, saveButton)),
  ];
  const showForm = () => screen(title, ...nodes);
  showForm();
}

/* ---------- Start ---------- */

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushDraft?.();
});
window.addEventListener('pagehide', () => flushDraft?.());
window.addEventListener('beforeunload', (e) => {
  if (busy) {
    e.preventDefault();
    e.returnValue = '';
  }
});
window.addEventListener('hashchange', () => {
  if (!busy) route();
});
// A link to the page you are already on (for example "Back to all entries" after a delete) changes nothing
// in the address, so the browser would do nothing. Show the page again instead.
document.addEventListener('click', (e) => {
  const link = e.target instanceof Element ? e.target.closest('a[href^="#/"]') : null;
  if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const target = link.getAttribute('href');
  if (target === location.hash || (target === '#/' && location.hash === '')) {
    e.preventDefault();
    if (!busy) route();
  }
});

try {
  const res = await fetch('./config.json', { cache: 'no-store' });
  config = await res.json();
} catch {
  config = { apiBase: 'https://api.github.com', branch: 'main', owner: '', repo: '' };
}
auth = readAuth();
if (auth && config.owner && config.repo && (auth.owner !== config.owner || auth.repo !== config.repo)) {
  // A token saved for a different repository must not be used here.
  clearAuth();
  auth = null;
}
route();
