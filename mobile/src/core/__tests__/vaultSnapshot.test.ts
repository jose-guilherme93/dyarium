import {
  mergeSnapshotNotes,
  mergeStateNotebooks,
  mergeStateNotes,
  notebookFromState,
  notebooksToState,
  notesSnapshotNoteFromState,
  parseVaultSnapshot,
  parseVaultState,
  recordingFromSnapshotNote,
  shouldRestoreNote,
  snapshotFromRecordings,
  stateNotesFromRecordings,
  type VaultSnapshotNote,
  type VaultStateNote,
} from '../vaultSnapshot';
import type { Notebook } from '../notebooks';
import type { Recording } from '../types';

function recording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'n1',
    title: 'Conversa',
    recordedAt: '2026-11-21T14:20:00.000Z',
    dir: 'recordings/n1',
    segmentCount: 1,
    status: 'completed',
    source: 'text',
    offset: 0,
    attempts: 0,
    createdAt: '2026-11-21T14:20:00.000Z',
    updatedAt: '2026-11-21T14:20:00.000Z',
    text: 'corpo',
    ...overrides,
  };
}

function snapshotNote(overrides: Partial<VaultSnapshotNote> = {}): VaultSnapshotNote {
  return {
    id: 'n1',
    title: 'Conversa',
    recordedAt: '2026-11-21T14:20:00.000Z',
    updatedAt: '2026-11-21T14:20:00.000Z',
    text: 'corpo',
    ...overrides,
  };
}

function snapshot(notes: VaultSnapshotNote[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    vaultId: 'abc123',
    createdAt: '2026-11-22T10:00:00.000Z',
    notes,
    ...extra,
  });
}

