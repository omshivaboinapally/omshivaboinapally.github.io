// Reads and writes the field lines at the top of each index.md.
//
// Format: one field per line, "name: value". Values are written the way JSON
// writes them (text in "double quotes", lists in [square brackets]), which is
// also valid YAML, so other tools can read these files too.
//
//   ---
//   title: "Column reinforcement check"
//   date: 2026-11-10
//   topics: ["Reinforcement", "Quality"]
//   permission: true
//   ---
//   Body text...

import { DATE_RE } from './text.mjs';

const KEY_RE = /^([A-Za-z][A-Za-z0-9_-]*)\s*:(?:\s+(.*))?$/;
const DATE_KEYS = new Set(['date', 'start', 'end']);

/** Returns { data, body, errors: [{ line, message }] } and never throws. */
export function parseFrontMatter(source) {
  const text = String(source ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const errors = [];
  if (lines[0].trim() !== '---') {
    return {
      data: {},
      body: text,
      errors: [{ line: 1, message: 'The file must start with a line that contains only three dashes (---).' }],
    };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      close = i;
      break;
    }
  }
  if (close < 0) {
    return {
      data: {},
      body: '',
      errors: [{ line: 1, message: 'The field lines at the top never end. Add a line with only three dashes (---) after them.' }],
    };
  }
  const data = {};
  for (let i = 1; i < close; i++) {
    const raw = lines[i];
    const n = i + 1;
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    if (/^\s/.test(raw) || /^-\s/.test(raw)) {
      errors.push({
        line: n,
        message: 'Each field must be on one line that starts at the left edge. Write lists on one line like topics: ["One", "Two"].',
      });
      continue;
    }
    const m = KEY_RE.exec(raw.trimEnd());
    if (!m) {
      errors.push({ line: n, message: `Expected a line like name: value, but found "${raw.trim().slice(0, 60)}".` });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(data, m[1])) {
      errors.push({ line: n, message: `The field "${m[1]}" appears twice.` });
      continue;
    }
    const v = parseValue((m[2] ?? '').trim());
    if (v.error) errors.push({ line: n, message: `Field "${m[1]}": ${v.error}` });
    else data[m[1]] = v.value;
  }
  const body = lines.slice(close + 1).join('\n').replace(/^\n+/, '');
  return { data, body, errors };
}

function parseValue(v) {
  if (v === '') return { value: '' };
  if (v[0] === '"') {
    try {
      const out = JSON.parse(v);
      if (typeof out === 'string') return { value: out };
    } catch {
      /* fall through */
    }
    return { error: 'text in double quotes must end with a closing quote, and a quote mark inside the text must be written \\".' };
  }
  if (v[0] === "'") {
    if (v.length >= 2 && v.endsWith("'")) return { value: v.slice(1, -1).replace(/''/g, "'") };
    return { error: 'text in single quotes must end with a closing quote.' };
  }
  if (v[0] === '[' || v[0] === '{') {
    try {
      return { value: JSON.parse(v) };
    } catch {
      return { error: 'lists must be written like ["One", "Two"], with every item in double quotes.' };
    }
  }
  if (v === 'true') return { value: true };
  if (v === 'false') return { value: false };
  if (v === 'null' || v === '~') return { value: null };
  if (/^-?\d+(\.\d+)?$/.test(v)) return { value: Number(v) };
  return { value: v };
}

function formatValue(key, v) {
  if (typeof v === 'string') return DATE_KEYS.has(key) && DATE_RE.test(v) ? v : JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/** The lines between the two --- markers. Empty values are left out. */
export function stringifyFrontMatter(data, order = []) {
  const keys = [...order.filter((k) => k in data), ...Object.keys(data).filter((k) => !order.includes(k))];
  const lines = [];
  for (const k of keys) {
    const v = data[k];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    lines.push(`${k}: ${formatValue(k, v)}`);
  }
  return lines.join('\n');
}

/** A complete index.md. */
export function composeDocument(data, body, order = []) {
  return `---\n${stringifyFrontMatter(data, order)}\n---\n\n${String(body ?? '').trim()}\n`;
}
