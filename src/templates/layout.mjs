// The frame around every page: head, header, footer.

import { attr, html, raw } from '../lib/html.mjs';
import { formatDate } from '../shared/text.mjs';

const NAV = [
  { key: 'work', label: 'Work', path: 'work/' },
  { key: 'about', label: 'About', path: 'about/' },
  { key: 'credentials', label: 'Credentials', path: 'credentials/' },
  { key: 'contact', label: 'Contact', path: 'contact/' },
];

/** Nothing may load from another website, and only the one inline style block is allowed. */
export function contentSecurityPolicy({ cssHash, script }) {
  return [
    "default-src 'none'",
    `style-src ${cssHash}`,
    `script-src ${script ? "'self'" : "'none'"}`,
    "img-src 'self'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
}

/**
 * @param {object} ctx  site-wide values (see build.mjs)
 * @param {object} page { title, description, path, current, type, image, jsonLd, script, noindex }
 * @param {import('../lib/html.mjs').Raw} main  the <main> element
 */
export function renderDocument(ctx, page, main) {
  const { site } = ctx;
  const base = site.base;
  const canonical = site.url + (page.path ?? '');
  const image = page.image ?? ctx.defaultImage ?? null;
  const items = NAV.filter((n) => n.key !== 'contact' || ctx.hasContact);
  const noindex = ctx.noindex || page.noindex === true;
  const jsonLd = page.jsonLd ? JSON.stringify(page.jsonLd).replace(/</g, '\\u003c') : '';
  const here = (key, path) => {
    if (page.current === key) return page.path === path ? 'page' : 'true';
    return null;
  };

  const head = html`<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy({ cssHash: ctx.cssHash, script: Boolean(page.script) })}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<meta name="description" content="${page.description}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f4f5f2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#14181b" media="(prefers-color-scheme: dark)">
${noindex ? raw('<meta name="robots" content="noindex">') : ''}
<link rel="canonical" href="${canonical}">
<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${base}apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="${ctx.name}" href="${base}rss.xml">
<link rel="preload" href="${base}fonts/pagella-regular.woff" as="font" type="font/woff" crossorigin>
<link rel="preload" href="${base}fonts/heroscn-regular.woff" as="font" type="font/woff" crossorigin>
<meta property="og:site_name" content="${ctx.name}">
<meta property="og:locale" content="en_IN">
<meta property="og:type" content="${page.type ?? 'website'}">
<meta property="og:title" content="${page.title}">
<meta property="og:description" content="${page.description}">
<meta property="og:url" content="${canonical}">
${image
    ? html`<meta property="og:image" content="${image.url}">
<meta property="og:image:width" content="${image.width}">
<meta property="og:image:height" content="${image.height}">
<meta property="og:image:alt" content="${image.alt}">
<meta name="twitter:card" content="summary_large_image">`
    : ''}
<style>${raw(ctx.css)}</style>
${jsonLd ? raw(`<script type="application/ld+json">${jsonLd}</script>`) : ''}`;

  const masthead = html`<header class="masthead"><div class="wrap">
<a class="masthead__name" href="${base}"${attr('aria-current', here('home', ''))}>${ctx.shortName || ctx.name}</a>
<nav aria-label="Main"><ul class="nav">${items.map((n) => html`<li><a href="${base}${n.path}"${attr('aria-current', here(n.key, n.path))}>${n.label}</a></li>`)}</ul></nav>
</div></header>`;

  const footer = html`<footer class="colophon"><div class="wrap">
<span>© ${ctx.year} ${ctx.name}</span>
${ctx.updated ? html`<span>Last updated ${formatDate(ctx.updated)}</span>` : ''}
<a href="${base}rss.xml">RSS feed</a>
</div></footer>`;

  return (
    '<!doctype html>\n' +
    html`<html lang="en-IN">
<head>
${head}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="walls" aria-hidden="true"></div>
${masthead}
${main}
${footer}
${page.script ? raw(`<script src="${ctx.scriptUrl}" defer></script>`) : ''}
</body>
</html>
`.toString()
  );
}
