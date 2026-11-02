/**
 * Durable client-side storage: IndexedDB first, localStorage second, memory last.
 *
 * Why this exists. The offline capture queue originally used localStorage
 * directly. Inside a cross-site iframe — how this app is previewed, and how any
 * embedded deployment behaves — browsers block localStorage outright, so a dose
 * captured on a train with no signal was lost the moment the page reloaded. That
 * is the exact scenario offline capture exists for.
 *
 * IndexedDB is partitioned rather than blocked in those contexts, so it survives
 * where localStorage does not. But IndexedDB is asynchronous, and the offline
 * module exposes a synchronous API (`readQueue`, `queueLength`, `enqueueEvent`)
 * that the UI calls during render. Rewriting every consumer to await storage
 * would be a large, risky change for no functional gain.
 *
 * So: one asynchronous hydration on startup fills an in-memory mirror, every
 * synchronous read hits the mirror, and every write updates the mirror
 * immediately then persists in the background. The public API stays synchronous.
 *
 * The trade-off is honest and worth stating: a write made microseconds before
 * the tab is killed may not have reached disk. For a capture queue that is
 * acceptable — the alternative was losing everything on every reload.
 */

const DB_NAME = "vaxbridge-offline";
const DB_VERSION = 1;
const STORE_NAME = "kv";

/** Synchronous mirror of everything persisted. Authoritative for reads. */
const mirror = new Map<string, string>();

type Backend = "indexeddb" | "localstorage" | "memory";

let backend: Backend = "memory";
let db: IDBDatabase | null = null;
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

/** Writes waiting for the database to open. Flushed once on hydrate. */
const pendingWrites: Array<() => void> = [];

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function localStorageUsable(): boolean {
  if (!hasWindow()) return false;
  try {
    const probe = "__vaxbridge_probe__";
    window.localStorage.setItem(probe, "1");
    const ok = window.localStorage.getItem(probe) === "1";
    window.localStorage.removeItem(probe);
    return ok;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!hasWindow() || typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    // A timer guards against the open request never firing, which happens in
    // private-browsing modes and some embedded webviews. Without it, hydration
    // would hang and the queue would stay memory-only forever.
    const timer = setTimeout(() => resolve(null), 3000);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    request.onblocked = () => {
      clearTimeout(timer);
      resolve(null);
    };
  });
}

/**
 * Load persisted values into the mirror. Safe to call repeatedly; only the first
 * call does work. Never throws — a storage failure must not break the app, it
 * just means a shorter memory.
 */
export function hydrate(): Promise<void> {
  if (!hasWindow()) return Promise.resolve();
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    // Seed from localStorage first when it works, so an upgrade from the old
    // queue does not silently discard doses a user captured before this change.
    if (localStorageUsable()) {
      backend = "localstorage";
      try {
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (key && !mirror.has(key)) mirror.set(key, window.localStorage.getItem(key) ?? "");
        }
      } catch {
        /* fall through to IndexedDB */
      }
    }

    db = await openDb();
    if (!db) {
      hydrated = true;
      flushPending();
      return;
    }
    backend = "indexeddb";

    await new Promise<void>((resolve) => {
      try {
        const tx = db!.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const keysReq = store.getAllKeys();
        const valuesReq = store.getAll();
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        tx.oncomplete = () => {
          const keys = (keysReq.result ?? []) as IDBValidKey[];
          const values = (valuesReq.result ?? []) as string[];
          keys.forEach((k, i) => {
            if (typeof k === "string" && values[i] !== undefined) {
              // IndexedDB wins over the localStorage seed: it is the newer tier.
              mirror.set(k, values[i]);
            }
          });
          done();
        };
        tx.onerror = done;
        tx.onabort = done;
        setTimeout(done, 3000);
      } catch {
        resolve();
      }
    });

    hydrated = true;
    flushPending();
  })();

  return hydratePromise;
}

function flushPending(): void {
  while (pendingWrites.length) {
    const write = pendingWrites.shift();
    try {
      write?.();
    } catch {
      /* a failed background persist must not break the caller */
    }
  }
}

function persist(key: string, value: string | null): void {
  const write = () => {
    if (db) {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        if (value === null) store.delete(key);
        else store.put(value, key);
      } catch {
        /* ignore; the mirror still holds the value for this session */
      }
    }
    if (backend !== "memory") {
      try {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      } catch {
        /* blocked storage is expected in an iframe */
      }
    }
  };
  if (!hydrated) pendingWrites.push(write);
  else write();
}

/** Synchronous read from the mirror. */
export function getItem(key: string): string | null {
  return mirror.has(key) ? (mirror.get(key) as string) : null;
}

/** Synchronous write: mirror immediately, persist in the background. */
export function setItem(key: string, value: string): void {
  mirror.set(key, value);
  persist(key, value);
}

/** Synchronous delete. */
export function removeItem(key: string): void {
  mirror.delete(key);
  persist(key, null);
}

/** Every key currently known, for diagnostics and cache management. */
export function keys(): string[] {
  return Array.from(mirror.keys());
}

/** Which tier is actually persisting. Reported in the UI and in diagnostics. */
export function storageState(): {
  backend: Backend;
  hydrated: boolean;
  durable: boolean;
  note: string;
} {
  const notes: Record<Backend, string> = {
    indexeddb: "IndexedDB is persisting this browser's offline queue.",
    localstorage: "localStorage is persisting this browser's offline queue.",
    memory:
      "Neither IndexedDB nor localStorage is available, so captured doses are " +
      "held in memory only and will be lost if this page is closed.",
  };
  return {
    backend,
    hydrated,
    // Memory-only is not durable, and the UI must say so rather than imply that
    // a queued dose is safe.
    durable: backend !== "memory",
    note: notes[backend],
  };
}

/** Test/maintenance helper: drop everything persisted under the given prefix. */
export function clearByPrefix(prefix: string): void {
  for (const key of Array.from(mirror.keys())) {
    if (key.startsWith(prefix)) removeItem(key);
  }
}
