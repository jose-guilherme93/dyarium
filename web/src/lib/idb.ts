// Minimal IndexedDB cache used to serve GET responses while offline.
const DB_NAME = "dyarium";
const DB_VERSION = 2;
const STORE = "http";
/** Cache dos blocos de analise lidos no navegador. */
export const ANALYSIS_STORE = "analysis";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of [STORE, ANALYSIS_STORE]) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRaw<T>(store: string, key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve) => {
      const tx = db.transaction(store, "readonly");
      const request = tx.objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

async function writeRaw(store: string, key: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // caching is best-effort
  }
}

async function deleteRaw(store: string, key: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // best-effort
  }
}

export async function cacheGet(key: string): Promise<string | undefined> {
  return readRaw<string>(STORE, key);
}

export async function cacheSet(key: string, value: string): Promise<void> {
  await writeRaw(STORE, key, value);
}

/** Leitura/escrita de outros stores do mesmo banco, com o mesmo tratamento. */
export function storeGet<T>(store: string, key: string): Promise<T | undefined> {
  return readRaw<T>(store, key);
}

export function storeSet(store: string, key: string, value: unknown): Promise<void> {
  return writeRaw(store, key, value);
}

export function storeDelete(store: string, key: string): Promise<void> {
  return deleteRaw(store, key);
}
