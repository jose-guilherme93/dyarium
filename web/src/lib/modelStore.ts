/**
 * IndexedDB separado para os pesos dos modelos.
 *
 * Fica fora do banco principal de proposito: subir a versao do `dyarium` faria
 * as outras abas com o banco antigo bloquearem o upgrade, e a analise por bloco
 * perderia o cache. Um banco novo nao disputa versao com o que ja esta aberto.
 * IndexedDB funciona em HTTP por IP, onde OPFS e Cache API nao existem.
 */

const DB_NAME = "dyarium-models";
const DB_VERSION = 1;
const STORE = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function modelStoreGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

export async function modelStoreSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Sem quota ou sem IndexedDB: o modelo vale para esta sessao.
  }
}

export async function modelStoreDelete(key: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // best-effort
  }
}
