/**
 * Sair da conta do Drive: sincronizar, conferir e so entao apagar o cache local.
 *
 * O cache da conta nunca e apagado por expiracao de token nem por falha de
 * rede. So o "sair" explicito apaga, e apenas depois de o retrato completo
 * estar no Drive e ter sido lido de volta. Sem sessao, um aparelho com dados
 * pendentes tambem nao apaga: primeiro reconecte e sincronize.
 */

import { listRecordings } from './db';
import { driveSessionState, disconnectDrive, loadDriveSession, type DriveSessionState } from './driveAuth';
import { ensureVaultBackedUp } from './driveVault';
import { pauseDriveAutoSync, resumeDriveAutoSync } from './driveAutoSync';
import { listNotebooks } from './notebooks';
import { wipeLocalAccountData } from './localWipe';

export type DriveLeaveErrorCode = 'unsynced' | 'sync_failed' | 'wipe_failed';

export class DriveLeaveError extends Error {
  readonly code: DriveLeaveErrorCode;

  constructor(code: DriveLeaveErrorCode, message: string) {
    super(message);
    this.name = 'DriveLeaveError';
    this.code = code;
  }
}

/** Dependencias injetaveis para testar a decisao sem tocar em Drive nem banco. */
export interface DriveLeaveDeps {
  loadSession(): Promise<void>;
  sessionState(): DriveSessionState;
  localPending(): Promise<boolean>;
  ensureBackedUp(): Promise<void>;
  disconnect(): Promise<void>;
  wipe(): Promise<void>;
  pause(): Promise<void>;
  resume(): void;
}

/** Ha nota ou caderno que ainda nao se sabe se chegou ao Drive? */
async function hasLocalData(): Promise<boolean> {
  const notes = await listRecordings(false);
  if (notes.length > 0) return true;
  const notebooks = await listNotebooks();
  return notebooks.some((notebook) => !notebook.isDefault);
}

const defaults: DriveLeaveDeps = {
  loadSession: loadDriveSession,
  sessionState: driveSessionState,
  localPending: hasLocalData,
  ensureBackedUp: async () => {
    await ensureVaultBackedUp();
  },
  disconnect: disconnectDrive,
  wipe: wipeLocalAccountData,
  pause: pauseDriveAutoSync,
  resume: resumeDriveAutoSync,
};

/**
 * Encerra a conta. Devolve quando o cache foi apagado; qualquer falha acontece
 * antes do apagamento e nao limpa a sessao, para o usuario poder tentar de novo.
 */
export async function leaveDriveAccount(overrides: Partial<DriveLeaveDeps> = {}): Promise<void> {
  const deps: DriveLeaveDeps = { ...defaults, ...overrides };
  await deps.pause();
  try {
    await deps.loadSession();
    const state = deps.sessionState();
    const pending = await deps.localPending();

    if (state !== 'connected') {
      if (pending) {
        throw new DriveLeaveError(
          'unsynced',
          'ha dados que ainda nao chegaram ao Drive; reconecte e sincronize antes de sair',
        );
      }
      // Apaga antes de limpar a sessao: se a limpeza falhar, o cache continua
      // escondido atras da conta e o usuario pode tentar de novo.
      try {
        await deps.wipe();
      } catch {
        throw new DriveLeaveError('wipe_failed', 'nao foi possivel apagar os dados da conta');
      }
      await deps.disconnect();
      return;
    }

    try {
      await deps.ensureBackedUp();
    } catch {
      throw new DriveLeaveError('sync_failed', 'nao foi possivel enviar tudo ao Drive');
    }

    // Wipe primeiro: se ele falhar, a sessao continua e o cache nao aparece
    // como se fosse o modo local.
    try {
      await deps.wipe();
    } catch {
      throw new DriveLeaveError('wipe_failed', 'nao foi possivel apagar os dados da conta');
    }
    await deps.disconnect();
  } finally {
    deps.resume();
  }
}
