import { createHash } from 'node:crypto';

/** Conservative shrink: removes comments and extra spaces. Leaves calc() operators alone. */
export function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

/** The value for a Content-Security-Policy that allows exactly this inline text. */
export function cspHash(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

export function fingerprint(buf, length = 8) {
  return createHash('sha256').update(buf).digest('hex').slice(0, length);
}
