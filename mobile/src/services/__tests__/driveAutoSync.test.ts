/**
 * Envio automatico: debounce depois de uma mudanca local, leitura ao voltar ao
 * primeiro plano e pausa durante o "sair". Nenhuma dessas rotas apaga nada.
 */

import { AppState } from 'react-native';

import {
  pauseDriveAutoSync,
  resumeDriveAutoSync,
  scheduleDriveSync,
  startDriveAutoSync,
} from '../driveAutoSync';

const mockAppListeners: ((state: string) => void)[] = [];
const mockOpenVault = jest.fn();
const mockSessionState = jest.fn<ReturnType<typeof import('../driveAuth').driveSessionState>, []>(
  () => 'connected',
);

jest.mock('../driveAuth', () => ({
  loadDriveSession: jest.fn(async () => undefined),
  driveSessionState: () => mockSessionState(),
}));

jest.mock('../driveVault', () => ({
  openDriveVault: (options: unknown) => mockOpenVault(options),
}));


const result = {
  summary: { notes: 0, attachments: 0, bytes: 0, at: '2026-11-25T00:00:00.000Z' },
  restored: { notes: 0, skipped: 0, notebooks: 0, attachments: 0, failedAttachments: 0 },
  pushed: null,
  created: false,
};

describe('envio automatico do Drive', () => {
  let removeListener: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mockOpenVault.mockReset().mockResolvedValue(result);
    mockSessionState.mockReturnValue('connected');
    mockAppListeners.length = 0;
    removeListener = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        mockAppListeners.push(listener as unknown as (state: string) => void);
        return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
      });
  });

  afterEach(() => {
    removeListener.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('junta uma rajada de mudancas num unico envio, sem reaplicar o retrato', async () => {
    scheduleDriveSync(false);
    scheduleDriveSync(false);
    await jest.advanceTimersByTimeAsync(2400);
    expect(mockOpenVault).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(200);
    expect(mockOpenVault).toHaveBeenCalledTimes(1);
    expect(mockOpenVault).toHaveBeenCalledWith({ apply: false });
  });

  it('ao voltar ao primeiro plano le o retrato remoto e aplica', async () => {
    const stop = startDriveAutoSync();
    await jest.advanceTimersByTimeAsync(0);
    mockOpenVault.mockClear();

    mockAppListeners.forEach((listener) => listener('active'));
    await jest.advanceTimersByTimeAsync(0);

    expect(mockOpenVault).toHaveBeenCalledTimes(1);
    expect(mockOpenVault).toHaveBeenCalledWith({ apply: true });
    stop();
  });

  it('sem sessao conectada nao toca no Drive nem apaga nada', async () => {
    mockSessionState.mockReturnValue('expired');
    scheduleDriveSync(false);
    await jest.advanceTimersByTimeAsync(3000);

    expect(mockOpenVault).not.toHaveBeenCalled();
  });

  it('pausa durante o sair e volta a aceitar envio depois', async () => {
    await pauseDriveAutoSync();
    scheduleDriveSync(false);
    await jest.advanceTimersByTimeAsync(5000);
    expect(mockOpenVault).not.toHaveBeenCalled();

    resumeDriveAutoSync();
    scheduleDriveSync(false);
    await jest.advanceTimersByTimeAsync(3000);
    expect(mockOpenVault).toHaveBeenCalledTimes(1);
  });
});
