/**
 * Reafirmar uma nota restaurada nao e editar: so a nota que o servidor perdeu
 * de vez volta para a fila. Marcar todas sujas fazia a primeira sincronizacao
 * reenviar a biblioteca inteira.
 */

import { ApiError } from '@/core/api';
import type { Recording } from '@/core/types';

import { reassertNotesOnServer } from '../reassert';

const mockRestoreEntry = jest.fn();
const mockCreateTextEntry = jest.fn();
const mockUpsertRecording = jest.fn();
const mockLoadServerConfig = jest.fn();

jest.mock('@/core/api', () => {
  const actual = jest.requireActual('@/core/api');
  return {
    ...actual,
    DyariumApi: class {
      restoreEntry(...args: unknown[]): Promise<unknown> {
        return mockRestoreEntry(...args);
      }
      createTextEntry(...args: unknown[]): Promise<unknown> {
        return mockCreateTextEntry(...args);
      }
    },
  };
});

jest.mock('../db', () => ({
  upsertRecording: (...args: unknown[]) => mockUpsertRecording(...args),
}));

jest.mock('../secure', () => ({
  loadServerConfig: () => mockLoadServerConfig(),
}));

const recording: Recording = {
  id: 'r1',
  title: 'Nota',
  recordedAt: '2026-10-01T10:00:00.000Z',
  dir: '',
  segmentCount: 0,
  status: 'completed',
  offset: 0,
  attempts: 0,
  entryId: 'e1',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

describe('reassertNotesOnServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadServerConfig.mockResolvedValue({ baseUrl: 'https://dyarium.test', token: 't' });
    mockUpsertRecording.mockResolvedValue(undefined);
  });

  it('nota que o servidor apenas tinha na lixeira volta sem virar edicao', async () => {
    mockRestoreEntry.mockResolvedValue({ id: 'e1' });

    await expect(reassertNotesOnServer([recording])).resolves.toMatchObject({ restored: 1 });
    expect(mockUpsertRecording).not.toHaveBeenCalled();
  });

  it('nota que o servidor perdeu de vez e recriada e entra na fila', async () => {
    mockRestoreEntry.mockRejectedValue(new ApiError(404, 'not_found', 'sumiu'));
    mockCreateTextEntry.mockResolvedValue({ id: 'e1' });

    await expect(reassertNotesOnServer([recording])).resolves.toMatchObject({ recreated: 1 });
    expect(mockUpsertRecording).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1', noteDirty: true }),
    );
  });

  it('sem servidor configurado nao toca em nada', async () => {
    mockLoadServerConfig.mockResolvedValue(null);

    await expect(reassertNotesOnServer([recording])).resolves.toMatchObject({
      restored: 0,
      recreated: 0,
    });
    expect(mockRestoreEntry).not.toHaveBeenCalled();
  });
});
