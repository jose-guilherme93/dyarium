import {
  activeNoteCount,
  isVisibleNote,
  lastNoteAt,
  noteMatches,
  notebookStats,
  notesInNotebook,
  recentNotes,
  searchRecordings,
  tagCountsForFilter,
} from '../notebookFilter';
import { sameNotebooks, sortNotebooks, type Notebook } from '../notebooks';
import type { Recording } from '../types';

const rec = (id: string, over: Partial<Recording> = {}): Recording => ({
  id,
  title: over.title ?? `nota ${id}`,
  recordedAt: over.recordedAt ?? '2026-10-01T10:00:00Z',
  dir: '',
  segmentCount: 0,
  status: 'completed',
  offset: 0,
  attempts: 0,
  entryId: id,
  notebookId: 'nb_trabalho',
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  ...over,
});

describe('notebook filter', () => {
  const list = [
    rec('a', { tags: ['viagem', 'familia'], text: 'praia' }),
    rec('b', { tags: ['viagem'], text: 'avião' }),
    rec('c', { notebookId: 'nb_estudo', tags: ['viagem'], text: 'ingles' }),
    rec('d', { archived: true, tags: ['viagem'] }),
  ];

  it('separa por caderno e exige todas as tags', () => {
    expect(
      notesInNotebook(list, { notebookId: 'nb_trabalho', tags: ['viagem', 'familia'] }).map(
        (item) => item.id,
      ),
    ).toEqual(['a']);
    expect(noteMatches(list[0], { notebookId: 'nb_trabalho', tags: ['viagem'] })).toBe(true);
    expect(noteMatches(list[0], { notebookId: 'nb_estudo' })).toBe(false);
  });

  it('busca no titulo, corpo, transcricao e tags', () => {
    expect(noteMatches(list[0], { notebookId: 'nb_trabalho', query: 'praia' })).toBe(true);
    expect(noteMatches(list[0], { notebookId: 'nb_trabalho', query: 'familia' })).toBe(true);
    expect(noteMatches(list[1], { notebookId: 'nb_trabalho', query: 'avião' })).toBe(true);
  });

  it('contagens contextuais somam as tags ja selecionadas', () => {
    const counts = tagCountsForFilter(list, 'nb_trabalho', ['viagem']);
    const familia = counts.find((tag) => tag.name === 'familia');
    const viagem = counts.find((tag) => tag.name === 'viagem');
    expect(viagem?.count).toBe(2);
    expect(familia?.count).toBe(1);
  });

  it('recentes ignoram arquivadas e ordenam por ultima edicao', () => {
    const recent = recentNotes([
      rec('a', { updatedAt: '2026-10-02T10:00:00Z' }),
      rec('b', { updatedAt: '2026-10-03T10:00:00Z' }),
      rec('d', { archived: true, updatedAt: '2026-10-04T10:00:00Z' }),
    ]);
    expect(recent.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('recentes cruzam cadernos e respeitam busca/tags', () => {
    const recent = recentNotes(list, { tags: ['viagem'], query: 'avião' });
    expect(recent.map((item) => item.id)).toEqual(['b']);
  });

  it('tags globais do modo Recentes somam todos os cadernos', () => {
    const counts = tagCountsForFilter(list, null, []);
    expect(counts.find((tag) => tag.name === 'viagem')?.count).toBe(3);
  });

  it('busca global inclui arquivadas e outros cadernos', () => {
    const results = searchRecordings(list, 'viagem');
    expect(results.map((item) => item.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('conta e data usam a data real da nota', () => {
    expect(activeNoteCount(list, 'nb_trabalho')).toBe(2);
    expect(lastNoteAt(list, 'nb_trabalho')).toBe('2026-10-01T10:00:00Z');
  });

  it('resume todos os cadernos numa passada, ignorando arquivadas', () => {
    const stats = notebookStats([
      rec('a', { notebookId: 'nb_trabalho', recordedAt: '2026-10-01T10:00:00Z' }),
      rec('b', { notebookId: 'nb_trabalho', recordedAt: '2026-10-05T10:00:00Z' }),
      rec('d', {
        archived: true,
        notebookId: 'nb_trabalho',
        recordedAt: '2026-10-09T10:00:00Z',
      }),
      rec('c', { notebookId: 'nb_estudo', recordedAt: '2026-10-02T10:00:00Z' }),
    ]);

    expect(stats.get('nb_trabalho')).toEqual({
      count: 2,
      lastAt: '2026-10-05T10:00:00Z',
    });
    expect(stats.get('nb_estudo')).toEqual({
      count: 1,
      lastAt: '2026-10-02T10:00:00Z',
    });
    expect(stats.get('nb_vazio')).toBeUndefined();
  });

  it('busca e tags acompanham a nova identidade da nota', () => {
    const original = rec('a', { title: '', text: 'praia' });
    expect(noteMatches(original, { query: 'montanha' })).toBe(false);
    expect(noteMatches(original, { tags: ['trilha'] })).toBe(false);

    const edited = { ...original, text: 'montanha', tags: ['trilha'] };
    expect(noteMatches(edited, { query: 'montanha' })).toBe(true);
    expect(noteMatches(edited, { tags: ['trilha'] })).toBe(true);
    expect(searchRecordings([original], 'trilha')).toEqual([]);
    expect(searchRecordings([original], 'montanha')).toEqual([]);
    expect(searchRecordings([edited], 'trilha').map((item) => item.id)).toEqual(['a']);
    expect(searchRecordings([edited], 'montanha').map((item) => item.id)).toEqual(['a']);
  });
});

describe('rascunhos na lista', () => {
  const draft = (over: Partial<Recording> = {}): Recording => ({
    id: 'draft-1',
    title: '',
    recordedAt: '2026-10-01T10:00:00Z',
    dir: '',
    segmentCount: 0,
    status: 'draft',
    offset: 0,
    attempts: 0,
    notebookId: 'nb_trabalho',
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    ...over,
  });

  it('rascunho vazio nao aparece', () => {
    expect(isVisibleNote(draft())).toBe(false);
    expect(recentNotes([draft()])).toEqual([]);
    expect(activeNoteCount([draft()], 'nb_trabalho')).toBe(0);
  });

  it('rascunho com audio continua visivel mesmo sem ter sido submetido', () => {
    const withAudio = draft({ filePath: 'file:///audio.aac', durationMs: 5000 });
    expect(isVisibleNote(withAudio)).toBe(true);
    expect(recentNotes([withAudio]).map((item) => item.id)).toEqual(['draft-1']);
    expect(notesInNotebook([withAudio], { notebookId: 'nb_trabalho' })).toHaveLength(1);
  });

  it('rascunho com texto ou titulo tambem aparece, inclusive na busca', () => {
    const withText = draft({ text: 'escrevendo agora' });
    expect(isVisibleNote(withText)).toBe(true);
    expect(isVisibleNote(draft({ title: 'titulo' }))).toBe(true);
    expect(searchRecordings([withText], 'escrevendo')).toHaveLength(1);
  });
});

describe('sameNotebooks', () => {
  const notebook = (id: string, over: Partial<Notebook> = {}): Notebook => ({
    id,
    name: `caderno ${id}`,
    color: '',
    isDefault: false,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  });

  it('reconhece a mesma lista lida duas vezes do banco', () => {
    expect(sameNotebooks([notebook('a'), notebook('b')], [notebook('a'), notebook('b')])).toBe(
      true,
    );
  });

  it('detecta nome, cor, ordem e tamanho diferentes', () => {
    expect(sameNotebooks([notebook('a')], [notebook('a', { name: 'outro' })])).toBe(false);
    expect(sameNotebooks([notebook('a')], [notebook('a', { color: '#fff' })])).toBe(false);
    expect(sameNotebooks([notebook('a'), notebook('b')], [notebook('b'), notebook('a')])).toBe(
      false,
    );
    expect(sameNotebooks([notebook('a')], [])).toBe(false);
  });

  it('detecta alteracao pendente de sync', () => {
    expect(sameNotebooks([notebook('a')], [notebook('a', { dirty: true })])).toBe(false);
  });
});

describe('sortNotebooks', () => {
  const notebook = (id: string, name: string, createdAt: string, isDefault = false): Notebook => ({
    id,
    name,
    color: '',
    isDefault,
    createdAt,
    updatedAt: createdAt,
  });

  it('ordena por criacao e deixa o padrao no fim', () => {
    const sorted = sortNotebooks([
      notebook('b', 'Trabalho', '2026-10-02T00:00:00Z'),
      notebook('d', 'Notas ao acaso', '2026-01-01T00:00:00Z', true),
      notebook('a', 'Estudo', '2026-10-01T00:00:00Z'),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['a', 'b', 'd']);
  });

  it('A-Z mantem o padrao no fim', () => {
    const sorted = sortNotebooks(
      [
        notebook('b', 'Trabalho', '2026-10-02T00:00:00Z'),
        notebook('a', 'Estudo', '2026-10-01T00:00:00Z'),
        notebook('d', 'Notas ao acaso', '2026-01-01T00:00:00Z', true),
      ],
      true,
    );
    expect(sorted.map((item) => item.name)).toEqual(['Estudo', 'Trabalho', 'Notas ao acaso']);
  });
});
