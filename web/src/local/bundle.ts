/**
 * Backup num arquivo unico, para navegador sem acesso a pasta (Firefox, Safari).
 *
 * O `.zip` carrega exatamente o que a pasta carrega — `key.txt` e
 * `backup.enc` —, entao serve para guardar, copiar para o Drive ou restaurar em
 * qualquer navegador. Nada aqui e especifico de plataforma.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { isValidRecoveryCode, normalizeRecoveryCode } from "./vault";

export const KEY_FILE = "key.txt";
export const BACKUP_FILE = "backup.enc";

export function packVault(code: string, sealed: Uint8Array): Uint8Array {
  return zipSync(
    {
      [KEY_FILE]: strToU8(normalizeRecoveryCode(code)),
      [BACKUP_FILE]: sealed,
    },
    { level: 6 },
  );
}

export async function unpackVault(bytes: Uint8Array): Promise<{ code: string; sealed: Uint8Array }> {
  let arquivos: Record<string, Uint8Array>;
  try {
    arquivos = unzipSync(bytes);
  } catch {
    throw new Error("arquivo de backup invalido");
  }
  const chave = arquivos[KEY_FILE];
  const backup = arquivos[BACKUP_FILE];
  if (!chave || !backup || backup.length === 0) {
    throw new Error("backup incompleto: faltam key.txt ou backup.enc");
  }
  const code = normalizeRecoveryCode(strFromU8(chave).trim());
  if (!(await isValidRecoveryCode(code))) throw new Error("codigo do backup e invalido");
  return { code, sealed: backup };
}

/** Baixa o arquivo pelo proprio navegador; funciona onde a pasta nao existe. */
export function downloadBytes(name: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // O download comeca de forma assincrona; revogar no mesmo tick pode cortar.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
