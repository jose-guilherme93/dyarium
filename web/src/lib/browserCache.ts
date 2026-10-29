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
