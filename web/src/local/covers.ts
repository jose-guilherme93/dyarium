/**
 * Capa do livro no cofre local: o byte vive no IndexedDB do navegador.
 *
 * No ambiente servidor a capa vem de `GET /notebooks/:id/cover`; aqui ela nunca
 * sai do aparelho. A chave e o id do livro, entao existe uma capa por livro e
 * salvar de novo sobrescreve.
 *
 * A URL e derivada do blob (`blob:`), criada sob demanda. Como `localCoverUrl`
 * e sincrono (roda no render), existe um cache em memoria com assinatura: quem
 * desenha a capa re-renderiza quando a URL fica pronta. A versao (o
 * `cover_updated_at` de quem chamou) entra na identidade do cache, de modo que
 * uma capa nova gera uma URL nova.
 */

import { COVERS_STORE, storeDelete, storeGet, storeSet } from "../lib/idb";

export interface StoredCover {
  book_id: string;
  blob: Blob;
  content_type: string;
  updated_at: string;
}

/** Chave do cache: livro e versao, com null e "" como a mesma versao. */
const urls = new Map<string, string>();
const carregando = new Set<string>();
const ouvintes = new Set<() => void>();
let versao = 0;

function chaveDe(bookId: string, version?: string | null): string {
  return `${bookId}|${version ?? ""}`;
}

function avisar(): void {
  versao += 1;
  for (const ouvinte of ouvintes) ouvinte();
}

/** Assinatura para `useSyncExternalStore` nao perder a URL que chega depois. */
export function subscribeCoverUrls(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

export function coverUrlsVersion(): number {
  return versao;
}

/** Esquece as URLs do livro, revogando cada blob uma unica vez. */
function esquecer(bookId: string): void {
  const prefixo = `${bookId}|`;
  const revogadas = new Set<string>();
  for (const [chave, url] of urls) {
    if (!chave.startsWith(prefixo)) continue;
    urls.delete(chave);
    if (revogadas.has(url)) continue;
    revogadas.add(url);
    URL.revokeObjectURL(url);
  }
}

async function carregar(bookId: string, version: string): Promise<void> {
  const chave = chaveDe(bookId, version);
  if (urls.has(chave) || carregando.has(chave)) return;
  carregando.add(chave);
  try {
    const guardada = await storeGet<StoredCover>(COVERS_STORE, bookId);
    if (!guardada?.blob) return;
    // Salvar ou apagar durante a leitura ganha: a URL ja esta resolvida.
    if (urls.has(chave)) return;
    urls.set(chave, URL.createObjectURL(guardada.blob));
    avisar();
  } finally {
    carregando.delete(chave);
  }
}

/**
 * URL pronta para o `src`, ou vazio enquanto o blob nao chega. Sincrono porque
 * o render da capa nao pode esperar.
 */
export function localCoverUrl(bookId: string, version?: string | null): string {
  const chave = chaveDe(bookId, version);
  const pronto = urls.get(chave);
  if (pronto) return pronto;
  void carregar(bookId, version ?? "");
  return "";
}

export async function saveLocalCover(bookId: string, image: Blob): Promise<{ updated_at: string }> {
  const capa: StoredCover = {
    book_id: bookId,
    blob: image,
    content_type: image.type || "application/octet-stream",
    updated_at: new Date().toISOString(),
  };
  await storeSet(COVERS_STORE, bookId, capa);
  esquecer(bookId);
  const url = URL.createObjectURL(image);
  // Sem versao e com a versao recem-criada: quem acabou de salvar ja tem URL,
  // com ou sem o `cover_updated_at` novo em maos.
  urls.set(chaveDe(bookId), url);
  urls.set(chaveDe(bookId, capa.updated_at), url);
  avisar();
  return { updated_at: capa.updated_at };
}

/** Byte da capa, para exportacao e backup. */
export async function localCoverBlob(bookId: string): Promise<Blob> {
  const guardada = await storeGet<StoredCover>(COVERS_STORE, bookId);
  if (!guardada?.blob) throw new Error("capa indisponivel");
  return guardada.blob;
}

export async function deleteLocalCover(bookId: string): Promise<void> {
  esquecer(bookId);
  await storeDelete(COVERS_STORE, bookId);
  avisar();
}
