// Talks to GitHub for Studio. Everything goes through the Git Data API, so one
// publish is one commit: every file of an entry arrives together, or none does.
//
// Only these headers are sent: Authorization, Accept and Content-Type. They are
// all on GitHub's list of headers that browser pages may send.

export class GitHubError extends Error {
  constructor(message, { status = 0, hint = '', code = '' } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.hint = hint;
    this.code = code;
  }
}

function explain(status, repoName, body, rateRemaining) {
  const detail = body?.message ? String(body.message) : '';
  switch (status) {
    case 401:
      return new GitHubError('GitHub did not accept the token.', {
        status,
        code: 'auth',
        hint: 'It may have expired, been cancelled, or been copied with a missing character. Make a new token and paste it again.',
      });
    case 403:
      if (rateRemaining === '0' || /rate limit/i.test(detail)) {
        return new GitHubError('GitHub is asking for a short pause.', { status, code: 'rate', hint: 'Wait a few minutes and try again.' });
      }
      return new GitHubError('The token is not allowed to do that.', {
        status,
        code: 'permission',
        hint: `Make a new token for ${repoName} and set "Contents" to "Read and write".`,
      });
    case 404:
      return new GitHubError(`GitHub cannot find ${repoName} with this token.`, {
        status,
        code: 'notfound',
        hint: 'Check the spelling, and make sure the token was given access to this repository. A token for the wrong repository gives this message.',
      });
    case 409:
      return new GitHubError('The repository has no content yet, or the branch is missing.', { status, code: 'conflict', hint: detail });
    case 422:
      return new GitHubError('GitHub refused the change.', { status, code: 'unprocessable', hint: detail });
    default:
      return new GitHubError(`GitHub answered with an unexpected error (${status}).`, { status, code: 'other', hint: detail });
  }
}

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export function createClient({ apiBase = 'https://api.github.com', owner, repo, branch = 'main', token, fetchImpl }) {
  const doFetch = fetchImpl ?? ((...args) => fetch(...args));
  const repoName = `${owner}/${repo}`;
  const root = `${apiBase.replace(/\/$/, '')}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  async function call(method, path, body) {
    let res;
    try {
      res = await doFetch(root + path, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError('Could not reach GitHub.', { code: 'network', hint: 'Check your internet connection and try again. Nothing was changed.' });
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) throw explain(res.status, repoName, data, res.headers.get('x-ratelimit-remaining'));
    return data;
  }

  const getHead = async () => {
    const ref = await call('GET', `/git/ref/heads/${encodeURIComponent(branch)}?_=${Date.now()}`);
    const commit = await call('GET', `/git/commits/${ref.object.sha}`);
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
  };

  const createBlob = async (content, encoding) => (await call('POST', '/git/blobs', { content, encoding })).sha;

  return {
    repoName,
    branch,

    /** Proves the token can read and write this repository, without changing anything visible. */
    async checkAccess() {
      const info = await call('GET', '');
      if (info.archived) throw new GitHubError('This repository is archived, so it cannot be changed.', { code: 'archived', hint: 'Un-archive it in the repository settings.' });
      await createBlob('studio access check', 'utf-8');
      await getHead();
      return { fullName: info.full_name ?? repoName, isPrivate: Boolean(info.private) };
    },

    getHead,

    async listTree(treeSha) {
      const res = await call('GET', `/git/trees/${treeSha}?recursive=1`);
      if (res.truncated) throw new GitHubError('The repository is too large for Studio to list.', { code: 'truncated' });
      return res.tree;
    },

    async readText(sha) {
      const blob = await call('GET', `/git/blobs/${sha}`);
      return new TextDecoder().decode(fromBase64(blob.content));
    },

    /**
     * One commit with many changes.
     * changes: [{ path, text } | { path, blob } | { path, remove: true }]
     */
    async commit({ message, changes, onProgress }) {
      const uploads = changes.filter((c) => !c.remove);
      let done = 0;
      onProgress?.({ phase: 'upload', done, total: uploads.length });
      const shas = new Map();
      await pool(uploads, 3, async (c) => {
        const sha = c.blob ? await createBlob(await toBase64(c.blob), 'base64') : await createBlob(c.text, 'utf-8');
        shas.set(c, sha);
        onProgress?.({ phase: 'upload', done: ++done, total: uploads.length });
      });
      const tree = changes.map((c) => ({ path: c.path, mode: '100644', type: 'blob', sha: c.remove ? null : shas.get(c) }));

      onProgress?.({ phase: 'save' });
      let head = await getHead();
      for (let attempt = 1; ; attempt++) {
        const newTree = await call('POST', '/git/trees', { base_tree: head.treeSha, tree });
        const commit = await call('POST', '/git/commits', { message, tree: newTree.sha, parents: [head.commitSha] });
        try {
          await call('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
          return { sha: commit.sha };
        } catch (err) {
          // Something else changed the branch while we worked: build on top of it and try again.
          if (err.status === 422 && attempt < 3) {
            head = await getHead();
            continue;
          }
          throw err;
        }
      }
    },

    /** True when the live site was built from `sha` or from a later commit. */
    async includesCommit(sha, liveSha) {
      if (!liveSha || liveSha === 'local') return false;
      if (liveSha === sha) return true;
      try {
        const res = await call('GET', `/compare/${sha}...${liveSha}`);
        return res.status === 'ahead' || res.status === 'identical';
      } catch {
        return false;
      }
    },
  };
}

export { fromBase64 };
