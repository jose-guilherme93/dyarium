/**
 * Marca local de que este navegador tem cofre no Drive. Nao e segredo: diz so
 * que o cofre mora no Drive, para a linha de reconectar saber que ha o que
 * reconectar quando a sessao do Google (que vive so na memoria) se perde.
 */

import type { VaultSummary } from "./vaultCloud";

export const DRIVE_MARK_KEY = "dyarium.drive";
export const DRIVE_SUMMARY_KEY = "dyarium.drive.summary";

export function driveMarked(): boolean {
  try {
    return localStorage.getItem(DRIVE_MARK_KEY) === "1";
  } catch {
    return false;
  }
}

/** O ultimo tamanho conhecido do cofre; serve ao numero da linha sem sessao. */
export function rememberDriveVault(summary?: VaultSummary): void {
  try {
    localStorage.setItem(DRIVE_MARK_KEY, "1");
    if (summary) localStorage.setItem(DRIVE_SUMMARY_KEY, JSON.stringify(summary));
  } catch {
    // Sem localStorage a linha nao aparece na proxima abertura; o cofre em si
    // continua no Drive e a sessao viva nao depende disto.
  }
}

export function clearDriveMark(): void {
  try {
    localStorage.removeItem(DRIVE_MARK_KEY);
    localStorage.removeItem(DRIVE_SUMMARY_KEY);
  } catch {
    // Sem localStorage nada a limpar.
  }
}

export function cachedSummary(): VaultSummary | null {
  try {
    const bruto = localStorage.getItem(DRIVE_SUMMARY_KEY);
    if (!bruto) return null;
    const guardado = JSON.parse(bruto) as VaultSummary;
    if (
      typeof guardado?.notes !== "number" ||
      typeof guardado?.bytes !== "number" ||
      !Number.isFinite(guardado.notes) ||
      !Number.isFinite(guardado.bytes)
    ) {
      return null;
    }
    return guardado;
  } catch {
    return null;
  }
}