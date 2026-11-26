/**
 * Saida da conta: tenta gravar o pendente enquanto a sessao existe, depois
 * desconecta e limpa o cache em best-effort. Nunca falha.
 */

import { clearDriveMark } from "./driveMark";
import {
  disconnectDrive,
  driveSessionState,
  driveVaultRoot,
  type SignOutOptions,
} from "./driveSession";
import { wipeLocalVault } from "../storage/db";

async function gravarPendente(): Promise<void> {
  try {
    const { syncVaultToDrive, vaultSnapshotsWritten, waitVaultBackground } = await import(
      "./vaultCloud"
    );
    const raiz = await driveVaultRoot();
    await Promise.race([
      (async () => {
        await syncVaultToDrive(raiz);
        await waitVaultBackground();
        void vaultSnapshotsWritten(raiz);
      })(),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch {
    // Best-effort.
  }
}

function manterModoLocal(): void {
  try {
    localStorage.setItem("dyarium.onboarded", "1");
  } catch {
    // Sem localStorage a primeira tela volta; nada do cofre local e perdido.
  }
}

export async function leaveAccount(options: SignOutOptions = {}): Promise<void> {
  if (!options.discard) {
    const conectado = options.save ? true : driveSessionState() === "connected";
    if (conectado) {
      try {
        await (options.save ?? gravarPendente)();
      } catch {
        // Best-effort.
      }
    }
  }

  disconnectDrive();
  clearDriveMark();
  manterModoLocal();

  try {
    await (options.wipe ?? wipeLocalVault)();
  } catch {
    // Best-effort.
  }
}