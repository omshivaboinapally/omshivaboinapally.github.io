// Every page except a single entry: home, work lists, about, credentials, contact, not found.

import { html, raw } from '../lib/html.mjs';
import { KINDS } from '../shared/schema.mjs';
import { formatDate, formatMonthYear } from '../shared/text.mjs';

export const entryPath = (e) => `work/${e.slug}/`;

const srcset = (list) => list.map((x) => `${x.url} ${x.w}w`).join(', ');

/** A photo as <picture>: AVIF where the browser can show it, JPEG otherwise. */
export function picture(info, { sizes, alt = '', cls = '', priority = false, small = false } = {}) {
  const avif = small ? info.avif.slice(0, 1) : info.avif;
  const jpeg = small ? info.jpeg.slice(0, 1) : info.jpeg;
  const src = small ? jpeg[0] : (jpeg.find((j) => j.w >= 960) ?? jpeg[jpeg.length - 1]);
  const width = small ? src.w : info.width;
  const height = small ? Math.round((src.w * info.height) / info.width) : info.height;
  const load = priority ? raw(' fetchpriority="high"') : raw(' loading="lazy"');
  return html`<picture>${avif.length
    ? small
      ? html`<source type="image/avif" srcset="${avif[0].url}">`
      : html`<source type="image/avif" srcset="${srcset(avif)}" sizes="${sizes}">`
    : ''}${small
    ? html`<img${cls ? raw(` class="${cls}"`) : ''} src="${src.url}" width="${width}" height="${height}" alt="${alt}"${load} decoding="async">`
    : html`<img${cls ? raw(` class="${cls}"`) : ''} src="${src.url}" srcset="${srcset(jpeg)}" sizes="${sizes}" width="${width}" height="${height}" alt="${alt}"${load} decoding="async">`}</picture>`;
}

const kindLabel = (e) => (e.sample ? `Sample ${e.kind.label.toLowerCase()}` : e.kind.label);

function registerRow(ctx, e) {
  const tid = `t-${e.slug}`;
  const sid = `s-${e.slug}`;
  return html`<li><a class="register__link" href="${ctx.site.base}${entryPath(e)}" aria-labelledby="${tid}" aria-describedby="${sid}">
<span class="register__no">${e.id}</span>
<span class="register__title"><span id="${tid}">${e.title}</span><span class="register__sum" id="${sid}">${e.summary}</span></span>
<span class="register__meta"><span class="register__kind">${kindLabel(e)}</span><span class="register__date">${formatDate(e.date)}</span></span>
${e.coverInfo ? picture(e.coverInfo, { cls: 'register__thumb', small: true }) : ''}
</a></li>`;
}

const registerList = (ctx, list) => html`<ul class="register">${list.map((e) => registerRow(ctx, e))}</ul>`;

function period(c) {
  const { start, end } = c.data;
  if (start && end) {
    const a = formatMonthYear(start);
    const b = formatMonthYear(end);
    return a === b ? a : `${a} to ${b}`;
  }
  if (end) return `Completed ${formatMonthYear(end)}`;
  if (start) return `Started ${formatMonthYear(start)}`;
  return '';
}

function credentialRow(c) {
  const d = c.data;
  return html`<li class="register__row">
<span class="register__no">${c.id}</span>
<span class="register__title">${d.title}${d.summary ? html`<span class="register__sum">${d.summary}</span>` : ''}</span>
<span class="register__meta"><span>${d.issuer}</span>${d.place ? html`<span>${d.place}</span>` : ''}${period(c) ? html`<span>${period(c)}</span>` : ''}${d.level ? html`<span>${d.level}</span>` : ''}</span>
</li>`;
}

const credentialList = (list) => html`<ul class="register register--plain">${list.map(credentialRow)}</ul>`;

export const cvHref = (ctx) => {
  const cv = ctx.profile.data.cv;
  if (!cv) return '';
  return cv.startsWith('files/') ? ctx.site.base + cv : cv;
};

function personLd(ctx) {
  const p = ctx.profile.data;
  const same = [p.linkedin, p.github].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: p.name,
    url: ctx.site.url,
    ...(p.headline ? { description: p.headline } : {}),
    ...(same.length ? { sameAs: same } : {}),
    ...(p.location ? { homeLocation: { '@type': 'Place', name: p.location } } : {}),
    ...(ctx.portrait ? { image: ctx.site.origin + ctx.portrait.jpeg[ctx.portrait.jpeg.length - 1].url } : {}),
  };
}

