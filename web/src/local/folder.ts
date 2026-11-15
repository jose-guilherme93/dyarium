/**
 * Backup em pasta do computador, pelo File System Access.
 *
 * Mesmo layout do Drive, e de proposito: `key.txt` + `backup.enc`. Assim a
 * pasta pode ser copiada para o Drive, para um pendrive ou para outro
 * computador sem converter nada.
 *
 * O acesso a pasta e do Chromium (e do Electron, que embrulha o mesmo build).
 * Onde nao existe, a tela diz em vez de oferecer um botao que nao funciona.
 */

import { isValidRecoveryCode, normalizeRecoveryCode } from "./vault";
import { storeGet, storeSet, VAULT_STORE } from "../lib/idb";

const FOLDER_KEY = "pasta";

export const KEY_FILE = "key.txt";
export const BACKUP_FILE = "backup.enc";

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
): Promise<void> {
  const chave = await folder.getFileHandle(KEY_FILE, { create: true });
  const escritaChave = await chave.createWritable();
  await escritaChave.write(normalizeRecoveryCode(code));
  await escritaChave.close();

  const backup = await folder.getFileHandle(BACKUP_FILE, { create: true });
  const escritaBackup = await backup.createWritable();
  await escritaBackup.write(sealed);
  await escritaBackup.close();
}

/** Le a pasta e devolve o codigo e o envelope cifrado, ja validados. */
export async function readVaultFromFolder(
  folder: FolderLike,
): Promise<{ code: string; sealed: Uint8Array }> {
  const chave = await folder.getFileHandle(KEY_FILE);
  const code = normalizeRecoveryCode((await (await chave.getFile()).text()).trim());
  if (!(await isValidRecoveryCode(code))) {
    throw new Error(`${KEY_FILE} nao tem um codigo valido`);
  }
  const backup = await folder.getFileHandle(BACKUP_FILE);
  const sealed = new Uint8Array(await (await backup.getFile()).arrayBuffer());
  if (sealed.length === 0) throw new Error(`${BACKUP_FILE} esta vazio`);
  return { code, sealed };
}
