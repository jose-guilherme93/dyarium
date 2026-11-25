/**
 * O cofre no Google Drive, sem UI.
 *
 * A pasta `Dyarium/` na raiz do Drive e o proprio cofre: o `vaultLayout` grava
 * um `.enc` por conteudo e o `key.txt`/`backup.enc` da pasta valem aqui do mesmo
 * jeito. Este modulo so junta as duas pontas — a sessao (`driveSession`) e o
 * layout/backup — para a primeira tela e as configuracoes chamarem a mesma
 * coisa sem repetir a ordem das operacoes.
 *
 * Nada aqui e fonte unica: o `key.txt` que o sync grava e o mesmo codigo de
 * recuperacao que o navegador guarda, entao o login no Drive desbloqueia o
 * cofre criado em outro aparelho.
 */

import {
  applySnapshot,
  buildNotesSnapshot,
  buildSnapshot,
  openSnapshot,
  sealSnapshot,
  vaultIdFromCode,
  type RestoreResult,
  type StepProgress,
} from "./backup";
import { driveVaultRoot } from "./driveSession";
import { BACKUP_FILE, KEY_FILE, STATE_FILE } from "./folder";
import { runVaultSync, setVaultWriteHook, type SyncResult } from "./folderSync";
import { ATTACHMENTS_STORE, storeGet } from "../lib/idb";
import { saveAttachmentBlob, type StoredAttachment } from "./attachments";
import {
  ensureVaultCode,
  formatRecoveryCode,
  isValidRecoveryCode,
  normalizeRecoveryCode,
  setVaultCode,
  vaultKeyFromCode,
} from "./vault";
import {
  readVaultFile,
  readVaultManifest,
  type VaultFileEntry,
  type VaultFolderLike,
  type VaultManifest,
} from "./vaultLayout";

/** Etapas que a tela de carregamento acompanha; nunca carregam segredo. */
export type VaultStage =
  | "conectando"
  | "lendo"
  | "decifrando"
  | "aplicando"
  | "anexos"
  | "sincronizando";

export interface VaultOptions {
  onStage?: (stage: VaultStage) => void;
  /** Contagem real do passo atual; nao existe em "sincronizando". */
  onProgress?: (p: StepProgress) => void;
}

export interface AttachmentRestoreResult {
  restored: number;
  skipped: number;
}

export interface RestoreDriveResult extends RestoreResult {
  /** Anexos (audio e imagem) que voltaram do cofre para o IndexedDB. */
  attachments: AttachmentRestoreResult;
  /** `state` quando o retrato completo existia; `backup` no cofre antigo. */
  source: "state" | "backup";
}

/** A tela de loading e so aviso: um callback quebrado nao derruba o cofre. */
function avisarStage(options: VaultOptions, stage: VaultStage): void {
  try {
    options.onStage?.(stage);
  } catch {
    // segue o restore/sync; a tela se recupera na proxima etapa
  }
}

function avisarProgresso(options: VaultOptions, done: number, total: number): void {
  try {
    options.onProgress?.({ done, total });
  } catch {
    // a contagem e so para a tela; o restore continua
  }
}

async function arquivoExiste(folder: VaultFolderLike, nome: string): Promise<boolean> {
  try {
    await folder.getFileHandle(nome);
    return true;
  } catch {
    return false;
  }
}

async function escrever(
  folder: VaultFolderLike,
  nome: string,
  dados: string | Uint8Array,
): Promise<void> {
  const handle = await folder.getFileHandle(nome, { create: true });
  const writable = await handle.createWritable();
  await writable.write(dados);
  await writable.close();
}

/**
 * Re-sela os snapshots do cofre (key.txt, backup.enc, state.enc) na pasta
 * indicada. Extraido de `syncVaultToDrive` para que o backup automatico do
 * layout (folderSync) possa re-selar apos uma escrita, sem duplicar a ordem
 * das operacoes.
 */
export async function writeVaultSnapshots(folder: VaultFolderLike): Promise<void> {
  const codigo = await ensureVaultCode();
  const chave = await vaultKeyFromCode(codigo);
  const vaultId = await vaultIdFromCode(codigo);
  await escrever(folder, KEY_FILE, formatRecoveryCode(codigo));
  // O v1 e o arquivo de compatibilidade com o app; o v2 e o estado do web.
  await escrever(folder, BACKUP_FILE, await sealSnapshot(await buildNotesSnapshot(vaultId), chave));
  await escrever(folder, STATE_FILE, await sealSnapshot(await buildSnapshot(vaultId), chave));
}

