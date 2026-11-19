import type { ServerEntry } from '@/core/api';
import type { Recording } from '@/core/types';

import { pullServerEntries } from '../pull';

const ENTRY: ServerEntry = {
  id: 'e1',
  title: 'Capítulo um',
  status: 'ready',
  source: 'text',
  original_filename: '',
  content_type: '',
  size_bytes: 0,
  duration_seconds: 0,
  recorded_at: null,
  created_at: '2026-10-11T14:00:00Z',
  updated_at: '2026-10-11T14:05:00Z',
};

function localRecording(over: Partial<Recording> = {}): Recording {
  return {
    id: 'rec_1',
    title: ENTRY.title,
    recordedAt: ENTRY.created_at,
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    entryId: 'e1',
    notebookId: 'notas-ao-acaso',
    createdAt: ENTRY.created_at,
    updatedAt: ENTRY.updated_at,
    chapterKind: '',
    chapterPosition: 0,
    chapterStatus: '',
    chapterGoalWords: 0,
    chapterSynopsis: '',
    chapterBeats: '',
    chapterNotes: '',
    ...over,
  };
}

const mockLoadConfig = jest.fn();
const mockPullNotebooks = jest.fn();
const mockRefreshAuthorSettings = jest.fn();
const mockSyncEntities = jest.fn();
const mockSyncServerTranscripts = jest.fn();
const mockSyncServerAnalyses = jest.fn();
const mockListRecordings = jest.fn();
const mockUpsertRecording = jest.fn();
const mockUpdateChapterFields = jest.fn();
const mockDeleteRecordingRow = jest.fn();
const mockDeleteSessionFiles = jest.fn();
const mockObserveVersion = jest.fn();
const mockListEntriesPage = jest.fn();
const mockListDeletedEntriesPage = jest.fn();
const mockListNotes = jest.fn();

jest.mock('@/core/api', () => ({
  DyariumApi: jest.fn().mockImplementation(() => ({
    listEntriesPage: (...args: unknown[]) => mockListEntriesPage(...args),
    listDeletedEntriesPage: (...args: unknown[]) => mockListDeletedEntriesPage(...args),
    listNotes: (...args: unknown[]) => mockListNotes(...args),
  })),
}));

jest.mock('../secure', () => ({
  loadServerConfig: () => mockLoadConfig(),
}));

jest.mock('../notebookSync', () => ({
  pullNotebooks: () => mockPullNotebooks(),
}));

jest.mock('../authorSettings', () => ({
  refreshAuthorSettings: () => mockRefreshAuthorSettings(),
}));

jest.mock('../entitySync', () => ({
  syncEntities: () => mockSyncEntities(),
}));

jest.mock('../transcripts', () => ({
  syncServerTranscripts: (...args: unknown[]) => mockSyncServerTranscripts(...args),
}));

jest.mock('../analysis', () => ({
  syncServerAnalyses: (...args: unknown[]) => mockSyncServerAnalyses(...args),
}));

jest.mock('../files', () => ({
  deleteSessionFiles: (...args: unknown[]) => mockDeleteSessionFiles(...args),
}));

jest.mock('../clock', () => ({
  observeVersion: (...args: unknown[]) => mockObserveVersion(...args),
}));

jest.mock('../db', () => ({
  listRecordings: (...args: unknown[]) => mockListRecordings(...args),
  upsertRecording: (...args: unknown[]) => mockUpsertRecording(...args),
  updateChapterFields: (...args: unknown[]) => mockUpdateChapterFields(...args),
  deleteRecordingRow: (...args: unknown[]) => mockDeleteRecordingRow(...args),
}));

