/**
 * Saida da conta: grava o pendente, confirma o retrato e so entao apaga o
 * cache local. Mora fora do `driveSession` para a limpeza do banco nao criar
 * ciclo `driveSession -> vaultCloud -> driveSession`.
 *
 * Sem sessao e com pendencia o cache e o unico lugar das mudancas: a saida
 * falha e a folha oferece tentar de novo ou descartar explicitamente.
 */

import { clearDriveMark } from "./driveMark";
import {
  disconnectDrive,
  driveSessionState,
  driveVaultRoot,
  type SignOutOptions,
  type SignOutResult,
} from "./driveSession";
import { wipeLocalVault } from "../storage/db";

/** Grava o cofre inteiro e so aceita se os tres snapshots ficaram no Drive. */
async function gravarPendente(): Promise<boolean> {
  const { syncVaultToDrive, vaultSnapshotsWritten } = await import("./vaultCloud");
  const raiz = await driveVaultRoot();
  await syncVaultToDrive(raiz);
  return vaultSnapshotsWritten(raiz);
}

async function haPendencia(): Promise<boolean> {
  const { isVaultDirty } = await import("./folderSync");
  return isVaultDirty();
}

function manterModoLocal(): void {
  try {
    // O proximo carregamento abre o cofre local vazio, e nao a primeira tela.
    localStorage.setItem("dyarium.onboarded", "1");
  } catch {
    // Sem localStorage a primeira tela volta; nada do cofre local e perdido.
  }
}

export async function leaveAccount(options: SignOutOptions = {}): Promise<SignOutResult> {
  const discard = options.discard === true;
  const conectado = driveSessionState() === "connected";

  if (!discard) {
    if (conectado) {
      try {
        const gravado = await (options.save ?? gravarPendente)();
        if (!gravado) {
          return {
            ok: false,
            reason: "save-failed",
            message: "não foi possível confirmar o cofre no Drive",
          };
        }
      } catch {
        return {
          ok: false,
          reason: "save-failed",
          message: "não foi possível gravar o cofre no Drive",
        };
      }
    } else if (await (options.hasPending ?? haPendencia)()) {
      return {
        ok: false,
        reason: "pending",
        message: "há mudanças que ainda não subiram",
      };
    }
  }

  try {
    await (options.wipe ?? wipeLocalVault)();
  } catch {
    return {
      ok: false,
      reason: "wipe-failed",
      message: "não foi possível limpar este navegador",
    };
  }

  // Nada de `/revoke`: revogar o token derrubaria a concessao Google dos outros
  // clientes (o app). Sair aqui e so limpar a sessao e o cache deste navegador.
  disconnectDrive();
  clearDriveMark();
  manterModoLocal();
  return { ok: true };
}
