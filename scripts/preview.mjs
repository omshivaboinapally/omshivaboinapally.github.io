#!/usr/bin/env node
// Shows the built site on this computer, so you can look at it before it goes live.
//
//   npm run preview            builds the site, then opens it at http://localhost:4321/
//
// The same small server is used by the automated tests.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
};

/**
 * Serves a folder the way GitHub Pages would: the site lives under `base`,
 * a folder address shows its index.html, and anything else shows 404.html.
 */
export function serve({ dir, base = '/', port = 0, log = false } = {}) {
  const root = path.resolve(dir);
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (!rel.startsWith(prefix)) {
        res.writeHead(404, { 'content-type': TYPES['.txt'] });
        res.end('Not found');
        return;
      }
      rel = rel.slice(prefix.length);
      let file = path.resolve(root, rel);
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      let info = await stat(file).catch(() => null);
      if (info?.isDirectory()) {
        if (!url.pathname.endsWith('/')) {
          res.writeHead(301, { location: `${url.pathname}/${url.search}` }).end();
          return;
        }
        file = path.join(file, 'index.html');
        info = await stat(file).catch(() => null);
      }
      let status = 200;
      if (!info) {
        file = path.join(root, '404.html');
        status = 404;
      }
      const body = await readFile(file).catch(() => null);
      if (!body) {
        res.writeHead(404, { 'content-type': TYPES['.txt'] }).end('Not found');
        return;
      }
      res.writeHead(status, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
      if (log) console.log(`${status} ${url.pathname}`);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({ server, port: actual, url: `http://localhost:${actual}${prefix}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { build } = await import('../src/build.mjs');
  const { formatReport } = await import('../src/lib/errors.mjs');
  const env = { ...process.env, SITE_ORIGIN: 'http://localhost:4321', SITE_BASE: '/' };
  const result = await build({ root, env });
  if (!result.ok) {
    console.error(formatReport(result.problems));
    process.exit(1);
  }
  const s = await serve({ dir: path.join(root, 'dist'), base: '/', port: 4321, log: false });
  console.log(`Your site is ready to look at: ${s.url}\nPress Ctrl+C to stop.`);
}
