/**
 * Anexos locais: a imagem da nota vive no IndexedDB do navegador.
 *
 * O markdown guarda `attachment:<id>`, igual ao ambiente servidor, entao a nota
 * continua identica quando sincronizar. O que muda e onde o byte mora: aqui ele
 * nunca sai do aparelho.
 *
 * A URL e derivada do blob (`blob:`), criada sob demanda. Como o `attachmentUrl`
 * e sincrono (roda no render), existe um cache em memoria com assinatura: quem
 * desenha a imagem re-renderiza quando a URL fica pronta.
 */

import {
  ATTACHMENTS_STORE,
  storeDelete,
  storeGet,
  storeList,
  storeSet,
} from "../lib/idb";

import type { Attachment } from "../types";

export interface StoredAttachment extends Attachment {
  blob: Blob;
}

const urls = new Map<string, string>();
const carregando = new Set<string>();
const ouvintes = new Set<() => void>();
let versao = 0;

function avisar(): void {
  versao += 1;
  for (const ouvinte of ouvintes) ouvinte();
}

/** Assinatura para `useSyncExternalStore` nao perder a URL que chega depois. */
export function subscribeAttachmentUrls(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

export function attachmentUrlsVersion(): number {
  return versao;
}

function lembrar(id: string, blob: Blob): string {
  const existente = urls.get(id);
  if (existente) return existente;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

async function carregar(id: string): Promise<void> {
  if (urls.has(id) || carregando.has(id)) return;
  carregando.add(id);
  try {
    const guardado = await storeGet<StoredAttachment>(ATTACHMENTS_STORE, id);
    if (guardado?.blob) {
      lembrar(id, guardado.blob);
      avisar();
    }
  } finally {
    carregando.delete(id);
  }
}

/**
 * URL pronta para o `src`, ou vazio enquanto o blob nao chega. Sincrono porque
 * o render da imagem nao pode esperar.
 */
export function localAttachmentUrl(id: string): string {
  const pronto = urls.get(id);
  if (pronto) return pronto;
  void carregar(id);
  return "";
}

/** Metadado publico: o byte fica no banco. */
function metadataOf(anexo: StoredAttachment): Attachment {
  const { id, entry_id, kind, content_type, size_bytes, created_at } = anexo;
  return { id, entry_id, kind, content_type, size_bytes, created_at };
}

function novoId(): string {
  return `att_${crypto.randomUUID().replace(/-/g, "")}`;
}

/** Grava um anexo inteiro (metadados + byte) no store local. */
export async function saveAttachmentBlob(anexo: StoredAttachment): Promise<void> {
  await storeSet(ATTACHMENTS_STORE, anexo.id, anexo);
  lembrar(anexo.id, anexo.blob);
  avisar();
}

export async function saveLocalAttachment(entryId: string, file: Blob): Promise<Attachment> {
  const anexo: StoredAttachment = {
    id: novoId(),
    entry_id: entryId,
    kind: "original",
    content_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    created_at: new Date().toISOString(),
    blob: file,
  };
  await saveAttachmentBlob(anexo);
  return metadataOf(anexo);
}

export async function listLocalAttachments(entryId: string): Promise<Attachment[]> {
  const todos = await storeList<StoredAttachment>(ATTACHMENTS_STORE);
  return todos
    .map(([, anexo]) => anexo)
    .filter((anexo) => anexo.entry_id === entryId)
    .map(metadataOf);
}

export async function deleteLocalAttachment(id: string): Promise<void> {
  const existente = urls.get(id);
  if (existente) {
    URL.revokeObjectURL(existente);
    urls.delete(id);
  }
  await storeDelete(ATTACHMENTS_STORE, id);
  avisar();
}