/* ---------- Home ---------- */

export function homePage(ctx) {
  const p = ctx.profile.data;
  const { base } = ctx.site;
  const featured = ctx.entries.filter((e) => e.featured).slice(0, 3);
  const rest = ctx.entries.filter((e) => !featured.includes(e));
  const latest = featured.length ? rest.slice(0, 4) : rest.slice(0, 6);
  const heroEntry = [...featured, ...ctx.entries].find((e) => e.coverInfo) ?? null;
  const cv = cvHref(ctx);
  const lastBlock = latest.length ? 'latest' : featured.length ? 'selected' : 'work';
  const allWork = html`<a href="${base}work/">All work (${ctx.entries.length})</a>`;
  const more = (which) => (which === lastBlock && ctx.entries.length ? allWork : '');

  const block = (id, heading, list, extra = '') => html`<section class="wrap block" aria-labelledby="${id}">
<div class="block__head"><h2 id="${id}">${heading}</h2>${extra}</div>
${list.length ? registerList(ctx, list) : html`<p class="empty">Nothing has been published yet.</p>`}
</section>`;

  const main = html`<main id="main" tabindex="-1">
<section class="wrap hero${heroEntry ? '' : ' hero--solo'}" aria-labelledby="top">
<div class="hero__text">
<h1 id="top">${p.name}</h1>
<p class="lede">${p.headline}</p>
<p class="hero__links"><a href="${base}work/">View work</a>${cv ? html`<a href="${cv}">Download CV</a>` : ''}${ctx.hasContact ? html`<a href="${base}contact/">Contact</a>` : ''}</p>
</div>
${heroEntry
    ? html`<figure class="hero__plate"><a class="hero__open" href="${base}${entryPath(heroEntry)}">${picture(heroEntry.coverInfo, {
        sizes: '(min-width: 62rem) 50vw, 100vw',
        alt: heroEntry.coverAlt,
        priority: true,
      })}<span class="hero__cap"><span class="label">${heroEntry.id}</span> <span class="hero__title">${heroEntry.title}</span></span></a></figure>`
    : ''}
</section>
${ctx.entries.length === 0 ? block('work-h', 'Work', [], more('work')) : ''}
${featured.length ? block('selected-h', 'Selected work', featured, more('selected')) : ''}
${latest.length ? block('latest-h', featured.length ? 'Latest' : 'Latest work', latest, more('latest')) : ''}
${ctx.credentials.length
    ? html`<section class="wrap block" aria-labelledby="credentials-h">
<div class="block__head"><h2 id="credentials-h">Credentials</h2>${ctx.credentials.length > 3 ? html`<a href="${base}credentials/">All credentials (${ctx.credentials.length})</a>` : ''}</div>
${credentialList(ctx.credentials.slice(0, 3))}
</section>`
    : ''}
</main>`;

  return {
    title: `${p.name} — Portfolio`,
    description: p.description || p.headline,
    path: '',
    current: 'home',
    jsonLd: personLd(ctx),
    main,
  };
}

/* ---------- Work ---------- */

const KIND_INTRO = {
  'site-note': 'What I saw, checked and learned on site visits.',
  project: 'Longer pieces of work, with the steps and the result.',
  report: 'Written findings on a site, a method or a subject.',
};

export function workPage(ctx, kindKey = null) {
  const p = ctx.profile.data;
  const { base } = ctx.site;
  const kind = kindKey ? KINDS[kindKey] : null;
  const list = kindKey ? ctx.entries.filter((e) => e.data.kind === kindKey) : ctx.entries;
  const present = Object.entries(KINDS).filter(([k]) => ctx.entries.some((e) => e.data.kind === k));
  const path = kind ? `work/${kind.section}/` : 'work/';
  const filters =
    present.length > 1
      ? html`<nav class="filters" aria-label="Show only one kind of work">
<a href="${base}work/"${kind ? '' : raw(' aria-current="page"')}>All <span class="tabular">${ctx.entries.length}</span></a>
${present.map(([k, v]) => html`<a href="${base}work/${v.section}/"${kindKey === k ? raw(' aria-current="page"') : ''}>${v.plural} <span class="tabular">${ctx.entries.filter((e) => e.data.kind === k).length}</span></a>`)}
</nav>`
      : '';
  const main = html`<main id="main" tabindex="-1"><div class="wrap page">
<header class="page__head"><h1>${kind ? kind.plural : 'Work'}</h1>
<p class="summary">${kind ? KIND_INTRO[kindKey] : 'Site notes, projects and reports, newest first.'}</p></header>
${filters}
${list.length ? registerList(ctx, list) : html`<p class="empty">Nothing has been published here yet.</p>`}
</div></main>`;
  return {
    title: `${kind ? kind.plural : 'Work'} — ${p.name}`,
    description: kind ? `${kind.plural} by ${p.name}. ${KIND_INTRO[kindKey]}` : `Site notes, projects and reports by ${p.name}.`,
    path,
    current: 'work',
    main,
  };
}

