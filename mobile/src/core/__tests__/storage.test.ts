import {
  aggregateStorage,
  storageFileKind,
  storageUsage,
  type NoteStorageUsage,
} from '../storage';
import type { Recording } from '../types';

function rec(partial: Partial<Recording>): Recording {
  return {
    id: 'r',
    title: 't',
    recordedAt: '2026-01-01T00:00:00.000Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('storageUsage', () => {
  it('soma o audio local e conta as sincronizadas', () => {
    const usage = storageUsage([
      rec({ id: 'a', filePath: 'x.aac', sizeBytes: 100, status: 'completed' }),
      rec({ id: 'b', filePath: 'y.aac', sizeBytes: 200, status: 'queued' }),
      rec({ id: 'c', status: 'completed' }),
    ]);
    expect(usage.noteCount).toBe(3);
    expect(usage.withAudio).toBe(2);
    expect(usage.syncedWithAudio).toBe(1);
    expect(usage.audioBytes).toBe(300);
  });

  it('sem audio devolve zeros', () => {
    const usage = storageUsage([rec({ id: 'c', status: 'completed' })]);
    expect(usage.withAudio).toBe(0);
    expect(usage.audioBytes).toBe(0);
  });
});

function note(partial: Partial<NoteStorageUsage>): NoteStorageUsage {
  const audioBytes = partial.audioBytes ?? 0;
  const imageBytes = partial.imageBytes ?? 0;
  const otherBytes = partial.otherBytes ?? 0;
  return {
    id: 'n',
    title: 'Nota',
    archived: false,
    status: 'completed',
    synced: true,
    audioBytes,
    imageBytes,
    otherBytes,
    totalBytes: audioBytes + imageBytes + otherBytes,
    canFreeAudio: false,
    ...partial,
  };
}

describe('storageFileKind', () => {
  it('separa audio, imagem e outros pelo nome', () => {
    expect(storageFileKind('seg-001.aac')).toBe('audio');
    expect(storageFileKind('original.M4A')).toBe('audio');
    expect(storageFileKind('foto.jpg')).toBe('image');
    expect(storageFileKind('foto.HEIC')).toBe('image');
    expect(storageFileKind('nota.txt')).toBe('other');
    expect(storageFileKind('sem-extensao')).toBe('other');
  });
});

describe('aggregateStorage', () => {
  it('soma categorias, ordena por tamanho e conta o que pode ser liberado', () => {
    const report = aggregateStorage({
      notes: [
        note({ id: 'pequena', audioBytes: 10, imageBytes: 5, canFreeAudio: true }),
        note({
          id: 'grande',
          audioBytes: 100,
          imageBytes: 50,
          otherBytes: 25,
          synced: false,
          canFreeAudio: false,
        }),
        note({ id: 'vazia', totalBytes: 0 }),
      ],
      models: { transcriptionBytes: 30, analysisBytes: 70 },
      caches: [
        { id: 'attachments', label: 'Anexos', bytes: 20 },
        { id: 'whisper', label: 'WAV', bytes: 10 },
      ],
      databaseBytes: 40,
      freeBytes: 20 * 1024 ** 3,
      totalBytes: 100 * 1024 ** 3,
      noteCount: 3,
    });

    expect(report.notes.map((item) => item.id)).toEqual(['grande', 'pequena']);
    expect(report.appBytes).toBe(10 + 5 + 100 + 50 + 25 + 30 + 70 + 20 + 10 + 40);
    expect(report.withAudio).toBe(2);
    expect(report.syncedWithAudio).toBe(1);
    expect(report.protectedNotes).toBe(1);
    expect(report.lowSpace).toBe(false);
    expect(report.categories.find((item) => item.id === 'audio')?.bytes).toBe(110);
    expect(report.categories.find((item) => item.id === 'images')?.bytes).toBe(55);
    expect(report.categories.find((item) => item.id === 'other')?.bytes).toBe(25);
  });

  it('alerta quando o aparelho tem pouco espaco livre', () => {
    const low = aggregateStorage({
      notes: [],
      models: { transcriptionBytes: 0, analysisBytes: 0 },
      caches: [],
      databaseBytes: 0,
      freeBytes: 500 * 1024 ** 2,
      totalBytes: 100 * 1024 ** 3,
      noteCount: 0,
    });
    expect(low.lowSpace).toBe(true);

    const ratio = aggregateStorage({
      notes: [],
      models: { transcriptionBytes: 0, analysisBytes: 0 },
      caches: [],
      databaseBytes: 0,
      freeBytes: 4 * 1024 ** 3,
      totalBytes: 100 * 1024 ** 3,
      noteCount: 0,
    });
    expect(ratio.lowSpace).toBe(true);

    const ok = aggregateStorage({
      notes: [],
      models: { transcriptionBytes: 0, analysisBytes: 0 },
      caches: [],
      databaseBytes: 0,
      freeBytes: 10 * 1024 ** 3,
      totalBytes: 100 * 1024 ** 3,
      noteCount: 0,
    });
    expect(ok.lowSpace).toBe(false);
  });

  it('devolve relatorio vazio sem notas nem arquivos', () => {
    const report = aggregateStorage({
      notes: [],
      models: { transcriptionBytes: 0, analysisBytes: 0 },
      caches: [],
      databaseBytes: 0,
      freeBytes: null,
      totalBytes: null,
      noteCount: 0,
    });
    expect(report.appBytes).toBe(0);
    expect(report.notes).toEqual([]);
    expect(report.lowSpace).toBe(false);
    expect(report.categories).toHaveLength(7);
  });
});
