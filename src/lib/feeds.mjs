// rss.xml, sitemap.xml, robots.txt and build.json

export const xml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

const utc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 6, 0, 0));
};

export function robotsTxt(site) {
  return `User-agent: *\nAllow: /\nDisallow: ${site.base}studio/\n\nSitemap: ${site.url}sitemap.xml\n`;
}

/** urls: [{ loc, lastmod? }] */
export function sitemapXml(urls) {
  const body = urls
    .map((u) => `  <url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** items: [{ title, link, date, summary }] */
export function rssXml({ site, title, description, items }) {
  const rows = items
    .map(
      (i) =>
        `    <item>\n      <title>${xml(i.title)}</title>\n      <link>${xml(i.link)}</link>\n      <guid isPermaLink="true">${xml(i.link)}</guid>\n      <pubDate>${utc(i.date).toUTCString()}</pubDate>\n      <description>${xml(i.summary)}</description>\n    </item>`,
    )
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n` +
    `    <title>${xml(title)}</title>\n    <link>${xml(site.url)}</link>\n    <description>${xml(description)}</description>\n    <language>en-IN</language>\n` +
    `    <atom:link href="${xml(`${site.url}rss.xml`)}" rel="self" type="application/rss+xml"/>\n${rows}\n  </channel>\n</rss>\n`
  );
}

export function buildInfo({ site, entries, photos }) {
  return JSON.stringify({ commit: site.commit, builtAt: new Date().toISOString(), entries, photos });
}
