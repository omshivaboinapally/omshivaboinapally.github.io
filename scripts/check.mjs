#!/usr/bin/env node
// Checks everything in the content folder and reports every mistake at once,
// in plain words. It builds nothing, so it is quick.
//
//   npm run check

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionsAnnotations, formatReport } from '../src/lib/errors.mjs';
import { loadContent } from '../src/lib/content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { credentials, entries, problems } = await loadContent(root);

const samples = entries.filter((e) => e.sample);
if (samples.length) {
  problems.warn(
    'content/entries',
    `${samples.length} sample ${samples.length === 1 ? 'entry is' : 'entries are'} still on the site. A site with only sample entries asks search engines not to list it.`,
    'Delete the sample entries in Studio when you have added your own.',
  );
}

const report = formatReport(problems);
if (report) console.log(report);
if (!problems.ok) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(actionsAnnotations(problems));
  process.exitCode = 1;
} else {
  const photos = entries.reduce((n, e) => n + e.photos.length, 0);
  console.log(
    `${report ? '\n' : ''}All good. Checked ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}, ` +
      `${photos} ${photos === 1 ? 'photo' : 'photos'} and ${credentials.length} ${credentials.length === 1 ? 'credential' : 'credentials'}.`,
  );
}
