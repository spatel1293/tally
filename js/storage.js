// Storage backends. All share one interface:
//   getAll(store) -> Promise<array>
//   commit(ops)   -> Promise<void>, ops = [{ store, op: 'put'|'delete'|'clear', value?, key? }]
// A commit either lands completely or throws, and the app only updates what
// it shows after the commit resolves.

export const STORES = ['transactions', 'categories', 'accounts', 'recurring', 'goals', 'meta'];
const DB_NAME = 'tally';
const DB_VERSION = 1;
const LS_PREFIX = 'tally:';

function keyOf(store, value) {
  return store === 'meta' ? value.key : value.id;
}

class IndexedDBBackend {
  constructor(db) {
    this.db = db;
    this.kind = 'indexeddb';
    this.durable = true;
    this.onVersionChange = null;
    db.onversionchange = () => {
      db.close();
      this.onVersionChange?.();
    };
  }

  static open(timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new Error('IndexedDB did not respond'));
      }, timeoutMs);
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: name === 'meta' ? 'key' : 'id' });
          }
        }
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        if (settled) {
          req.result.close();
          return;
        }
        settled = true;
        resolve(new IndexedDBBackend(req.result));
      };
      req.onerror = () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(req.error ?? new Error('IndexedDB failed to open'));
        }
      };
      req.onblocked = () => {
        // Another tab holds an older version open; wait for the timeout.
      };
    });
  }

  getAll(store) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  commit(ops) {
    if (!ops.length) return Promise.resolve();
    const names = [...new Set(ops.map((o) => o.store))];
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = this.db.transaction(names, 'readwrite', { durability: 'strict' });
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Write was cancelled'));
      try {
        for (const o of ops) {
          const st = tx.objectStore(o.store);
          if (o.op === 'put') st.put(o.value);
          else if (o.op === 'delete') st.delete(o.key);
          else if (o.op === 'clear') st.clear();
        }
      } catch (err) {
        try {
          tx.abort();
        } catch {
          // already finished
        }
        reject(err);
      }
    });
  }
}

class LocalStorageBackend {
  constructor(storage) {
    this.ls = storage;
    this.kind = 'localstorage';
    this.durable = true;
  }

  static open() {
    const ls = globalThis.localStorage;
    const probe = `${LS_PREFIX}probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return new LocalStorageBackend(ls);
  }

  read(store) {
    const raw = this.ls.getItem(LS_PREFIX + store);
    return raw ? JSON.parse(raw) : {};
  }

  async getAll(store) {
    return Object.values(this.read(store));
  }

  async commit(ops) {
    const touched = new Map();
    for (const o of ops) {
      if (!touched.has(o.store)) touched.set(o.store, this.read(o.store));
      const map = touched.get(o.store);
      if (o.op === 'put') map[keyOf(o.store, o.value)] = o.value;
      else if (o.op === 'delete') delete map[o.key];
      else if (o.op === 'clear') for (const k of Object.keys(map)) delete map[k];
    }
    // Serialize everything first so a failure can't leave a half-written batch.
    const payloads = [...touched].map(([store, map]) => [LS_PREFIX + store, JSON.stringify(map)]);
    const previous = payloads.map(([k]) => [k, this.ls.getItem(k)]);
    try {
      for (const [k, v] of payloads) this.ls.setItem(k, v);
    } catch (err) {
      for (const [k, v] of previous) {
        try {
          if (v == null) this.ls.removeItem(k);
          else this.ls.setItem(k, v);
        } catch {
          // best effort
        }
      }
      throw err;
    }
  }
}

class MemoryBackend {
  constructor() {
    this.kind = 'memory';
    this.durable = false;
    this.data = new Map(STORES.map((s) => [s, new Map()]));
  }

  async getAll(store) {
    return [...this.data.get(store).values()].map((v) => structuredClone(v));
  }

  async commit(ops) {
    for (const o of ops) {
      const map = this.data.get(o.store);
      if (o.op === 'put') map.set(keyOf(o.store, o.value), structuredClone(o.value));
      else if (o.op === 'delete') map.delete(o.key);
      else if (o.op === 'clear') map.clear();
    }
  }
}

export async function openStorage() {
  try {
    return await IndexedDBBackend.open();
  } catch {
    // fall through
  }
  try {
    return LocalStorageBackend.open();
  } catch {
    // fall through
  }
  return new MemoryBackend();
}

export { MemoryBackend };

// Drafts are written synchronously so they survive the tab closing mid-entry.
const DRAFT_KEY = `${LS_PREFIX}draft`;
let memoryDraft = null;

export const drafts = {
  save(draft) {
    memoryDraft = draft;
    try {
      globalThis.localStorage?.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // memory copy still helps within this session
    }
  },
  load() {
    try {
      const raw = globalThis.localStorage?.getItem(DRAFT_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return memoryDraft;
  },
  clear() {
    memoryDraft = null;
    try {
      globalThis.localStorage?.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  },
};

export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageEstimate() {
  try {
    return (await navigator.storage?.estimate?.()) ?? null;
  } catch {
    return null;
  }
}
