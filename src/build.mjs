#!/usr/bin/env node
// Builds the whole website into the dist folder.
//
//   node src/build.mjs
//
// Nothing is written to dist unless every check in the content passes, so a
// mistake can never replace a working site with a broken one.

import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSite } from './config.mjs';
import { actionsAnnotations, formatReport } from './lib/errors.mjs';
import { loadContent } from './lib/content.mjs';
import { cspHash, fingerprint, minifyCss } from './lib/css.mjs';
import { buildInfo, robotsTxt, rssXml, sitemapXml } from './lib/feeds.mjs';
import { esc } from './lib/html.mjs';
import { renderBody } from './lib/markdown.mjs';
import { PhotoPipeline, mapLimit, shareImage } from './lib/photos.mjs';
import { KINDS } from './shared/schema.mjs';
import { entryPage } from './templates/entry.mjs';
import { renderDocument } from './templates/layout.mjs';
import { aboutPage, contactPage, credentialsPage, entryPath, homePage, notFoundPage, workPage } from './templates/pages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const exists = async (p) => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

// The build empties its output folder before it writes. So the output folder must never be the
// project, a folder around it, or any folder that holds the project's own files.
const PROTECTED_FOLDERS = ['.git', '.github', 'content', 'node_modules', 'public', 'scripts', 'src', 'tests'];

function guardOutput(root, out) {
  const resolved = path.resolve(out);
  const base = path.resolve(root);
  const within = (parent, child) => child === parent || child.startsWith(parent + path.sep);
  const unsafe =
    within(resolved, base) || // the project itself, or a folder that contains it
    resolved === path.parse(resolved).root ||
    PROTECTED_FOLDERS.some((name) => {
      const folder = path.join(base, name);
      return within(folder, resolved) || within(resolved, folder);
    });
  if (unsafe) throw new Error(`Refusing to build into "${resolved}" because it would erase the project's own files.`);
}

async function copyTree(from, to) {
  if (await exists(from)) await cp(from, to, { recursive: true });
}

/** Studio: the owner's add, edit and delete page. It is plain files, copied as they are. */
async function buildStudio({ root, out, site, env, css, photoMap }) {
  const src = path.join(root, 'src', 'studio');
  if (!(await exists(path.join(src, 'index.html')))) return false;
  const dest = path.join(out, 'studio');
  await copyTree(src, dest);

  const apiBase = env.STUDIO_API_BASE || 'https://api.github.com';
  const config = {
    owner: site.owner,
    repo: site.repo,
    branch: site.branch,
    siteUrl: site.url,
    base: site.base,
    apiBase,
    pollMs: Number(env.STUDIO_POLL_MS) > 0 ? Number(env.STUDIO_POLL_MS) : 8000,
  };
  await writeFile(path.join(dest, 'config.json'), JSON.stringify(config, null, 2));
  // Small web copies of the photos that are already on the site, so Studio can show them while you edit.
  await writeFile(path.join(dest, 'photos.json'), JSON.stringify(photoMap));

  // The same rules the build uses, so what Studio checks and previews is what the build accepts.
  await mkdir(path.join(dest, 'shared'), { recursive: true });
  for (const f of ['schema.mjs', 'frontmatter.mjs', 'text.mjs', 'render.mjs']) {
    await copyFile(path.join(root, 'src', 'shared', f), path.join(dest, 'shared', f));
  }
  const markedFile = fileURLToPath(import.meta.resolve('marked'));
  await mkdir(path.join(dest, 'vendor'), { recursive: true });
  await copyFile(markedFile, path.join(dest, 'vendor', 'marked.esm.js'));
  for (const name of ['LICENSE.md', 'LICENSE']) {
    const license = path.join(path.dirname(path.dirname(markedFile)), name);
    if (await exists(license)) {
      await copyFile(license, path.join(dest, 'vendor', 'marked-LICENSE.txt'));
      break;
    }
  }
  await writeFile(path.join(dest, 'site.css'), css);

  const indexPath = path.join(dest, 'index.html');
  const index = await readFile(indexPath, 'utf8');
  await writeFile(indexPath, index.replaceAll('{{connect}}', new URL(apiBase).origin));
  return true;
}