/**
 * Grava o cofre na pasta do Drive e garante a chave ao lado.
 *
 * O `backup.enc` leva o retrato v1 (so notas) que o app tambem le; o
 * `state.enc` leva o retrato v2 completo do web. Os tres arquivos sao escritos
 * quando a pasta ainda nao os tem: um sync sem mudanca (com os tres presentes)
 * nao reescreve nada; as mudancas de layout sao seladas pelo gancho do
 * folderSync.
 */
export async function syncVaultToDrive(
  root?: VaultFolderLike,
  options: VaultOptions = {},
): Promise<SyncResult | null> {
  const alvo = root ?? (await driveVaultRoot());
  avisarStage(options, "sincronizando");
  const resultado = await runVaultSync(alvo);
  const completo =
    (await arquivoExiste(alvo, KEY_FILE)) &&
    (await arquivoExiste(alvo, BACKUP_FILE)) &&
    (await arquivoExiste(alvo, STATE_FILE));
  if (!completo) {
    await writeVaultSnapshots(alvo);
  }
  return resultado;
}

/**
 * Adota o cofre que esta no Drive: a chave do `key.txt` substitui a deste
 * navegador, o retrato entra sem passar por cima de trabalho local mais novo e,
 * por fim, os anexos voltam do layout para o IndexedDB.
 *
 * O `state.enc` (v2 completo) manda quando existe; sem ele, vale o
 * `backup.enc` v1, que so tem notas — cofre antigo restaura como antes.
 */
export async function restoreVaultFromDrive(
  root?: VaultFolderLike,
  options: VaultOptions = {},
): Promise<RestoreDriveResult> {
  const alvo = root ?? (await driveVaultRoot());
  avisarStage(options, "lendo");
  const chaveHandle = await alvo.getFileHandle(KEY_FILE).catch(() => {
    throw new Error("o Drive nao tem cofre do Dyarium");
  });
  const codigo = normalizeRecoveryCode((await (await chaveHandle.getFile()).text()).trim());
  if (!(await isValidRecoveryCode(codigo))) {
    throw new Error(`${KEY_FILE} nao tem um codigo valido`);
  }
  await setVaultCode(codigo);

  const stateHandle = await alvo.getFileHandle(STATE_FILE).catch(() => null);
  const backupHandle = stateHandle
    ? null
    : await alvo.getFileHandle(BACKUP_FILE).catch(() => {
        throw new Error("o cofre do Drive nao tem retrato (backup.enc)");
      });
  const retratoHandle = stateHandle ?? backupHandle;
  if (!retratoHandle) throw new Error("o cofre do Drive nao tem retrato");
  const sealed = new Uint8Array(await (await retratoHandle.getFile()).arrayBuffer());
  if (sealed.length === 0) throw new Error(`${stateHandle ? STATE_FILE : BACKUP_FILE} esta vazio`);

  avisarStage(options, "decifrando");
  const chave = await vaultKeyFromCode(codigo);
  const snapshot = await openSnapshot(sealed, chave);

  avisarStage(options, "aplicando");
  const resumo = await applySnapshot(snapshot, { onProgress: options.onProgress });

  // Mesma chamada: sem os anexos a nota volta muda, sem o audio original.
  const attachments = await restoreAttachmentsFromVault(alvo, undefined, options);
  return { ...resumo, attachments, source: stateHandle ? "state" : "backup" };
}

/** Tamanho real do cofre, lido do manifest em claro; sem manifest, tudo zero. */
export interface VaultSummary {
  /** Notas soltas e capitulos de livro/projeto. */
  notes: number;
  attachments: number;
  bytes: number;
}

export interface OpenDriveVaultResult {
  /** `null` quando a pasta ainda nao tem `key.txt` (cofre novo). */
  restored: RestoreDriveResult | null;
  synced: SyncResult | null;
  summary: VaultSummary;
}

/**
 * Abre o cofre do Drive para o app: restaura o que ja existe e, sempre, sobe o
 * banco local por cima.
 *
 * A segunda metade conserta o retrato vazio: entrar num cofre que so tinha
 * `key.txt` e um `backup.enc` sem notas restaurava nada e parava ali — sem
 * escrita, o cofre nunca ficava sujo e o sync nunca rodava, deixando as notas
 * deste navegador fora do Drive. Toda abertura agora termina com um sync, que
 * grava o que so existe local e reescreve o retrato quando o layout mudou.
 */
export async function openDriveVault(
  root: VaultFolderLike,
  options: VaultOptions = {},
): Promise<OpenDriveVaultResult> {
  const restored = (await driveVaultExists(root))
    ? await restoreVaultFromDrive(root, options)
    : null;
  // O sync emite "sincronizando"; "lendo" fica so com a restauracao, sem
  // repetir a etapa na tela.
  const synced = await syncVaultToDrive(root, options);
  const summary = await vaultSummary(root);
  return { restored, synced, summary };
}

