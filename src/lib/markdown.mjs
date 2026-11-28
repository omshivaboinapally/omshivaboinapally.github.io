// The Node side of the text renderer. The rules themselves live in
// src/shared/render.mjs so Studio's preview uses exactly the same ones.

import { Marked } from 'marked';
import { createMarkdown, plainText } from '../shared/render.mjs';

export const { scanBody, renderBody } = createMarkdown(Marked);
export { plainText };
