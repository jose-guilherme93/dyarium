import { act, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import type { Recording } from '@/core/types';

import { LibraryProvider, useLibrary } from '../LibraryContext';

/**
 * `refresh` devolve a lista ja mesclada, nao a que veio do banco.
 *
 * Quem aquece cache com ela (o Painel de metricas) precisa dos mesmos objetos
 * que a tela desenha; se a lista devolvida fosse a do banco, cada refresh
 * criaria objetos novos e o cache por identidade nunca acertaria.
 */

const mockListRecordings = jest.fn();
const mockUpsertRecording = jest.fn<Promise<void>, [Recording]>(async () => undefined);
const mockGetRecording = jest.fn<Promise<Recording | null>, [string]>();
const mockListTrashed = jest.fn<Promise<Recording[]>, []>(async () => []);

jest.mock('@/services/db', () => ({
  listRecordings: (...args: unknown[]) => mockListRecordings(...args),
  listTrashedRecordings: () => mockListTrashed(),
  upsertRecording: (recording: Recording) => mockUpsertRecording(recording),
  getRecording: (id: string) => mockGetRecording(id),
  deleteRecordingRow: jest.fn(async () => undefined),
}));

jest.mock('@/services/notebooks', () => ({
  listNotebooks: jest.fn(async () => []),
  deleteLocalNotebook: jest.fn(async () => undefined),
  insertLocalNotebook: jest.fn(async () => undefined),
  updateLocalNotebook: jest.fn(async () => undefined),
}));

jest.mock('@/services/uploaderLoop', () => ({
  observeUploads: () => () => undefined,
  emitRecording: jest.fn(),
  runUploadQueueOnce: jest.fn(async () => undefined),
}));

jest.mock('@/services/notebookSync', () => ({ pushNotebooks: jest.fn(async () => undefined) }));
jest.mock('@/services/entries', () => ({
  deleteServerEntry: jest.fn(async () => undefined),
  restoreServerEntry: jest.fn(async () => undefined),
}));
jest.mock('@/services/trash', () => ({ purgeExpiredTrash: jest.fn(async () => 0) }));
jest.mock('@/services/files', () => ({
  deleteSessionAudioFiles: jest.fn(async () => 0),
  deleteSessionFiles: jest.fn(async () => undefined),
}));
jest.mock('@/services/noteVisibility', () => ({ noteIsOpen: () => false }));
jest.mock('@/services/pull', () => ({ pullServerEntries: jest.fn(async () => 0) }));
jest.mock('@/services/transcripts', () => ({ fetchTranscriptsOnce: jest.fn(async () => 0) }));
jest.mock('@/dev/perf', () => ({ bumpRender: jest.fn() }));
jest.mock('../SettingsContext', () => ({ useSettings: () => ({ config: null }) }));

const base: Recording = {
  id: 'nota-1',
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

function note(patch: Partial<Recording>): Recording {
  return { ...base, ...patch };
}

let latest: {
  recordings: Recording[];
  refresh: () => Promise<Recording[]>;
  remove: (id: string) => Promise<void>;
  restoreFromTrash: (id: string) => Promise<void>;
} | null = null;

function Probe() {
  const { recordings, refresh, remove, restoreFromTrash } = useLibrary();
  useEffect(() => {
    latest = { recordings, refresh, remove, restoreFromTrash };
  }, [recordings, refresh, remove, restoreFromTrash]);
  return <Text>{recordings.map((item) => item.text).join('|')}</Text>;
}

async function mount(initial: Recording[]) {
  mockListRecordings.mockResolvedValue(initial);
  render(
    <LibraryProvider>
      <Probe />
    </LibraryProvider>,
  );
  await act(async () => {});
}

describe('LibraryProvider.refresh', () => {
  beforeEach(() => {
    latest = null;
    mockListRecordings.mockReset();
  });

  it('reaproveita o objeto que a tela ja desenha quando a nota nao mudou', async () => {
    const first = note({ id: 'a', text: 'um' });
    await mount([first]);
    expect(screen.getByText('um')).toBeTruthy();

    // O banco devolve objetos novos a cada leitura; a nota nao mudou.
    const reread = note({ id: 'a', text: 'um' });
    mockListRecordings.mockResolvedValueOnce([reread]);

    let returned: Recording[] = [];
    await act(async () => {
      returned = await latest!.refresh();
    });

    expect(returned).toHaveLength(1);
    expect(returned[0]).toBe(first);
    expect(latest!.recordings[0]).toBe(returned[0]);
    expect(screen.getByText('um')).toBeTruthy();
  });

  it('apaga para a lixeira sem liberar o audio na hora', async () => {
    const first = note({ id: 'a', text: 'um' });
    await mount([first]);
    mockGetRecording.mockResolvedValue(first);

    await act(async () => {
      await latest!.remove('a');
    });

    const trashed = mockUpsertRecording.mock.calls.at(-1)?.[0] as Recording;
    expect(trashed.deletedAt).toBeTruthy();
    expect(latest!.recordings).toEqual([]);
  });

  it('restaura a nota apagada e esquece a data da lixeira', async () => {
    const trashed = note({ id: 'a', text: 'um', deletedAt: '2026-10-27T10:00:00.000Z' });
    await mount([]);
    mockGetRecording.mockResolvedValue(trashed);
    mockListRecordings.mockResolvedValueOnce([note({ id: 'a', text: 'um' })]);

    await act(async () => {
      await latest!.restoreFromTrash('a');
    });

    const restored = mockUpsertRecording.mock.calls.at(-1)?.[0] as Recording;
    expect(restored.deletedAt).toBeUndefined();
    expect(latest!.recordings.map((item) => item.id)).toEqual(['a']);
  });

  it('devolve o objeto novo quando a nota mudou', async () => {
    const first = note({ id: 'a', text: 'um' });
    await mount([first]);

    const changed = note({ id: 'a', text: 'dois', updatedAt: '2026-10-02T10:00:00.000Z' });
    mockListRecordings.mockResolvedValueOnce([changed]);

    let returned: Recording[] = [];
    await act(async () => {
      returned = await latest!.refresh();
    });

    expect(returned).toEqual([changed]);
    expect(returned[0]).toBe(changed);
    expect(latest!.recordings[0]).toBe(changed);
    expect(screen.getByText('dois')).toBeTruthy();
  });
});
