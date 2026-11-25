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
 *
 * Duas velocidades, de proposito:
 *
 * - login (`openDriveVault`): le chave e retrato, aplica notas/cadernos e le o
 *   manifest. O sync e as capas seguem em segundo plano, e o byte de cada anexo
 *   chega quando a nota que o usa e aberta (`attachmentFetch`);
 * - restauracao manual (`attachments: "all"`): baixa os anexos junto, como
 *   antes, porque quem pediu restauracao quer o cofre inteiro agora.
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
import { rememberDriveVault } from "./driveMark";
import { driveVaultRoot } from "./driveSession";
import { BACKUP_FILE, KEY_FILE, STATE_FILE } from "./folder";
import { runVaultSync, setVaultWriteHook, type SyncResult } from "./folderSync";
import { ATTACHMENTS_STORE, COVERS_STORE, storeGet, storeList, storeSetMany } from "../lib/idb";
import { saveAttachmentBlob, type StoredAttachment } from "./attachments";
import { saveCoverBlob, type StoredCover } from "./covers";
import {
  beginVaultActivity,
  endVaultActivity,
  updateVaultActivity,
} from "./vaultActivity";
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

/** Anexo que nao veio no retrato de metadados, achado pelo manifest. */
type VaultAttachmentEntry = VaultFileEntry & {
  entry_id: string;
  content_type: string;
};

export interface VaultOptions {
  onStage?: (stage: VaultStage) => void;
  /** Contagem real do passo atual; nao existe em "sincronizando". */
  onProgress?: (p: StepProgress) => void;
  /**
   * O que fazer com os bytes dos anexos.
   *
   * - `"skip"` (login): so o metadado e o caminho do `.enc` entram no
   *   IndexedDB; o byte chega quando a nota e aberta;
   * - `"all"`: baixa todos agora (restauracao manual).
   */
  attachments?: "skip" | "all";
  /**
   * Quando o sync roda em relacao a abertura.
   *
   * - `"background"` (login): a abertura volta antes, e o sync termina atras,
   *   com o sinal discreto da linha do Drive;
   * - `"now"`: espera o sync antes de devolver.
   */
  sync?: "background" | "now";
  /** Manifest ja lido pela abertura: evita uma segunda leitura no Drive. */
  manifest?: VaultManifest | null;
}

export interface AttachmentRestoreResult {
  restored: number;
  skipped: number;
}

export interface CoverRestoreResult {
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

/** IV de 12 bytes + tag GCM de 16: o que o envelope selado soma ao conteudo. */
const ENVELOPE_BYTES = 28;

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
 * conforme `attachments`, os anexos entram inteiros ou so como metadado.
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
  const manifest =
    options.manifest !== undefined ? options.manifest : await readVaultManifest(alvo);

  avisarStage(options, "aplicando");
  const resumo = await applySnapshot(snapshot, { onProgress: options.onProgress });

  const modoAnexos = options.attachments ?? "skip";
  let attachments: AttachmentRestoreResult;
  if (modoAnexos === "all") {
    // Restauracao manual: o cofre inteiro agora, anexos e capas.
    attachments = await restoreAttachmentsFromVault(alvo, manifest, options);
    await restoreCoversFromVault(alvo, manifest, options);
  } else {
    // Login: so o metadado, para a nota ja mostrar que tem audio/imagem e o
    // `.enc` remoto nao ser apagado pelo proximo sync.
    attachments = await deferAttachmentsFromVault(alvo, manifest);
    await deferCoversFromVault(alvo, manifest);
  }
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
  /** `null` quando o sync ficou para o segundo plano. */
  synced: SyncResult | null;
  summary: VaultSummary;
  /** O trabalho que ficou para depois da casca; `null` quando nada ficou. */
  background: Promise<void> | null;
}