/**
 * Confere que os tres snapshots existem e nao estao vazios. O sair da conta so
 * apaga o cache local depois desta resposta; arquivo presente e vazio nao serve.
 */
export async function vaultSnapshotsWritten(root?: VaultFolderLike): Promise<boolean> {
  const alvo = root ?? (await driveVaultRoot());
  for (const nome of [KEY_FILE, BACKUP_FILE, STATE_FILE]) {
    try {
      const handle = await alvo.getFileHandle(nome);
      const bytes = await (await handle.getFile()).arrayBuffer();
      if (bytes.byteLength === 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Le o `manifest.json` e devolve o tamanho do cofre para a tela: notas (com
 * capitulos), anexos e a soma dos tamanhos gravados. Pasta sem manifest ainda
 * nao tem cofre, entao tudo zero.
 */
export async function vaultSummary(root: VaultFolderLike): Promise<VaultSummary> {
  const manifest = await readVaultManifest(root);
  if (!manifest) return { notes: 0, attachments: 0, bytes: 0 };
  let notes = 0;
  let attachments = 0;
  let bytes = 0;
  for (const arquivo of manifest.files) {
    if (arquivo.kind === "note" || arquivo.kind === "chapter") notes += 1;
    if (arquivo.kind === "attachment") attachments += 1;
    if (typeof arquivo.size === "number" && Number.isFinite(arquivo.size)) {
      bytes += arquivo.size;
    }
  }
  return { notes, attachments, bytes };
}

/**
 * Traz os anexos do layout (`attachments/<id>.<ext>.enc`) para o IndexedDB.
 *
 * O manifest v4 guarda `entry_id` e `content_type`, o que basta para
 * reconstruir o `StoredAttachment`; v3 (sem esses campos) nao restaura nada e
 * devolve zero, sem erro. O que ja existe no banco e pulado pelo id, para o
 * login de todo dia nao regravar centenas de audios.
 */
export async function restoreAttachmentsFromVault(
  root?: VaultFolderLike,
  manifest?: VaultManifest,
  options: VaultOptions = {},
): Promise<AttachmentRestoreResult> {
  const alvo = root ?? (await driveVaultRoot());
  const lido = manifest ?? (await readVaultManifest(alvo));
  if (!lido || lido.version < 4) return { restored: 0, skipped: 0 };

  const anexos = lido.files.filter(
    (
      arquivo,
    ): arquivo is VaultFileEntry & { entry_id: string; content_type: string } =>
      arquivo.kind === "attachment" &&
      typeof arquivo.entry_id === "string" &&
      arquivo.entry_id.length > 0 &&
      typeof arquivo.content_type === "string" &&
      arquivo.content_type.length > 0,
  );
  avisarStage(options, "anexos");
  if (anexos.length === 0) return { restored: 0, skipped: 0 };

  const total = anexos.length;
  avisarProgresso(options, 0, total);

  const codigo = await ensureVaultCode();
  const chave = await vaultKeyFromCode(codigo);
  let restored = 0;
  let skipped = 0;
  let done = 0;
  for (const entrada of anexos) {
    const existente = await storeGet<StoredAttachment>(ATTACHMENTS_STORE, entrada.id);
    if (existente) {
      skipped += 1;
    } else {
      try {
        const bytes = await readVaultFile(alvo, entrada.path, chave);
        await saveAttachmentBlob({
          id: entrada.id,
          entry_id: entrada.entry_id,
          kind: "original",
          content_type: entrada.content_type,
          size_bytes: bytes.length,
          created_at: entrada.updated_at,
          // Copia para um ArrayBuffer proprio: o BlobPart do TS recusa a visao
          // generica de Uint8Array.
          blob: new Blob([new Uint8Array(bytes)], { type: entrada.content_type }),
        });
        restored += 1;
      } catch {
        // Um arquivo corrompido ou ausente nao pode impedir os outros anexos.
        skipped += 1;
      }
    }
    done += 1;
    avisarProgresso(options, done, total);
  }
  return { restored, skipped };
}

/** Ha cofre do Dyarium nesta pasta? O `key.txt` e a marca. */
export async function driveVaultExists(root?: VaultFolderLike): Promise<boolean> {
  const alvo = root ?? (await driveVaultRoot());
  return arquivoExiste(alvo, KEY_FILE);
}

// O backup automatico do layout (folderSync) re-sela os snapshots na mesma
// pasta, para Drive e para a pasta do File System Access, sem sessao extra.
setVaultWriteHook((folder) => writeVaultSnapshots(folder));
