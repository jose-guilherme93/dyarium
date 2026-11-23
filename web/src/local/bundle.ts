/**
 * Backup num arquivo unico, para navegador sem acesso a pasta (Firefox, Safari).
 *
 * O `.zip` carrega exatamente o que a pasta carrega — `key.txt`, `backup.enc`
 * (v1 compartilhado) e, quando existe, `state.enc` (v2 do web) —, entao serve
 * para guardar, copiar para o Drive ou restaurar em qualquer navegador. Nada
 * aqui e especifico de plataforma.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { BACKUP_FILE, KEY_FILE, STATE_FILE } from "./folder";
import { isValidRecoveryCode, normalizeRecoveryCode } from "./vault";

export { BACKUP_FILE, KEY_FILE, STATE_FILE };

export function packVault(code: string, sealed: Uint8Array, state?: Uint8Array): Uint8Array {
  return zipSync(
    {
      [KEY_FILE]: strToU8(normalizeRecoveryCode(code)),
      [BACKUP_FILE]: sealed,
      // Estado extra e opcional: zip antigo continua abrindo sem ele.
      ...(state ? { [STATE_FILE]: state } : {}),
    },
    { level: 6 },
  );
}

export interface BundleVault {
  code: string;
  sealed: Uint8Array;
  /** Retrato v2 do web; ausente em zip antigo, que so tem o v1. */
  state?: Uint8Array;
}

export async function unpackVault(bytes: Uint8Array): Promise<BundleVault> {
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
  const state = arquivos[STATE_FILE];
  return state ? { code, sealed: backup, state } : { code, sealed: backup };
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
