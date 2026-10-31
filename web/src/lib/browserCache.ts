/**
 * A Cache API so existe em contexto seguro (HTTPS ou localhost). No dev server
 * aberto por IP em HTTP ela falta, e os modelos precisam ser baixados de novo a
 * cada carregamento. As telas usam isto para dizer a verdade sobre o cache.
 */
export function browserCacheAvailable(): boolean {
  try {
    return typeof caches !== "undefined" && typeof caches.open === "function";
  } catch {
    return false;
  }
}

/**
 * O motor guarda os pesos no IndexedDB quando a Cache API/OPFS nao existem.
 * IndexedDB funciona em HTTP por IP, entao o download deixa de se repetir a
 * cada recarga mesmo sem contexto seguro.
 */
export function modelCacheAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined";
  } catch {
    return false;
  }
}
