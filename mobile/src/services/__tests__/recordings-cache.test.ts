/**
 * A biblioteca e lida muitas vezes quase ao mesmo tempo (fila, transcricoes,
 * pull, reconciliacao). O cache curto evita a rajada de `SELECT *` e de
 * `rowToRecording` durante a abertura do app; toda escrita precisa derrubar o
 * cache para o proximo ciclo ver o que acabou de ser gravado.
 */

import type { Recording } from '@/core/types';
import { listRecordings, upsertRecording } from '../db';

const mockGetAllAsync = jest.fn(async () => [] as unknown[]);
const mockRunAsync = jest.fn(async () => ({ changes: 1, lastInsertRowId: 1 }));
const mockGetFirstAsync = jest.fn(async (sql?: string) =>
  typeof sql === 'string' && sql.includes('PRAGMA user_version') ? { user_version: 999 } : null,
);
const mockExecAsync = jest.fn(async () => undefined);

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: mockExecAsync,
    runAsync: mockRunAsync,
    getFirstAsync: mockGetFirstAsync,
    getAllAsync: mockGetAllAsync,
    closeAsync: jest.fn(async () => undefined),
    withTransactionAsync: async (task: () => Promise<void>) => task(),
    withExclusiveTransactionAsync: async (task: () => Promise<void>) => task(),
  })),
}));

jest.mock('expo-file-system', () => {
  class FakeFile {
    exists = false;
    size = 0;
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    open() {
      return { readBytes: () => new Uint8Array(), close: () => undefined };
    }
  }
  return {
    File: FakeFile,
    Directory: class {},
    Paths: { document: 'file:///docs', cache: 'file:///cache' },
    FileMode: { ReadOnly: 'r' },
  };
});

const note: Recording = {
  id: 'nota-cache',
  title: 'Nota',
  text: 'um',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  recordedAt: '2026-10-01T10:00:00.000Z',
  dir: 'file:///nota',
  segmentCount: 0,
  offset: 0,
  attempts: 0,
  status: 'completed',
  source: 'text',
  tags: [],
  notebookId: 'notas-ao-acaso',
};

describe('cache de listRecordings', () => {
  beforeEach(async () => {
    mockGetAllAsync.mockClear();
    mockRunAsync.mockClear();
    // Esquenta-cache: toda escrita derruba o cache, entao cada teste comeca
    // com a leitura fria sem depender da ordem.
    await upsertRecording(note);
    mockGetAllAsync.mockClear();
    mockRunAsync.mockClear();
  });

  it('serve a mesma leitura por um instante', async () => {
    await listRecordings();
    await listRecordings();
    expect(mockGetAllAsync).toHaveBeenCalledTimes(1);
  });

  it('derruba o cache em toda escrita', async () => {
    await listRecordings();
    await upsertRecording(note);
    await listRecordings();
    expect(mockGetAllAsync).toHaveBeenCalledTimes(2);
  });

  it('nao mistura a lista da lixeira com a lista normal', async () => {
    await listRecordings();
    await listRecordings(true);
    expect(mockGetAllAsync).toHaveBeenCalledTimes(2);
  });

  it('leitura em voo nao guarda a lista velha depois de uma escrita', async () => {
    // A restauracao do cofre insere notas enquanto a lista do carregamento
    // ainda esta no ar. Se a leitura antiga gravasse o cache ao terminar, a
    // lista seguinte lia zero pelo resto do segundo (e, na web, sem nova
    // recarga, para sempre).
    let liberar: (rows: unknown[]) => void = () => undefined;
    mockGetAllAsync.mockImplementationOnce(
      () =>
        new Promise<unknown[]>((resolve) => {
          liberar = resolve;
        }),
    );

    const emVoo = listRecordings();
    for (let i = 0; i < 20 && mockGetAllAsync.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(mockGetAllAsync).toHaveBeenCalledTimes(1);

    await upsertRecording(note);
    liberar([]);
    await emVoo;

    // Com a geracao, o resultado velho nao vira cache: a proxima leitura
    // consulta o banco de novo (2 chamadas). Sem ela, seria 1.
    await listRecordings();
    expect(mockGetAllAsync).toHaveBeenCalledTimes(2);
  });
});
