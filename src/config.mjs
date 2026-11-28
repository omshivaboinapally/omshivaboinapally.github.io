// Works out the website's address and base folder.
//
//   <username>.github.io repository   -> https://<username>.github.io/        (base "/")
//   any other repository name         -> https://<username>.github.io/<repo>/ (base "/<repo>/")
//   a custom domain (profile "siteUrl", or SITE_URL) overrides both.

export function normalizeBase(input) {
  let s = String(input ?? '/').trim();
  if (!s.startsWith('/')) s = `/${s}`;
  if (!s.endsWith('/')) s += '/';
  return s.replace(/\/{2,}/g, '/');
}

export function resolveSite({ env = process.env, profile = {} } = {}) {
  const [owner = '', repo = ''] = String(env.GITHUB_REPOSITORY ?? '').split('/');
  const explicit = env.SITE_URL || profile.siteUrl;
  let origin;
  let base;
  let source;
  if (explicit) {
    const u = new URL(explicit);
    origin = u.origin;
    base = normalizeBase(env.SITE_BASE ?? u.pathname);
    source = env.SITE_URL ? 'SITE_URL' : 'profile';
  } else if (owner) {
    origin = `https://${owner.toLowerCase()}.github.io`;
    base = repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '/' : normalizeBase(repo);
    source = 'GITHUB_REPOSITORY';
  } else {
    origin = env.SITE_ORIGIN || 'http://localhost:4321';
    base = normalizeBase(env.SITE_BASE || '/');
    source = 'default';
  }
  return {
    origin,
    base,
    url: origin + base,
    owner,
    repo,
    branch: env.GITHUB_REF_NAME || 'main',
    commit: env.GITHUB_SHA || 'local',
    source,
  };
}
