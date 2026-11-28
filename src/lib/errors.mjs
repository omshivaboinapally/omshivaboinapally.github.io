// Collects problems found in the content and prints them in plain English.

export class Problems {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }
  error(file, message, fix = '') {
    this.errors.push({ file, message, fix });
  }
  warn(file, message, fix = '') {
    this.warnings.push({ file, message, fix });
  }
  get ok() {
    return this.errors.length === 0;
  }
}

function block(list) {
  return list
    .map((p, i) => `${i + 1}. ${p.file}\n   ${p.message}${p.fix ? `\n   Fix: ${p.fix}` : ''}`)
    .join('\n\n');
}

export function formatReport(problems) {
  const parts = [];
  if (problems.errors.length) {
    parts.push(
      `Content problems found. Nothing was published and the live site is unchanged.\n\n${block(problems.errors)}`,
    );
  }
  if (problems.warnings.length) parts.push(`Notes (these do not stop the build):\n\n${block(problems.warnings)}`);
  return parts.join('\n\n');
}

/** GitHub shows these lines as red banners at the top of a failed run. */
export function actionsAnnotations(problems) {
  return problems.errors
    .map((p) => `::error file=${p.file},title=Content problem::${p.message.replace(/\n/g, ' ')}${p.fix ? ` Fix: ${p.fix}` : ''}`)
    .join('\n');
}