/* ---------- About ---------- */

export function aboutPage(ctx) {
  const p = ctx.profile.data;
  const cv = cvHref(ctx);
  const rows = [
    p.location && ['Location', p.location],
    p.availability && ['Availability', p.availability],
    cv && ['CV', html`<a href="${cv}">Download (PDF)</a>`],
  ].filter(Boolean);
  const main = html`<main id="main" tabindex="-1"><div class="wrap sheet">
<div class="sheet__grid">
<header class="sheet__head"><h1>About</h1></header>
<div class="titleblock">
${ctx.portrait
    ? html`<figure class="portrait">${picture(ctx.portrait, { sizes: '12rem', alt: `Portrait of ${p.name}`, small: false, priority: true })}</figure>`
    : ''}
<dl><div><dt>Name</dt><dd>${p.name}</dd></div>${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
</div>
<div class="sheet__body"><div class="prose">${raw(ctx.aboutHtml)}</div></div>
</div>
</div></main>`;
  return {
    title: `About — ${p.name}`,
    description: p.description || p.headline,
    path: 'about/',
    current: 'about',
    jsonLd: personLd(ctx),
    main,
  };
}

/* ---------- Credentials ---------- */

export function credentialsPage(ctx) {
  const p = ctx.profile.data;
  const main = html`<main id="main" tabindex="-1"><div class="wrap page">
<header class="page__head"><h1>Credentials</h1>
<p class="summary">Training and certificates, with the body that issued each one. Certificate numbers and scans are not shown here.</p></header>
${ctx.credentials.length ? credentialList(ctx.credentials) : html`<p class="empty">No credentials have been added yet.</p>`}
</div></main>`;
  return {
    title: `Credentials — ${p.name}`,
    description: `Training and certificates earned by ${p.name}.`,
    path: 'credentials/',
    current: 'credentials',
    main,
  };
}

/* ---------- Contact ---------- */

function shortUrl(u) {
  try {
    const x = new URL(u);
    return (x.host + x.pathname).replace(/\/$/, '');
  } catch {
    return u;
  }
}

export function contactPage(ctx) {
  const p = ctx.profile.data;
  const cv = cvHref(ctx);
  const rows = [
    p.email && ['Email', html`<a href="mailto:${p.email}">${p.email}</a>`],
    p.linkedin && ['LinkedIn', html`<a href="${p.linkedin}" rel="noopener noreferrer">${shortUrl(p.linkedin)}</a>`],
    p.github && ['GitHub', html`<a href="${p.github}" rel="noopener noreferrer">${shortUrl(p.github)}</a>`],
    cv && ['CV', html`<a href="${cv}">Download (PDF)</a>`],
    p.location && ['Location', p.location],
    p.availability && ['Availability', p.availability],
  ].filter(Boolean);
  const main = html`<main id="main" tabindex="-1"><div class="wrap page">
<header class="page__head"><h1>Contact</h1></header>
<ul class="contact-list">${rows.map(([k, v]) => html`<li><span class="label">${k}</span><span>${v}</span></li>`)}</ul>
</div></main>`;
  return {
    title: `Contact — ${p.name}`,
    description: `How to contact ${p.name}.`,
    path: 'contact/',
    current: 'contact',
    main,
  };
}

/* ---------- Not found ---------- */

export function notFoundPage(ctx) {
  const p = ctx.profile.data;
  const { base } = ctx.site;
  const main = html`<main id="main" tabindex="-1"><div class="wrap page">
<header class="page__head"><h1>Page not found</h1>
<p class="summary">There is no page at this address. It may have been removed, or the address may have a typing mistake.</p></header>
<p class="hero__links"><a href="${base}">Home page</a><a href="${base}work/">All work</a></p>
</div></main>`;
  return {
    title: `Page not found — ${p.name}`,
    description: 'There is no page at this address.',
    path: '404.html',
    current: '',
    noindex: true,
    main,
  };
}