/** Manifest em claro vira o resumo da tela, sem contar nada no Drive. */
function resumoDoManifest(manifest: VaultManifest | null): VaultSummary {
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
 * Abre o cofre do Drive para o app.
 *
 * A abertura termina quando o retrato esta aplicado e o resumo lido do
 * manifest: a lista de notas ja pode aparecer. O sync sobe o que so existe
 * local e reescreve o retrato quando o layout mudou; no caminho de login ele
 * roda em segundo plano, marcado por `vaultActivity`, sem segurar a tela nem
 * repassar etapa para o `VaultBoot`.
 *
 * Cofre novo (`key.txt` ausente) e a excecao: e o sync que cria o cofre, entao
 * ele termina antes do retorno. `sync: "now"` forca o mesmo em cofre existente.
 */
export async function openDriveVault(
  root: VaultFolderLike,
  options: VaultOptions = {},
): Promise<OpenDriveVaultResult> {
  const existe = await driveVaultExists(root);
  const manifest = await readVaultManifest(root);
  const restored = existe
    ? await restoreVaultFromDrive(root, { attachments: "skip", ...options, manifest })
    : null;
  const summary = resumoDoManifest(manifest);

  if (!existe || options.sync === "now") {
    const synced = await syncVaultToDrive(root, options);
    // O sync acabou de gravar o cofre: o resumo lido agora e o de verdade.
    return {
      restored,
      synced,
      summary: resumoDoManifest(await readVaultManifest(root)),
      background: null,
    };
  }

  return {
    restored,
    synced: null,
    summary,
    background: seguirEmSegundoPlano(root),
  };
}

/**
 * O que fica para depois do app aparecer: o sync e as capas.
 *
 * Sem `onStage`: a tela de carregamento ja saiu, e reemitir etapa reabriria o
 * overlay. O sinal e a linha discreta do Drive, alimentada por `vaultActivity`.
 * A falha fica no estado (uma linha na tela e o motivo no console): nada
 * derruba o app, e o sync tenta de novo pelo prazo do `folderSync`.
 */
let trabalhoDeFundo: Promise<void> | null = null;

/** Espera o trabalho de segundo plano do login terminar; nunca rejeita. */
export async function waitVaultBackground(): Promise<void> {
  if (trabalhoDeFundo) await trabalhoDeFundo;
}

function seguirEmSegundoPlano(root: VaultFolderLike): Promise<void> {
  const token = beginVaultActivity("sincronizando");
  const tarefa = (async () => {
    try {
      await syncVaultToDrive(root);
      // O numero da linha do Drive passa a ser o do cofre recem-gravado.
      rememberDriveVault(resumoDoManifest(await readVaultManifest(root)));
      await restoreCoversFromVault(root, undefined, {
        onStage: () => updateVaultActivity(token, { stage: "anexos", progress: null }),
        onProgress: (progress) => updateVaultActivity(token, { stage: "anexos", progress }),
      });
      endVaultActivity(token);
    } catch (causa) {
      // O motivo tecnico fica no console; a linha mostra uma frase acionavel.
      console.warn("[drive] o segundo plano do cofre falhou", causa);
      endVaultActivity(token, "não foi possível concluir o Drive");
    }
  })();
  trabalhoDeFundo = tarefa;
  void tarefa.finally(() => {
    if (trabalhoDeFundo === tarefa) trabalhoDeFundo = null;
  });
  return tarefa;
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
 * nao tem cofre, entao tudo zero. Quem ja leu o manifest passa o mesmo, sem
 * uma segunda leitura no Drive.
 */
export async function vaultSummary(
  root: VaultFolderLike,
  manifest?: VaultManifest | null,
): Promise<VaultSummary> {
  return resumoDoManifest(manifest !== undefined ? manifest : await readVaultManifest(root));
}

/** Anexos com `entry_id`/`content_type`: o que basta para reconstruir o blob. */
function anexosDoManifest(manifest: VaultManifest | null): VaultAttachmentEntry[] {
  if (!manifest || manifest.version < 4) return [];
  return manifest.files.filter(
    (arquivo): arquivo is VaultAttachmentEntry =>
      arquivo.kind === "attachment" &&
      typeof arquivo.entry_id === "string" &&
      arquivo.entry_id.length > 0 &&
      typeof arquivo.content_type === "string" &&
      arquivo.content_type.length > 0,
  );
}

/** Nome do arquivo pelo tipo: o manifest nao guarda o `content_type` da capa. */
function tipoDeImagem(bytes: Uint8Array): string {
  const comeca = (...assinatura: number[]): boolean =>
    bytes.length >= assinatura.length && assinatura.every((byte, i) => bytes[i] === byte);
  if (comeca(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (comeca(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (comeca(0x47, 0x49, 0x46)) return "image/gif";
  if (
    comeca(0x52, 0x49, 0x46, 0x46) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "application/octet-stream";
}

/**
 * Traz os anexos do layout (`attachments/<id>.<ext>.enc`) para o IndexedDB.
 *
 * O manifest v4 guarda `entry_id` e `content_type`, o que basta para
 * reconstruir o `StoredAttachment`; v3 (sem esses campos) nao restaura nada e
 * devolve zero, sem erro. O que ja tem byte no banco e pulado pelo id, para o
 * login de todo dia nao regravar centenas de audios. Metadado sem byte (vindo
 * do login rapido) e completado aqui: e a restauracao manual pedindo os bytes.
 */
export async function restoreAttachmentsFromVault(
  root?: VaultFolderLike,
  manifest?: VaultManifest | null,
  options: VaultOptions = {},
): Promise<AttachmentRestoreResult> {
  const alvo = root ?? (await driveVaultRoot());
  const lido = manifest !== undefined ? manifest : await readVaultManifest(alvo);
  const anexos = anexosDoManifest(lido);
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
    if (existente?.blob) {
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
          vault_path: entrada.path,
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

/**
 * Guarda so o metadado dos anexos que o retrato lista: id, nota dona, tipo,
 * tamanho e o caminho do `.enc`. Nenhum byte e baixado.
 *
 * Serve a duas coisas no login rapido: a nota aberta ja sabe que tem audio e
 * pode buscar o byte (`attachmentFetch`), e o sync enxerga o anexo que ainda
 * nao esta neste navegador em vez de apaga-lo do Drive.
 */
export async function deferAttachmentsFromVault(
  root?: VaultFolderLike,
  manifest?: VaultManifest | null,
): Promise<AttachmentRestoreResult> {
  const alvo = root ?? (await driveVaultRoot());
  const lido = manifest !== undefined ? manifest : await readVaultManifest(alvo);
  const anexos = anexosDoManifest(lido);
  if (anexos.length === 0) return { restored: 0, skipped: 0 };

  const existentes = new Map(
    (await storeList<StoredAttachment>(ATTACHMENTS_STORE)).map(([id, anexo]) => [id, anexo]),
  );
  const novos: Array<[string, StoredAttachment]> = [];
  let skipped = 0;
  for (const entrada of anexos) {
    const existente = existentes.get(entrada.id);
    if (existente?.blob) {
      // Ja esta inteiro aqui: so o caminho pode faltar num cache antigo.
      if (!existente.vault_path) {
        novos.push([entrada.id, { ...existente, vault_path: entrada.path }]);
      } else {
        skipped += 1;
      }
      continue;
    }
    novos.push([
      entrada.id,
      {
        id: entrada.id,
        entry_id: entrada.entry_id,
        kind: "original",
        content_type: entrada.content_type,
        // O tamanho do manifest e o do envelope; o conteudo e o que sobra.
        size_bytes: Math.max(0, (entrada.size ?? 0) - ENVELOPE_BYTES),
        created_at: entrada.updated_at,
        vault_path: entrada.path,
      },
    ]);
  }
  if (novos.length > 0) await storeSetMany(ATTACHMENTS_STORE, novos);
  return { restored: 0, skipped };
}

/**
 * Guarda so o caminho das capas do manifest. A capa e pouca e pequena, mas o
 * login nao espera por ela: o segundo plano baixa os bytes, e o livro aparece
 * com a capa quando ela chega.
 */
export async function deferCoversFromVault(
  root?: VaultFolderLike,
  manifest?: VaultManifest | null,
): Promise<number> {
  const alvo = root ?? (await driveVaultRoot());
  const lido = manifest !== undefined ? manifest : await readVaultManifest(alvo);
  if (!lido) return 0;
  const capas = lido.files.filter(
    (arquivo) => arquivo.kind === "cover" && typeof arquivo.id === "string",
  );
  let guardadas = 0;
  for (const entrada of capas) {
    const existente = await storeGet<StoredCover>(COVERS_STORE, entrada.id);
    if (existente?.blob) continue;
    await saveCoverBlob({
      book_id: entrada.id,
      content_type: existente?.content_type ?? "",
      updated_at: entrada.updated_at,
      vault_path: entrada.path,
    });
    guardadas += 1;
  }
  return guardadas;
}

/**
 * Traz as capas do layout (`books/<livro>/capa.bin.enc`) para o IndexedDB.
 *
 * Capa local mais nova que a do cofre nao e sobrescrita: a regra do restore e
 * a mesma das notas, o mais novo vence. Falha de uma capa conta como `skipped`
 * e nao impede as outras.
 */
export async function restoreCoversFromVault(
  root?: VaultFolderLike,
  manifest?: VaultManifest | null,
  options: VaultOptions = {},
): Promise<CoverRestoreResult> {
  const alvo = root ?? (await driveVaultRoot());
  const lido = manifest !== undefined ? manifest : await readVaultManifest(alvo);
  if (!lido) return { restored: 0, skipped: 0 };
  const capas = lido.files.filter(
    (arquivo) => arquivo.kind === "cover" && typeof arquivo.id === "string",
  );
  if (capas.length === 0) return { restored: 0, skipped: 0 };

  avisarStage(options, "anexos");
  const total = capas.length;
  avisarProgresso(options, 0, total);

  const codigo = await ensureVaultCode();
  const chave = await vaultKeyFromCode(codigo);
  let restored = 0;
  let skipped = 0;
  let done = 0;
  for (const entrada of capas) {
    const existente = await storeGet<StoredCover>(COVERS_STORE, entrada.id);
    const localNovo =
      existente?.blob !== undefined &&
      Date.parse(existente.updated_at) >= Date.parse(entrada.updated_at);
    if (localNovo) {
      skipped += 1;
    } else {
      try {
        const bytes = await readVaultFile(alvo, entrada.path, chave);
        const tipo = tipoDeImagem(bytes);
        await saveCoverBlob({
          book_id: entrada.id,
          content_type: tipo,
          updated_at: entrada.updated_at,
          vault_path: entrada.path,
          blob: new Blob([new Uint8Array(bytes)], { type: tipo }),
        });
        restored += 1;
      } catch {
        // Capa ausente/corrompida nao pode impedir as outras nem o livro abrir.
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
