/**
 * Backup em pasta do computador, pelo File System Access.
 *
 * Mesmo layout do Drive, e de proposito: `key.txt` + `backup.enc` (v1
 * compartilhado) + `state.enc` (v2 do web). Assim a pasta pode ser copiada para
 * o Drive, para um pendrive ou para outro computador sem converter nada.
 *
 * O acesso a pasta e do Chromium (e do Electron, que embrulha o mesmo build).
 * Onde nao existe, a tela diz em vez de oferecer um botao que nao funciona.
 */

import { isValidRecoveryCode, normalizeRecoveryCode } from "./vault";
import { storeGet, storeSet, VAULT_STORE } from "../lib/idb";

const FOLDER_KEY = "pasta";

export const KEY_FILE = "key.txt";
/** Retrato compartilhado v1: so notas, lido pelo app e pelo web. */
export const BACKUP_FILE = "backup.enc";
/** Estado extra do web (v2): cadernos, analises, configuracoes e transcricao. */
export const STATE_FILE = "state.enc";

/** O minimo que a copia de pasta precisa; o teste usa uma pasta em memoria. */
export interface FileHandleLike {
  getFile(): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{
    write(data: string | Uint8Array | ArrayBuffer): Promise<void>;
    close(): Promise<void>;
  }>;
}

export interface FolderLike {
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
}

export function supportsFolder(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Abre o seletor de pasta. Precisa de gesto do usuario. */
export async function pickFolder(): Promise<FolderLike> {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (options?: { mode?: string }) => Promise<FolderLike>;
    }
  ).showDirectoryPicker;
  if (!picker) throw new Error("este navegador nao abre pasta");
  const folder = await picker({ mode: "readwrite" });
  // O handle e clonavel no Chromium; onde nao for, a sessao segue sem lembrar
  // da pasta em vez de perder o backup que acabou de ser escrito.
  await storeSet(VAULT_STORE, FOLDER_KEY, folder).catch(() => undefined);
  return folder;
}

/** Pasta escolhida antes, se o navegador ainda der permissao. */
export async function rememberFolder(): Promise<FolderLike | null> {
  const guardada = await storeGet<FolderLike>(VAULT_STORE, FOLDER_KEY);
  if (!guardada) return null;
  const permissao = await (
    guardada as unknown as {
      queryPermission?: (options: { mode: string }) => Promise<string>;
    }
  ).queryPermission?.({ mode: "readwrite" });
  return permissao === "granted" ? guardada : null;
}

export async function writeVaultToFolder(
  folder: FolderLike,
  code: string,
  sealed: Uint8Array,
  state?: Uint8Array,
): Promise<void> {
  const chave = await folder.getFileHandle(KEY_FILE, { create: true });
  const escritaChave = await chave.createWritable();
  await escritaChave.write(normalizeRecoveryCode(code));
  await escritaChave.close();

  const backup = await folder.getFileHandle(BACKUP_FILE, { create: true });
  const escritaBackup = await backup.createWritable();
  await escritaBackup.write(sealed);
  await escritaBackup.close();

  // O estado extra e opcional: pasta antiga nao tem e continua abrindo.
  if (state) {
    const estado = await folder.getFileHandle(STATE_FILE, { create: true });
    const escritaEstado = await estado.createWritable();
    await escritaEstado.write(state);
    await escritaEstado.close();
  }
}

export interface FolderVaultRead {
  code: string;
  sealed: Uint8Array;
  /** Retrato v2 do web; ausente em pasta antiga, que so tem o v1. */
  state?: Uint8Array;
}

/** Le a pasta e devolve o codigo e os envelopes, ja validados. */
export async function readVaultFromFolder(folder: FolderLike): Promise<FolderVaultRead> {
  const chave = await folder.getFileHandle(KEY_FILE);
  const code = normalizeRecoveryCode((await (await chave.getFile()).text()).trim());
  if (!(await isValidRecoveryCode(code))) {
    throw new Error(`${KEY_FILE} nao tem um codigo valido`);
  }
  const backup = await folder.getFileHandle(BACKUP_FILE);
  const sealed = new Uint8Array(await (await backup.getFile()).arrayBuffer());
  if (sealed.length === 0) throw new Error(`${BACKUP_FILE} esta vazio`);
  const state = await lerEstado(folder);
  return state ? { code, sealed, state } : { code, sealed };
}

/** `state.enc` quando existe; arquivo ausente nao e erro. */
async function lerEstado(folder: FolderLike): Promise<Uint8Array | undefined> {
  try {
    const handle = await folder.getFileHandle(STATE_FILE);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  } catch {
    return undefined;
  }
}
