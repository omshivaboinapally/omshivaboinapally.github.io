// Safe HTML writing. Anything put into html`...` is escaped unless it was
// itself made with html`...` or raw(...).

import { esc } from '../shared/text.mjs';

export { esc };

class Raw {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

export const raw = (s) => new Raw(String(s ?? ''));

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

export const text = (v) => render(v);

/** ` name="value"`, or nothing when the value is empty. */
export const attr = (name, value) => (value === null || value === undefined || value === false || value === '' ? '' : raw(` ${name}="${esc(value)}"`));
