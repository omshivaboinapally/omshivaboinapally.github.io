// Turns an entry's text into HTML. Raw HTML typed into the text is shown as
// plain text, links are limited to safe kinds, and a photo line (an image on a
// line by itself) becomes a numbered figure that opens in the photo viewer.
//
// The build (Node) and Studio's preview (browser) both use this file. Each one
// passes in its own copy of the `Marked` class, so the two always agree.

import { esc } from './text.mjs';

const SIZES = {
  1: '(min-width: 62rem) 54rem, 100vw',
  2: '(min-width: 62rem) 27rem, 50vw',
  3: '(min-width: 62rem) 18rem, 33vw',
};

function slug(s) {
  return (
    String(s)
      .replace(/<[^>]*>/g, '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

function safeHref(href, base) {
  const h = String(href ?? '').trim();
  if (!h) return '';
  // Browsers read a backslash as a slash, so "/\\example.com" can mean another website. Control characters are never needed.
  if (/[\\\u0000-\u001f\u007f]/.test(h)) return '';
  if (h.startsWith('#')) return h;
  if (/^(https?:|mailto:|tel:)/i.test(h)) return h;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return '';
  if (h.startsWith('//')) return '';
  return h.startsWith('/') ? base + h.slice(1) : base + h;
}

const RESERVED_IDS = new Set(['main', 'top', 'app', 'live', 'links-h', 'rev-h']);

const srcset = (list) => list.map((x) => `${x.url} ${x.w}w`).join(', ');

function pickSrc(info) {
  return info.jpeg.find((j) => j.w >= 960) ?? info.jpeg[info.jpeg.length - 1];
}

function figureHtml({ n, img, info, sizes, priority }) {
  const src = pickSrc(info);
  const largest = info.jpeg[info.jpeg.length - 1];
  const attrs = priority ? 'fetchpriority="high"' : 'loading="lazy"';
  const avif = info.avif ?? [];
  return (
    `<figure class="plate" id="photo-${n}">` +
    `<a class="plate__open" href="${esc(largest.url)}" data-lightbox data-n="${n}" data-w="${info.width}" data-h="${info.height}" ` +
    `data-avif="${esc(srcset(avif))}" data-jpeg="${esc(srcset(info.jpeg))}" data-alt="${esc(img.alt)}" data-caption="${esc(img.caption)}">` +
    `<picture>` +
    (avif.length ? `<source type="image/avif" srcset="${esc(srcset(avif))}" sizes="${sizes}">` : '') +
    `<img src="${esc(src.url)}" srcset="${esc(srcset(info.jpeg))}" sizes="${sizes}" width="${info.width}" height="${info.height}" alt="${esc(img.alt)}" ${attrs} decoding="async">` +
    `</picture>` +
    `<span class="vh">, opens the photo full size</span></a>` +
    `<figcaption><span class="plate__no">Photo ${n}</span><span class="plate__text">${esc(img.caption)}</span></figcaption>` +
    `</figure>`
  );
}

/** Text only, for descriptions and feeds. */
export function plainText(markdown) {
  return String(markdown ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[#*_`>]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {typeof import('marked').Marked} Marked */
export function createMarkdown(Marked) {
  const lex = (markdown) => new Marked({ gfm: true }).lexer(String(markdown ?? ''));

  function isFigureOnly(token) {
    return (
      token.type === 'paragraph' &&
      token.tokens.length > 0 &&
      token.tokens.some((t) => t.type === 'image') &&
      token.tokens.every((t) => t.type === 'image' || t.type === 'br' || (t.type === 'text' && t.raw.trim() === ''))
    );
  }

  function walkImages(tokens, found) {
    for (const t of tokens ?? []) {
      if (t.type === 'image') found.push(t);
      if (t.tokens) walkImages(t.tokens, found);
      if (t.items) for (const item of t.items) walkImages(item.tokens, found);
      if (t.type === 'table') {
        for (const c of t.header) walkImages(c.tokens, found);
        for (const row of t.rows) for (const c of row) walkImages(c.tokens, found);
      }
    }
  }

  /** Finds photo lines, stray images and headings without producing HTML. Used by the content checks. */
  function scanBody(markdown) {
    const tokens = lex(markdown);
    const groups = [];
    const stray = [];
    const headings = [];
    for (const t of tokens) {
      if (isFigureOnly(t)) {
        groups.push(t.tokens.filter((x) => x.type === 'image').map((x) => ({ href: x.href, alt: x.text, caption: x.title ?? '' })));
      } else {
        const found = [];
        walkImages([t], found);
        for (const f of found) stray.push({ href: f.href, alt: f.text });
        if (t.type === 'heading') headings.push({ depth: t.depth, text: t.text });
      }
    }
    return { groups, stray, headings, images: groups.flat() };
  }

  /**
   * @param {string} markdown
   * @param {{ base: string, photo: (file: string) => object | null, firstPriority?: boolean, startAt?: number }} ctx
   * @returns {{ html: string, figures: object[] }}
   */
  function renderBody(markdown, ctx) {
    const tokens = lex(markdown);
    const figures = [];
    let counter = ctx.startAt ?? 0;
    let blocksBefore = 0;
    const ids = new Set();
    // Ids the page itself uses. A heading called "Main" or "Photo 2" must not take one of them.
    const taken = (id) => ids.has(id) || RESERVED_IDS.has(id) || /^photo-\d+$/.test(id);

    const out = tokens.map((t) => {
      if (!isFigureOnly(t)) {
        if (t.type !== 'space') blocksBefore += 1;
        return t;
      }
      const images = t.tokens.filter((x) => x.type === 'image').map((x) => ({ href: x.href, alt: x.text, caption: x.title ?? '' }));
      const cols = images.length === 1 ? 1 : images.length === 2 || images.length === 4 ? 2 : 3;
      const early = blocksBefore <= 2;
      const parts = images.map((img) => {
        const info = ctx.photo(img.href);
        counter += 1;
        figures.push({ n: counter, file: img.href, alt: img.alt, caption: img.caption, info });
        if (!info) return `<p class="missing">Missing photo ${esc(img.href)}</p>`;
        return figureHtml({ n: counter, img, info, sizes: SIZES[cols], priority: Boolean(ctx.firstPriority) && early && figures.length === 1 });
      });
      blocksBefore += 1;
      const html = cols === 1 ? parts[0] : `<div class="plates plates--${cols}">${parts.join('')}</div>`;
      return { type: 'figureGroup', raw: t.raw, html };
    });

    const marked = new Marked({ gfm: true });
    marked.use({
      extensions: [{ name: 'figureGroup', renderer: (token) => token.html }],
      renderer: {
        html: ({ text }) => esc(text),
        image: ({ text }) => esc(text),
        link({ href, title, tokens }) {
          const inner = this.parser.parseInline(tokens);
          const safe = safeHref(href, ctx.base);
          if (!safe) return inner;
          const external = /^https?:/i.test(safe);
          return `<a href="${esc(safe)}"${title ? ` title="${esc(title)}"` : ''}${external ? ' rel="noopener noreferrer"' : ''}>${inner}</a>`;
        },
        heading({ tokens, depth }) {
          const inner = this.parser.parseInline(tokens);
          const level = Math.min(Math.max(depth, 2), 6);
          let id = slug(inner);
          for (let i = 2; taken(id); i++) id = `${slug(inner)}-${i}`;
          ids.add(id);
          return `<h${level} id="${id}">${inner}</h${level}>\n`;
        },
      },
    });
    return { html: marked.parser(out), figures };
  }

  return { scanBody, renderBody, plainText };
}
