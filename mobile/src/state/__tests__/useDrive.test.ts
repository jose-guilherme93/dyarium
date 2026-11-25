/**
 * Login do Drive: a tela abre com os metadados e o envio fica para depois.
 *
 * O `openDriveVault` e o dono das etapas; aqui so importa o que o estado pede:
 * o login nao espera anexo nem o retrato subir, o envio automatico e agendado e
 * o botao "sincronizar" continua usando o caminho completo.
 */

import { act, renderHook } from '@testing-library/react-native';

import type { VaultOpenResult } from '@/services/driveVault';
import { useDrive } from '@/state/useDrive';

const mockOpenVault = jest.fn<Promise<VaultOpenResult>, [Record<string, unknown>]>();
const mockReadSummary = jest.fn(async () => null);
const mockScheduleSync = jest.fn();
const mockConnectDrive = jest.fn(async () => undefined);
const mockLoadSession = jest.fn(async () => undefined);
const mockRefresh = jest.fn(async () => undefined);
const mockRefreshNotebooks = jest.fn(async () => undefined);

jest.mock('@/services/driveVault', () => {
  class VaultSyncError extends Error {
    kind: string;
    constructor(kind: string, message: string) {
      super(message);
      this.name = 'VaultSyncError';
      this.kind = kind;
    }
  }
  return {
    VaultSyncError,
    openDriveVault: (...args: [Record<string, unknown>]) => mockOpenVault(...args),
    readVaultSummary: () => mockReadSummary(),
  };
});

jest.mock('@/services/driveConfig', () => ({
  driveConfigured: () => true,
}));

jest.mock('@/services/driveAuth', () => ({
  connectDrive: () => mockConnectDrive(),
  driveProfile: () => ({ name: 'Ana', email: 'ana@example.com', picture: '' }),
  driveSessionState: () => 'connected',
  loadDriveSession: () => mockLoadSession(),
  onDriveSessionChange: () => () => undefined,
}));

jest.mock('@/services/driveAutoSync', () => ({
  onDriveAutoSync: () => () => undefined,
  scheduleDriveSync: (...args: unknown[]) => mockScheduleSync(...args),
}));

jest.mock('@/services/driveLeave', () => ({
  DriveLeaveError: class DriveLeaveError extends Error {
    code = 'sync_failed';
  },
  leaveDriveAccount: jest.fn(async () => undefined),
}));

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({
    refresh: mockRefresh,
    refreshNotebooks: mockRefreshNotebooks,
  }),
}));

function opened(patch: Partial<VaultOpenResult> = {}): VaultOpenResult {
  return {
    summary: { notes: 400, attachments: 400, bytes: 2048, at: '2026-11-25T00:00:00.000Z' },
    restored: { notes: 400, skipped: 0, notebooks: 3, attachments: 0, failedAttachments: 0 },
    pushed: null,
    created: false,
    ...patch,
  };
}

async function mount() {
  const rendered = renderHook(() => useDrive());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return rendered;
}

describe('estado do Drive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenVault.mockReset().mockResolvedValue(opened());
    mockReadSummary.mockResolvedValue(null);
  });

  it('login abre com os metadados, sem esperar anexo nem envio', async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.connect();
    });

    expect(mockConnectDrive).toHaveBeenCalledTimes(1);
    // `push: false` e o caminho rapido; anexo nunca entra no login.
    expect(mockOpenVault).toHaveBeenCalledWith(expect.objectContaining({ push: false }));
    expect(result.current.busy).toBe(false);
    expect(result.current.summary).toMatchObject({ notes: 400 });
    expect(result.current.restored).toMatchObject({ notes: 400 });
    // A home e os cadernos releem o banco com as notas que acabaram de chegar.
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockRefreshNotebooks).toHaveBeenCalled();
    // O retrato e o resumo novo correm no envio automatico, nao na tela.
    expect(mockScheduleSync).toHaveBeenCalledWith(false, 0);
  });

  it('sincronizar explicito continua o caminho completo', async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.sync();
    });

    expect(mockConnectDrive).not.toHaveBeenCalled();
    const options = mockOpenVault.mock.calls[mockOpenVault.mock.calls.length - 1][0];
    expect(options.push).toBeUndefined();
    expect(mockScheduleSync).not.toHaveBeenCalled();
  });

  it('sessao vencida vira mensagem curta e libera a tela', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { VaultSyncError } = require('@/services/driveVault') as {
      VaultSyncError: new (kind: string, message: string) => Error;
    };
    mockOpenVault.mockRejectedValueOnce(new VaultSyncError('auth', 'sessao vencida'));
    const { result } = await mount();

    await act(async () => {
      await result.current.sync();
    });

    expect(result.current.error).toBe('Sessão do Google vencida. Entrar de novo.');
    expect(result.current.busy).toBe(false);
    expect(mockScheduleSync).not.toHaveBeenCalled();
  });
});
