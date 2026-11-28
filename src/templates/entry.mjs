// One entry: a title block on the left, the text and photos on the right.

import { html, raw } from '../lib/html.mjs';
import { formatDate } from '../shared/text.mjs';
import { entryPath } from './pages.mjs';

const host = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
};

export function entryPage(ctx, e, { newer, older }) {
  const p = ctx.profile.data;
  const d = e.data;
  const { base } = ctx.site;
  const url = ctx.site.url + entryPath(e);

  const rows = [
    e.id && ['Number', e.id],
    ['Kind', e.sample ? `${e.kind.label} (sample)` : e.kind.label],
    ['Date', formatDate(e.date)],
    d.place && ['Place', d.place],
    d.stage && ['Stage', d.stage],
    ['Revision', `${e.revision}, ${formatDate(e.updated)}`],
    d.topics?.length && ['Topics', d.topics.join(', ')],
    d.tools?.length && ['Tools', d.tools.join(', ')],
    ['Checked', html`<span class="tick" aria-hidden="true"></span>Permission and privacy`],
  ].filter(Boolean);

  const links = d.links?.length
    ? html`<section class="facts" aria-labelledby="links-h"><h2 id="links-h">Files and links</h2>
<ul>${d.links.map((l) => html`<li><a href="${l.url}" rel="noopener noreferrer">${l.label}</a> <span class="label">${host(l.url)}</span></li>`)}</ul></section>`
    : '';

  const revs = e.revisions.length > 1
    ? html`<section class="revisions" aria-labelledby="rev-h"><h2 id="rev-h">Revisions</h2>
<table><thead><tr><th scope="col">Rev</th><th scope="col">Date</th><th scope="col">Change</th></tr></thead>
<tbody>${[...e.revisions].reverse().map((r) => html`<tr><td>${r.rev}</td><td>${formatDate(r.date)}</td><td>${r.note ?? ''}</td></tr>`)}</tbody></table></section>`
    : '';

  const link = (x, label, cls = '') => html`<a${cls ? raw(` class="${cls}"`) : ''} href="${base}${entryPath(x)}"><span class="label">${label}</span><span>${x.title}</span></a>`;
  const pager = newer || older
    ? html`<nav class="pager" aria-label="Other entries">${older ? link(older, 'Older') : ''}${newer ? link(newer, 'Newer', 'pager__next') : ''}</nav>`
    : '';

  const main = html`<main id="main" tabindex="-1"><article class="wrap sheet">
<div class="sheet__grid">
<header class="sheet__head">
${e.sample ? html`<p class="sample-note">Sample entry. It shows how an entry looks and is not real work.</p>` : ''}
<h1>${e.title}</h1>
<p class="summary">${e.summary}</p>
</header>
<div class="titleblock"><dl>${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></div>
<div class="sheet__body">
<div class="prose">${raw(e.bodyHtml)}</div>
${links}
${revs}
${pager}
</div>
</div>
</article></main>`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: e.title,
    description: e.summary,
    datePublished: e.date,
    dateModified: e.updated,
    author: { '@type': 'Person', name: p.name },
    mainEntityOfPage: url,
    ...(e.shareImage ? { image: [e.shareImage.url] } : {}),
  };

  return {
    title: `${e.title} — ${p.name}`,
    description: e.summary,
    path: entryPath(e),
    current: 'work',
    type: 'article',
    image: e.shareImage ?? undefined,
    jsonLd: ld,
    script: e.figures.some((f) => f.info),
    // A sample shows how an entry looks. It is not real work, so search engines are asked to skip it.
    noindex: e.sample === true,
    main,
  };
}