describe('pull de uma entrada com capitulo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadConfig.mockResolvedValue({ baseUrl: 'https://diary.test', token: 't' });
    mockPullNotebooks.mockResolvedValue(0);
    mockRefreshAuthorSettings.mockResolvedValue(undefined);
    mockSyncEntities.mockResolvedValue(0);
    mockSyncServerTranscripts.mockResolvedValue(0);
    mockSyncServerAnalyses.mockResolvedValue(0);
    mockListRecordings.mockResolvedValue([]);
    mockUpsertRecording.mockResolvedValue(undefined);
    mockUpdateChapterFields.mockResolvedValue(undefined);
    mockObserveVersion.mockResolvedValue(undefined);
    mockListNotes.mockResolvedValue([]);
    mockListDeletedEntriesPage.mockResolvedValue({ entries: [], complete: true });
    mockListEntriesPage.mockResolvedValue({
      entries: [
        {
          ...ENTRY,
          chapter_kind: 'chapter',
          chapter_position: 4,
          chapter_status: 'draft',
          chapter_goal_words: 900,
          chapter_synopsis: 'Sinopse do servidor',
          chapter_beats: 'primeiro\nsegundo',
          chapter_notes: 'nota do dashboard',
        },
      ],
      complete: true,
    });
  });

  it('grava no SQLite o planejamento que veio do servidor', async () => {
    await pullServerEntries();

    expect(mockUpsertRecording).toHaveBeenCalledTimes(1);
    expect(mockUpdateChapterFields).toHaveBeenCalledWith('e1', {
      chapterKind: 'chapter',
      chapterPosition: 4,
      chapterStatus: 'draft',
      chapterGoalWords: 900,
      chapterSynopsis: 'Sinopse do servidor',
      chapterBeats: 'primeiro\nsegundo',
      chapterNotes: 'nota do dashboard',
    });
  });

  it('grava o vazio quando o servidor devolve o planejamento vazio', async () => {
    mockListEntriesPage.mockResolvedValue({
      entries: [
        {
          ...ENTRY,
          chapter_kind: '',
          chapter_position: 0,
          chapter_status: '',
          chapter_goal_words: 0,
          chapter_synopsis: '',
          chapter_beats: '',
          chapter_notes: '',
        },
      ],
      complete: true,
    });

    await pullServerEntries();

    expect(mockUpdateChapterFields).toHaveBeenCalledWith('e1', {
      chapterKind: '',
      chapterPosition: 0,
      chapterStatus: '',
      chapterGoalWords: 0,
      chapterSynopsis: '',
      chapterBeats: '',
      chapterNotes: '',
    });
  });

  it('completa a estrutura de um livro antigo mesmo sem mudanca de versao', async () => {
    // Instalacao antiga: a nota ja sincronizou, mas o pull descartava os
    // capitulos e deixou chapter_kind vazio no SQLite.
    mockListRecordings.mockResolvedValue([
      localRecording({
        titleVersion: 'v-title',
        recordedAtVersion: 'v-recorded',
        bodyVersion: 'v-body',
      }),
    ]);
    mockListEntriesPage.mockResolvedValue({
      entries: [
        {
          ...ENTRY,
          versions: { title: 'v-title', recorded_at: 'v-recorded', body: 'v-body' },
          chapter_kind: 'chapter',
          chapter_position: 1024,
          chapter_status: 'done',
          chapter_goal_words: 2000,
          chapter_synopsis: 'x',
          chapter_beats: '',
          chapter_notes: '',
        },
      ],
      complete: true,
    });

    await pullServerEntries();

    expect(mockUpsertRecording).not.toHaveBeenCalled();
    expect(mockUpdateChapterFields).toHaveBeenCalledWith('rec_1', {
      chapterKind: 'chapter',
      chapterPosition: 1024,
      chapterStatus: 'done',
      chapterGoalWords: 2000,
      chapterSynopsis: 'x',
      chapterBeats: '',
      chapterNotes: '',
    });
  });

  it('nao reescreve quando o planejamento local ja e igual ao do servidor', async () => {
    mockListRecordings.mockResolvedValue([
      localRecording({
        titleVersion: 'v-title',
        recordedAtVersion: 'v-recorded',
        bodyVersion: 'v-body',
        chapterKind: 'chapter',
        chapterPosition: 1024,
        chapterStatus: 'done',
        chapterGoalWords: 2000,
        chapterSynopsis: 'x',
        chapterBeats: '',
        chapterNotes: '',
      }),
    ]);
    mockListEntriesPage.mockResolvedValue({
      entries: [
        {
          ...ENTRY,
          versions: { title: 'v-title', recorded_at: 'v-recorded', body: 'v-body' },
          chapter_kind: 'chapter',
          chapter_position: 1024,
          chapter_status: 'done',
          chapter_goal_words: 2000,
          chapter_synopsis: 'x',
          chapter_beats: '',
          chapter_notes: '',
        },
      ],
      complete: true,
    });

    await pullServerEntries();

    expect(mockUpsertRecording).not.toHaveBeenCalled();
    expect(mockUpdateChapterFields).not.toHaveBeenCalled();
  });

  it('nao toca em nota comum sem capitulo', async () => {
    mockListRecordings.mockResolvedValue([localRecording()]);
    mockListEntriesPage.mockResolvedValue({ entries: [ENTRY], complete: true });

    await pullServerEntries();

    expect(mockUpdateChapterFields).not.toHaveBeenCalled();
  });
});