describe('retrato do cofre (backup.enc)', () => {
  it('le o formato do web', () => {
    const parsed = parseVaultSnapshot(snapshot([snapshotNote()]));
    expect(parsed.version).toBe(1);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0]).toMatchObject({ id: 'n1', title: 'Conversa', text: 'corpo' });
  });

  it('recusa versao desconhecida, JSON invalido e lista que nao e lista', () => {
    expect(() => parseVaultSnapshot(snapshot([], { version: 2 }))).toThrow();
    expect(() => parseVaultSnapshot('{')).toThrow();
    expect(() => parseVaultSnapshot(JSON.stringify({ version: 1, notes: {} }))).toThrow();
  });

  it('recusa id invalido, texto gigante e notas demais', () => {
    expect(() => parseVaultSnapshot(snapshot([snapshotNote({ id: '' })]))).toThrow();
    expect(() => parseVaultSnapshot(snapshot([snapshotNote({ id: 'x'.repeat(200) })]))).toThrow();
    expect(() => parseVaultSnapshot(snapshot([snapshotNote({ text: 'x'.repeat(2_097_153) })]))).toThrow();
    const many = Array.from({ length: 50_001 }, (_, i) => snapshotNote({ id: `n${i}` }));
    expect(() => parseVaultSnapshot(snapshot(many))).toThrow();
  });

  it('recusa data invalida e tags fora do formato', () => {
    expect(() => parseVaultSnapshot(snapshot([snapshotNote({ updatedAt: 'ontem' })]))).toThrow();
    expect(() => parseVaultSnapshot(snapshot([snapshotNote({ tags: [1 as unknown as string] })]))).toThrow();
    expect(() => parseVaultSnapshot(snapshot([snapshotNote({ tags: ['x'.repeat(80)] })]))).toThrow();
  });

  it('respeita o teto de bytes do arquivo', () => {
    const huge = JSON.stringify({ version: 1, notes: [snapshotNote({ text: 'x'.repeat(70 * 1024 * 1024) })] });
    expect(() => parseVaultSnapshot(huge)).toThrow();
  });

  it('monta o retrato a partir das notas vivas', () => {
    const notes = snapshotFromRecordings([
      recording(),
      recording({ id: 'n2', archived: true, tags: ['ideia'], notebookId: 'book1', icon: '✦' }),
    ]);
    expect(notes.map((note) => note.id)).toEqual(['n1', 'n2']);
    expect(notes[1]).toMatchObject({ archived: true, tags: ['ideia'], notebookId: 'book1', icon: '✦' });
  });

  it('nao inclui nota apagada no retrato', () => {
    const notes = snapshotFromRecordings([recording({ deletedAt: '2026-11-22T00:00:00.000Z' })]);
    expect(notes).toHaveLength(0);
  });

  it('une os dois lados pelo id e deixa vencer o mais novo', () => {
    const merged = mergeSnapshotNotes(
      [snapshotNote({ text: 'local' }), snapshotNote({ id: 'n2', title: 'so local' })],
      [
        snapshotNote({ text: 'remoto', updatedAt: '2026-11-22T00:00:00.000Z' }),
        snapshotNote({ id: 'n3', title: 'so remoto' }),
      ],
    );
    expect(merged.find((note) => note.id === 'n1')?.text).toBe('remoto');
    expect(merged.map((note) => note.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('empate fica com o local e nao reescreve', () => {
    const merged = mergeSnapshotNotes([snapshotNote({ text: 'local' })], [snapshotNote({ text: 'remoto' })]);
    expect(merged[0].text).toBe('local');
  });

  it('nao restaura nota local mais nova nem nota apagada depois do retrato', () => {
    const old = snapshotNote({ updatedAt: '2026-11-21T00:00:00.000Z' });
    expect(
      shouldRestoreNote(recording({ updatedAt: '2026-11-22T00:00:00.000Z' }), old),
    ).toBe(false);
    expect(
      shouldRestoreNote(recording({ deletedAt: '2026-11-22T00:00:00.000Z' }), old),
    ).toBe(false);
    expect(
      shouldRestoreNote(recording({ updatedAt: '2026-11-20T00:00:00.000Z' }), old),
    ).toBe(true);
  });

  it('preserva audio, transcricao e diretorio locais ao aplicar o retrato', () => {
    const existing = recording({
      dir: 'recordings/n1',
      filePath: 'file:///recordings/n1/audio.aac',
      transcript: 'fala',
      hasTranscript: true,
      durationMs: 5000,
      updatedAt: '2026-11-20T00:00:00.000Z',
      status: 'completed',
    });
    const applied = recordingFromSnapshotNote(
      snapshotNote({ title: 'novo titulo', text: 'novo corpo', updatedAt: '2026-11-22T00:00:00.000Z' }),
      existing,
      'hlc-1',
    );
    expect(applied).toMatchObject({
      id: 'n1',
      title: 'novo titulo',
      text: 'novo corpo',
      updatedAt: '2026-11-22T00:00:00.000Z',
      filePath: 'file:///recordings/n1/audio.aac',
      transcript: 'fala',
      hasTranscript: true,
      durationMs: 5000,
      updatedHlc: 'hlc-1',
      status: 'completed',
    });
  });

  it('nota nova nasce concluida, sem arquivo nem transcricao', () => {
    const applied = recordingFromSnapshotNote(snapshotNote(), null, 'hlc-2');
    expect(applied).toMatchObject({
      id: 'n1',
      status: 'completed',
      source: 'text',
      dir: '',
      segmentCount: 0,
      notebookId: 'notas-ao-acaso',
    });
    expect(applied.filePath).toBeUndefined();
    expect(applied.transcript).toBeUndefined();
  });
});

function stateNote(overrides: Partial<VaultStateNote> = {}): VaultStateNote {
  return {
    id: 'n1',
    title: 'Conversa',
    recordedAt: '2026-11-21T14:20:00.000Z',
    updatedAt: '2026-11-21T14:20:00.000Z',
    notebookId: 'notas-ao-acaso',
    icon: '',
    author: '',
    text: 'corpo',
    chapterKind: '',
    chapterPosition: 0,
    chapterStatus: '',
    chapterGoalWords: 0,
    chapterSynopsis: '',
    chapterBeats: '',
    chapterNotes: '',
    ...overrides,
  };
}

function notebookState(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'nb1',
    name: 'Livro',
    color: '',
    is_default: false,
    kind: 'book',
    subtitle: '',
    author: '',
    synopsis: '',
    language: '',
    goal_words: 0,
    book_status: 'drafting',
    deadline: '',
    has_cover: false,
    cover_updated_at: null,
    created_at: '2026-11-20T00:00:00.000Z',
    updated_at: '2026-11-20T00:00:00.000Z',
    ...overrides,
  };
}

function state(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 2,
    vaultId: 'abc123',
    createdAt: '2026-11-22T10:00:00.000Z',
    notes: [stateNote()],
    notebooks: [notebookState()],
    ...extra,
  });
}

