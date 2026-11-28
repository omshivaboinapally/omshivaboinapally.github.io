// Keeps unfinished entries on this device (IndexedDB), photos included, so a
// closed tab or a flat battery does not lose your work. Nothing here is sent
// anywhere. If the browser refuses to store data (some private windows), Studio
// still works; it just cannot keep drafts.
//
// The text of a draft and its photos are stored separately, so typing never
// rewrites photos that were already saved.

const DB_NAME = 'portfolio-studio';
const DRAFTS = 'drafts';
const BLOBS = 'blobs';
let opened = null;

function open() {
  if (!opened) {
    opened = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available'));
      const request = indexedDB.open(DB_NAME, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return opened;
}

async function run(stores, mode, work) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    try {
      result = work(...stores.map((s) => tx.objectStore(s)));
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveDraft(key, value) {
  try {
    await run([DRAFTS], 'readwrite', (s) => s.put({ key, savedAt: Date.now(), value }));
    return true;
  } catch {
    return false;
  }
}

export async function loadDraft(key) {
  try {
    return (await run([DRAFTS], 'readonly', (s) => s.get(key))) ?? null;
  } catch {
    return null;
  }
}

/** Removes the draft and every photo saved with it. */
export async function deleteDraft(key) {
  try {
    await run([DRAFTS, BLOBS], 'readwrite', (drafts, blobs) => {
      blobs.delete(IDBKeyRange.bound(`${key}|`, `${key}|￿`));
      return drafts.delete(key);
    });
  } catch {
    /* nothing to delete */
  }
}

export async function listDrafts() {
  try {
    return (await run([DRAFTS], 'readonly', (s) => s.getAll())) ?? [];
  } catch {
    return [];
  }
}

export async function saveBlob(key, photoId, blob) {
  try {
    await run([BLOBS], 'readwrite', (s) => s.put({ id: `${key}|${photoId}`, blob }));
    return true;
  } catch {
    return false;
  }
}

export async function loadBlob(key, photoId) {
  try {
    return (await run([BLOBS], 'readonly', (s) => s.get(`${key}|${photoId}`)))?.blob ?? null;
  } catch {
    return null;
  }
}