export async function build({ root = ROOT, out = path.join(root, 'dist'), env = process.env, log = () => {} } = {}) {
  const started = Date.now();
  const content = await loadContent(root);
  const { profile, credentials, entries, problems } = content;
  if (!problems.ok || !profile) return { ok: false, problems };

  const p = profile.data;
  const site = resolveSite({ env, profile: p });
  guardOutput(root, out);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await copyTree(path.join(root, 'public'), out);
  await writeFile(path.join(out, '.nojekyll'), '');

  // Photos
  const pipeline = new PhotoPipeline({ root, outDir: out, base: site.base });
  const infos = new Map();
  const jobs = [];
  for (const e of entries) {
    const files = new Set(e.photos.map((x) => x.file));
    if (e.coverFile) files.add(e.coverFile);
    for (const f of files) jobs.push({ key: `${e.slug}/${f}`, abs: path.join(e.dir, f), group: e.slug });
  }
  if (profile.portrait) jobs.push({ key: `profile/${profile.portrait}`, abs: path.join(profile.dir, profile.portrait), group: 'profile' });
  await mapLimit(jobs, 2, async (job) => {
    infos.set(job.key, await pipeline.process(job.abs, job.group));
  });
  const photoCount = jobs.length;
  const photoMap = {};
  for (const e of entries) {
    for (const f of new Set([...e.photos.map((x) => x.file), e.coverFile].filter(Boolean))) {
      const info = infos.get(`${e.slug}/${f}`);
      if (info?.jpeg?.length) photoMap[`${e.relDir}/${f}`] = info.jpeg[0].url;
    }
  }
  const portraitInfo = profile.portrait ? infos.get(`profile/${profile.portrait}`) : null;
  if (portraitInfo?.jpeg?.length) photoMap[`${profile.relDir}/${profile.portrait}`] = portraitInfo.jpeg[0].url;

  // Entries
  const views = [];
  for (const e of entries) {
    const photo = (file) => infos.get(`${e.slug}/${file}`) ?? null;
    const coverInfo = e.coverFile ? photo(e.coverFile) : null;
    const coverAlt = e.photos.find((x) => x.file === e.coverFile)?.alt ?? '';
    const rendered = renderBody(e.body, { base: site.base, photo, firstPriority: true });
    let shareImageInfo = null;
    if (e.coverFile && coverInfo) {
      const buf = await shareImage(path.join(e.dir, e.coverFile));
      const name = `share.${fingerprint(buf)}.jpg`;
      await mkdir(path.join(out, 'media', e.slug), { recursive: true });
      await writeFile(path.join(out, 'media', e.slug, name), buf);
      shareImageInfo = { url: `${site.origin}${site.base}media/${e.slug}/${name}`, width: 1200, height: 630, alt: coverAlt || e.title };
    }
    views.push({ ...e, coverInfo, coverAlt, bodyHtml: rendered.html, figures: rendered.figures, shareImage: shareImageInfo });
  }
  const pruned = await pipeline.prune();

  // Shared page values
  const css = minifyCss((await readFile(path.join(root, 'src', 'styles', 'site.css'), 'utf8')).replaceAll('{{base}}', site.base));
  const script = await readFile(path.join(root, 'src', 'client', 'lightbox.js'));
  const scriptName = `lightbox.${fingerprint(script)}.js`;
  await mkdir(path.join(out, 'assets'), { recursive: true });
  await writeFile(path.join(out, 'assets', scriptName), script);

  const latest = [...entries].map((e) => e.updated).sort().pop() ?? null;
  const hasContact = Boolean(p.email || p.linkedin || p.github || p.cv);
  const defaultImage = (await exists(path.join(root, 'public', 'og-default.jpg')))
    ? { url: `${site.url}og-default.jpg`, width: 1200, height: 630, alt: p.name }
    : null;
  const ctx = {
    site,
    profile,
    entries: views,
    credentials,
    portrait: profile.portrait ? infos.get(`profile/${profile.portrait}`) : null,
    aboutHtml: profile.body.trim() ? renderBody(profile.body, { base: site.base, photo: () => null }).html : `<p>${esc(p.headline)}</p>`,
    name: p.name,
    shortName: p.shortName,
    hasContact,
    css,
    cssHash: cspHash(css),
    scriptUrl: `${site.base}assets/${scriptName}`,
    year: new Date().getFullYear(),
    updated: latest,
    // A site that only holds sample entries is not ready to be found by search engines.
    noindex: entries.every((e) => e.sample),
    defaultImage,
  };

  // Pages
  const emitted = [];
  const emit = async (page) => {
    const rel = page.path === '' ? 'index.html' : page.path.endsWith('.html') ? page.path : `${page.path}index.html`;
    const dest = path.join(out, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, renderDocument(ctx, page, page.main));
    emitted.push(page);
  };
  await emit(homePage(ctx));
  await emit(workPage(ctx));
  for (const key of Object.keys(KINDS)) {
    if (views.some((e) => e.data.kind === key)) await emit(workPage(ctx, key));
  }
  for (let i = 0; i < views.length; i++) {
    await emit(entryPage(ctx, views[i], { newer: views[i - 1] ?? null, older: views[i + 1] ?? null }));
  }
  await emit(aboutPage(ctx));
  await emit(credentialsPage(ctx));
  if (hasContact) await emit(contactPage(ctx));
  await emit(notFoundPage(ctx));

  // Feeds
  const lastmod = new Map(views.map((e) => [entryPath(e), e.updated]));
  await writeFile(
    path.join(out, 'sitemap.xml'),
    // Pages that ask search engines to skip them (the 404 page and sample entries) are left out of the sitemap.
    sitemapXml(emitted.filter((pg) => pg.path !== '404.html' && !pg.noindex).map((pg) => ({ loc: site.url + pg.path, lastmod: lastmod.get(pg.path) }))),
  );
  await writeFile(path.join(out, 'robots.txt'), robotsTxt(site));
  await writeFile(
    path.join(out, 'rss.xml'),
    rssXml({
      site,
      title: p.name,
      description: p.headline,
      items: views.filter((e) => !e.sample).slice(0, 20).map((e) => ({ title: e.title, link: site.url + entryPath(e), date: e.date, summary: e.summary })),
    }),
  );
  await writeFile(path.join(out, 'build.json'), buildInfo({ site, entries: views.length, photos: photoCount }));

  const studio = await buildStudio({ root, out, site, env, css, photoMap });

  return {
    ok: true,
    problems,
    site,
    studio,
    stats: {
      entries: views.length,
      credentials: credentials.length,
      photos: photoCount,
      reused: pipeline.stats.reused,
      made: pipeline.stats.made,
      pruned,
      pages: emitted.length,
      seconds: (Date.now() - started) / 1000,
    },
  };
}

/* ---------- Command line ---------- */

async function main() {
  const result = await build({ log: console.log });
  if (!result.ok) {
    console.error(formatReport(result.problems));
    if (process.env.GITHUB_ACTIONS === 'true') console.log(actionsAnnotations(result.problems));
    process.exitCode = 1;
    return;
  }
  const { stats, site, problems } = result;
  if (problems.warnings.length) console.log(`${formatReport({ errors: [], warnings: problems.warnings })}\n`);
  console.log(
    `Built ${stats.pages} pages, ${stats.entries} entries and ${stats.photos} photos in ${stats.seconds.toFixed(1)} s ` +
      `(${stats.made} photos processed, ${stats.reused} reused from the cache).`,
  );
  console.log(`Site address: ${site.url}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`The build stopped because of an error in the build code itself, not in your content.\n\n${err.stack ?? err}`);
    process.exitCode = 2;
  });
}

