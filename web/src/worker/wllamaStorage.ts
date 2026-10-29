/**
 * Armazenamento dos GGUF para o wllama.
 *
 * O wllama guarda os modelos em OPFS, que so existe em contexto seguro (HTTPS ou
 * localhost). Em HTTP por IP ele cai no backend padrao e o construtor aborta com
 * "No supported storage backend found". O mesmo acontece no `crypto.subtle` que o
 * cache manager usa para nomear os arquivos.
 *
 * Quando falta armazenamento persistente, o motor baixa o GGUF e entrega os
 * blobs direto ao wllama: o modo funciona, o modelo vive so na memoria da aba e
 * o download se repete no proximo carregamento.
 */

import { CacheManager } from "@wllama/wllama/esm/index.js";
import type { StorageBackend } from "@wllama/wllama/esm/storage/index";

/** O wllama consegue guardar o modelo entre sessoes neste navegador? */
export function persistentModelStorageAvailable(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.storage?.getDirectory === "function" &&
      typeof crypto !== "undefined" &&
      typeof crypto.subtle?.digest === "function"
    );
  } catch {
    return false;
  }
}

/**
 * Backend em memoria: o wllama exige algum backend para construir, mesmo quando
 * o modelo e entregue como blob. Nada aqui sobrevive a recarga da pagina.
 */
class MemoryBackend implements StorageBackend {
  private readonly files = new Map<string, Blob>();

  isSupported(): boolean {
    return true;
  }

  async read(key: string): Promise<Blob | null> {
    return this.files.get(key) ?? null;
  }

  async write(key: string, stream: ReadableStream): Promise<void> {
    this.files.set(key, await new Response(stream).blob());
  }

  async getSize(key: string): Promise<number> {
    return this.files.get(key)?.size ?? -1;
  }

  async list(): Promise<Array<{ key: string; size: number }>> {
    return [...this.files].map(([key, blob]) => ({ key, size: blob.size }));
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
}

/** Cache manager do wllama, com memoria como ultimo recurso. */
export function createWllamaCacheManager(): CacheManager {
  return new CacheManager([new MemoryBackend()]);
}
