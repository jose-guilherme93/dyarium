/**
 * Cache dos pesos no IndexedDB.
 *
 * O `transformers.js` usa a Cache API (e o `wllama`, OPFS) para nao baixar o
 * modelo de novo. Os dois exigem contexto seguro, entao em HTTP por IP o
 * download recomecava a cada aba. O IndexedDB existe em HTTP e guarda Blobs;
 * este cache implementa a mesma interface que o `transformers.js` espera.
 */

import { modelStoreDelete, modelStoreGet, modelStoreSet } from "../lib/modelStore";

interface CachedResponse {
  blob: Blob;
  headers: [string, string][];
  status: number;
  statusText: string;
}

export interface HttpCache {
  match(request: string): Promise<Response | undefined>;
  put(
    request: string,
    response: Response,
    progress?: (data: { progress: number; loaded: number; total: number }) => void,
  ): Promise<void>;
  delete(request: string): Promise<boolean>;
}

/**
 * Le o corpo uma unica vez, avisa o progresso e guarda o Blob. Testar quota
 * antes nao ajuda: o navegador so decide no `put`, e um modelo grande pode
 * passar dela. A falha e silenciosa de proposito; o download desta sessao
 * continua valido e o wllama recebe os blobs na memoria.
 */
async function storeResponse(
  key: string,
  response: Response,
  progress?: (data: { progress: number; loaded: number; total: number }) => void,
): Promise<void> {
  if (!response.ok) return;
  try {
    const total = Number(response.headers.get("content-length") ?? 0);
    const parts: BlobPart[] = [];
    let loaded = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        parts.push(chunk.value);
        loaded += chunk.value.byteLength;
        progress?.({ progress: total > 0 ? loaded / total : 0, loaded, total });
      }
    } else {
      const buffer = await response.arrayBuffer();
      parts.push(buffer);
      loaded = buffer.byteLength;
      progress?.({ progress: 1, loaded, total: loaded });
    }
    if (loaded === 0) return;
    const record: CachedResponse = {
      blob: new Blob(parts),
      headers: [...response.headers],
      status: response.status,
      statusText: response.statusText,
    };
    await modelStoreSet(key, record);
  } catch {
    // Sem quota ou sem IndexedDB: o modelo vale para esta sessao.
  }
}

export function createIndexedDbHttpCache(): HttpCache {
  return {
    async match(request) {
      const record = await modelStoreGet<CachedResponse>(request);
      if (!record?.blob) return undefined;
      return new Response(record.blob, {
        status: record.status || 200,
        statusText: record.statusText || "OK",
        headers: record.headers,
      });
    },
    put(request, response, progress) {
      return storeResponse(request, response, progress);
    },
    async delete(request) {
      await modelStoreDelete(request);
      return true;
    },
  };
}
