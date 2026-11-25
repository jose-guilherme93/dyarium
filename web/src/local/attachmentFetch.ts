/**
 * Anexo sob demanda no cofre do Drive.
 *
 * O login traz o retrato de metadados (notas, cadernos e o caminho de cada
 * anexo) sem o byte. Quando a nota que usa um audio ou uma imagem e aberta, o
 * anexo dela desce do cofre: manifest, `readVaultFile`, `saveAttachmentBlob`.
 * Um arquivo por vez, e so o que a nota pediu.
 *
 * A falha fica no proprio anexo: a nota abre igual, o texto continua legivel e
 * a proxima abertura tenta de novo. Nada aqui lanca para quem chamou.
 */

import { localAttachment, saveAttachmentBlob, type StoredAttachment } from "./attachments";
import { driveMarked } from "./driveMark";
import { driveSessionState, driveVaultRoot, onDriveSessionChange } from "./driveSession";
import { ensureVaultCode, vaultKeyFromCode } from "./vault";
import {
  readVaultFile,
  readVaultManifest,
  type VaultFolderLike,
  type VaultManifest,
} from "./vaultLayout";

export type AttachmentFetchStatus = "idle" | "loading" | "error";

export interface AttachmentFetchState {
  /**
   * `idle` e o estado normal: ou o byte ja esta aqui (a URL resolve), ou nao ha
   * nada remoto a buscar. `loading` e `error` sao os unicos que a tela desenha.
   */
  status: AttachmentFetchStatus;
  /** Motivo em uma linha para o anexo isolado; vazio fora do erro. */
  reason: string;
}

const INICIAL: AttachmentFetchState = { status: "idle", reason: "" };

/** Anexo que o manifest nao lista: nao adianta reler o cofre para cada id. */
class AttachmentMissing extends Error {}

const estados = new Map<string, AttachmentFetchState>();
const emCurso = new Map<string, Promise<void>>();
const ouvintes = new Set<() => void>();
let versao = 0;
/** Pasta e manifest da sessao: um anexo da mesma nota nao relê o cofre. */
let cofre: { root: VaultFolderLike; manifest: VaultManifest | null } | null = null;

function avisar(): void {
  versao += 1;
  for (const ouvinte of [...ouvintes]) {
    try {
      ouvinte();
    } catch {
      // Um ouvinte quebrado nao pode impedir os outros de ver o estado.
    }
  }
}

function definir(id: string, estado: AttachmentFetchState): void {
  estados.set(id, estado);
  avisar();
}

export function attachmentFetchVersion(): number {
  return versao;
}

export function subscribeAttachmentFetch(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function attachmentFetchState(id: string): AttachmentFetchState {
  return estados.get(id) ?? INICIAL;
}

/** Zera o cache de pasta/manifest e os estados entre sessoes e testes. */
export function resetAttachmentFetch(): void {
  cofre = null;
  estados.clear();
  emCurso.clear();
  avisar();
}

// A sessao vive fora do React e morre no reload: pasta e manifest de uma sessao
// antiga nao servem de nada depois de reconectar.
onDriveSessionChange(() => {
  cofre = null;
});

async function abrirCofre(): Promise<{ root: VaultFolderLike; manifest: VaultManifest | null }> {
  if (!cofre) {
    const root = await driveVaultRoot();
    cofre = { root, manifest: await readVaultManifest(root) };
  }
  return cofre;
}

async function baixar(id: string, existente: StoredAttachment | undefined): Promise<void> {
  const atual = await abrirCofre();
  const entrada = atual.manifest?.files.find(
    (arquivo) => arquivo.kind === "attachment" && arquivo.id === id,
  );
  const caminho = entrada?.path ?? existente?.vault_path ?? "";
  if (!entrada || !caminho) {
    throw new AttachmentMissing("o anexo nao esta no manifest do cofre");
  }
  const content_type =
    entrada.content_type ?? existente?.content_type ?? "application/octet-stream";
  const entry_id = entrada.entry_id ?? existente?.entry_id ?? "";
  const chave = await vaultKeyFromCode(await ensureVaultCode());
  const bytes = await readVaultFile(atual.root, caminho, chave);
  await saveAttachmentBlob({
    id,
    entry_id,
    kind: "original",
    content_type,
    size_bytes: bytes.length,
    created_at: entrada.updated_at ?? existente?.created_at ?? new Date().toISOString(),
    vault_path: caminho,
    // Copia para um ArrayBuffer proprio: o BlobPart do TS recusa a visao
    // generica de Uint8Array.
    blob: new Blob([new Uint8Array(bytes)], { type: content_type }),
  });
  definir(id, INICIAL);
}

async function buscar(id: string): Promise<void> {
  try {
    const existente = await localAttachment(id);
    if (existente?.blob) {
      if (estados.has(id)) definir(id, INICIAL);
      return;
    }
    // Sem a marca deste navegador nao ha cofre para consultar, e pedir a pasta
    // ao Drive criaria uma `Dyarium/` vazia por causa de uma imagem.
    if (!driveMarked()) return;
    if (driveSessionState() !== "connected") {
      if (existente) {
        definir(id, { status: "error", reason: "sessão do Drive vencida" });
      }
      return;
    }
    definir(id, { status: "loading", reason: "" });
    await baixar(id, existente);
  } catch (causa) {
    // Pasta/manifest podem ter mudado (sync de outro aparelho): a proxima
    // tentativa rele em vez de repetir um caminho velho. Anexo que o manifest
    // simplesmente nao lista nao justifica reler o cofre a cada id.
    if (!(causa instanceof AttachmentMissing)) cofre = null;
    console.warn("[drive] anexo sob demanda falhou", causa);
    definir(id, { status: "error", reason: "anexo indisponível agora" });
  } finally {
    emCurso.delete(id);
  }
}

/**
 * Garante o byte do anexo neste navegador. Idempotente: a mesma nota pedindo
 * duas vezes espera uma busca so, e o anexo que ja chegou nao toca no Drive.
 * Nunca rejeita — o erro fica em `attachmentFetchState`.
 */
export function ensureAttachment(id: string): Promise<void> {
  const existente = emCurso.get(id);
  if (existente) return existente;
  const fila = buscar(id);
  emCurso.set(id, fila);
  return fila;
}

/** Nova tentativa explicita do anexo isolado (abrir de novo tambem tenta). */
export function retryAttachment(id: string): Promise<void> {
  estados.delete(id);
  avisar();
  return ensureAttachment(id);
}