describe('retrato do cofre (state.enc v2)', () => {
  it('le notas, cadernos, analises e ajustes do web', () => {
    const parsed = parseVaultState(
      state({
        analyses: [{ entry_id: 'n1', analysis: { reading: 'ok' } }],
        settings: { owner_name: 'Ana' },
      }),
    );
    expect(parsed.version).toBe(2);
    expect(parsed.notes[0]).toMatchObject({ id: 'n1', text: 'corpo', chapterKind: '' });
    expect(parsed.notebooks[0]).toMatchObject({ id: 'nb1', kind: 'book' });
    expect(parsed.analyses).toEqual([{ entry_id: 'n1', analysis: { reading: 'ok' } }]);
    expect(parsed.settings).toEqual({ owner_name: 'Ana' });
  });

  it('aceita cofre v2 antigo sem cadernos', () => {
    const parsed = parseVaultState(
      JSON.stringify({
        version: 2,
        vaultId: 'abc123',
        createdAt: '2026-11-22T10:00:00.000Z',
        notes: [],
      }),
    );
    expect(parsed.notebooks).toEqual([]);
  });

  it('recusa versao desconhecida, nota repetida e caderno sem nome', () => {
    expect(() => parseVaultState(JSON.stringify({ version: 3, notes: [] }))).toThrow();
    expect(() => parseVaultState(state({ notes: [stateNote(), stateNote()] }))).toThrow();
    expect(() =>
      parseVaultState(state({ notebooks: [notebookState({ name: '' })] })),
    ).toThrow();
    expect(() => parseVaultState('{')).toThrow();
  });

  it('le a transcricao e o capitulo que o web grava', () => {
    const parsed = parseVaultState(
      state({
        notes: [
          stateNote({
            transcript: 'fala',
            transcriptStatus: 'ready',
            hasTranscript: true,
            transcriptSegments: [{ start_ms: 0, end_ms: 10, text: 'oi' }],
            chapterKind: 'chapter',
            chapterPosition: 2048,
            chapterGoalWords: 900,
            parentId: 'origem',
          }),
        ],
      }),
    );
    expect(parsed.notes[0]).toMatchObject({
      transcript: 'fala',
      transcriptStatus: 'ready',
      hasTranscript: true,
      chapterKind: 'chapter',
      chapterPosition: 2048,
      chapterGoalWords: 900,
      parentId: 'origem',
    });
  });

  it('une notas por id e deixa vencer o updatedAt mais novo', () => {
    const merged = mergeStateNotes(
      [stateNote({ text: 'local', updatedAt: '2026-11-22T00:00:00.000Z' }), stateNote({ id: 'n2' })],
      [
        stateNote({ text: 'remoto', updatedAt: '2026-11-23T00:00:00.000Z' }),
        stateNote({ id: 'n3' }),
      ],
    );
    expect(merged.map((note) => note.id)).toEqual(['n1', 'n2', 'n3']);
    expect(merged.find((note) => note.id === 'n1')?.text).toBe('remoto');
  });

  it('empate fica com o local e nao duplica', () => {
    const merged = mergeStateNotes([stateNote({ text: 'local' })], [stateNote({ text: 'remoto' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe('local');
  });

  it('une cadernos por id com o updated_at mais novo', () => {
    const merged = mergeStateNotebooks(
      [
        notebookState({ name: 'local novo', updated_at: '2026-11-25T00:00:00.000Z' }),
        notebookState({ id: 'nb2', name: 'so local' }),
      ],
      [
        notebookState({ name: 'remoto velho', updated_at: '2026-11-24T00:00:00.000Z' }),
        notebookState({ id: 'nb3', name: 'so remoto' }),
      ],
    );
    expect(merged.map((notebook) => notebook.id)).toEqual(['nb1', 'nb2', 'nb3']);
    expect(merged[0].name).toBe('local novo');
  });

  it('monta as notas v2 com transcricao, capitulo e campos vazios do web', () => {
    const notes = stateNotesFromRecordings([
      recording({
        transcript: 'fala',
        transcriptStatus: 'ready',
        transcriptSegments: [{ start_ms: 0, end_ms: 10, text: 'oi' }],
        hasTranscript: true,
        chapterKind: 'chapter',
        chapterPosition: 1024,
        icon: '✦',
        author: 'self',
        tags: ['ideia'],
      }),
    ]);
    expect(notes[0]).toMatchObject({
      id: 'n1',
      icon: '✦',
      author: 'self',
      tags: ['ideia'],
      transcript: 'fala',
      transcriptSegments: [{ start_ms: 0, end_ms: 10, text: 'oi' }],
      chapterKind: 'chapter',
      chapterPosition: 1024,
      chapterSynopsis: '',
      chapterBeats: '',
      chapterNotes: '',
      chapterGoalWords: 0,
    });
    expect(notes[0].notebookId).toBe('notas-ao-acaso');
  });

  it('nao leva nota apagada para o retrato v2', () => {
    expect(
      stateNotesFromRecordings([recording({ deletedAt: '2026-11-22T00:00:00.000Z' })]),
    ).toHaveLength(0);
  });

  it('projeta a nota v2 para o v1 sem os campos que o app antigo nao entende', () => {
    const v1 = notesSnapshotNoteFromState(stateNote({ transcript: 'fala', chapterKind: 'chapter' }));
    expect(v1).toMatchObject({ id: 'n1', text: 'corpo' });
    expect((v1 as unknown as Record<string, unknown>).transcript).toBeUndefined();
    expect((v1 as unknown as Record<string, unknown>).chapterKind).toBeUndefined();
  });

  it('converte cadernos locais no formato do web e de volta', () => {
    const local: Notebook = {
      id: 'nb1',
      name: 'Livro',
      color: '#fff',
      isDefault: false,
      kind: 'book',
      createdAt: '2026-11-20T00:00:00.000Z',
      updatedAt: '2026-11-21T00:00:00.000Z',
      subtitle: 'sub',
      goalWords: 5000,
      bookStatus: 'revising',
      pageSize: 'a5',
      hasCover: true,
      coverUpdatedAt: 'v2',
      deadline: '2026-12-01',
    };
    const [state] = notebooksToState([local], new Map([['nb1', { notes: 4, chapters: 2 }]]));
    expect(state).toMatchObject({
      id: 'nb1',
      name: 'Livro',
      kind: 'book',
      is_default: false,
      subtitle: 'sub',
      goal_words: 5000,
      book_status: 'revising',
      page_size: 'a5',
      has_cover: true,
      cover_updated_at: 'v2',
      deadline: '2026-12-01',
      entry_count: 4,
      chapter_count: 2,
    });
    expect(notebookFromState(state)).toMatchObject({
      id: 'nb1',
      name: 'Livro',
      kind: 'book',
      isDefault: false,
      subtitle: 'sub',
      goalWords: 5000,
      bookStatus: 'revising',
      pageSize: 'a5',
      hasCover: true,
      coverUpdatedAt: 'v2',
      deadline: '2026-12-01',
    });
  });

  it('aplica transcricao e capitulo do retrato v2 na nota local', () => {
    const applied = recordingFromSnapshotNote(
      stateNote({
        transcript: 'fala',
        transcriptStatus: 'ready',
        hasTranscript: true,
        transcriptSegments: [{ start_ms: 0, end_ms: 10, text: 'oi' }],
        chapterKind: 'chapter',
        chapterPosition: 2048,
        chapterSynopsis: 'resumo',
        parentId: 'origem',
        updatedAt: '2026-11-24T00:00:00.000Z',
      }),
      null,
      'hlc-1',
    );
    expect(applied).toMatchObject({
      transcript: 'fala',
      transcriptStatus: 'ready',
      hasTranscript: true,
      transcriptSegments: [{ start_ms: 0, end_ms: 10, text: 'oi' }],
      chapterKind: 'chapter',
      chapterPosition: 2048,
      chapterSynopsis: 'resumo',
      captureSourceId: 'origem',
      updatedAt: '2026-11-24T00:00:00.000Z',
      updatedHlc: 'hlc-1',
    });
  });
});
