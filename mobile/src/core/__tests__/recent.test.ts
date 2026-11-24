import { buildRecentItems, filterRecent, sortRecent, type RecentItem } from '../recent';
import type { Notebook } from '../notebooks';
import type { Recording } from '../types';

function notebook(over: Partial<Notebook> & { id: string; name: string }): Notebook {
  return {
    color: '',
    isDefault: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

function rec(id: string, over: Partial<Recording> = {}): Recording {
  return {
    id,
    title: over.title ?? `nota ${id}`,
    recordedAt: over.recordedAt ?? '2026-10-01T10:00:00.000Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    createdAt: over.createdAt ?? '2026-10-01T10:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

function projectBody(date: string, time: string): string {
  return [
    '```dyarium-json',
    `{"v":1,"project":"dyarium","date":"${date}","time":"${time}","host":"vps-dev","detail":"concise","items":[{"kind":"feat","title":"item ${date}"}]}`,
    '```',
  ].join('\n');
}

const NOTEBOOKS: Notebook[] = [
  notebook({ id: 'notas-ao-acaso', name: 'Notas ao acaso', isDefault: true }),
  notebook({ id: 'nb-book', name: 'O nome do vento', kind: 'book' }),
  notebook({ id: 'nb-mcp', name: 'Projetos', kind: 'mcp' }),
];

describe('buildRecentItems', () => {
  it('mantem nota comum, transforma notas do MCP em projeto e livro em linha propria', () => {
    const recordings: Recording[] = [
      rec('note-common', {
        notebookId: 'notas-ao-acaso',
        text: 'anotacao solta',
        recordedAt: '2026-11-09T10:00:00.000Z',
      }),
      rec('note-mcp-1', {
        notebookId: 'nb-mcp',
        title: 'dyarium',
        text: projectBody('2026-11-07', '14:58'),
        recordedAt: '2026-11-07T10:00:00.000Z',
      }),
      rec('note-mcp-2', {
        notebookId: 'nb-mcp',
        title: 'dyarium',
        text: projectBody('2026-11-08', '09:00'),
        recordedAt: '2026-11-08T10:00:00.000Z',
      }),
      rec('chapter-1', {
        notebookId: 'nb-book',
        title: 'Capítulo um',
        text: 'era uma vez',
        recordedAt: '2026-11-06T10:00:00.000Z',
        chapterKind: 'chapter',
      }),
      rec('part-1', {
        notebookId: 'nb-book',
        title: 'Parte um',
        text: 'introducao',
        recordedAt: '2026-11-05T10:00:00.000Z',
        chapterKind: 'part',
      }),
    ];

    const items = buildRecentItems({ recordings, notebooks: NOTEBOOKS });

    const noteItem = items.find((i) => i.kind === 'note');
    const bookItem = items.find((i) => i.kind === 'book');
    const projectItem = items.find((i) => i.kind === 'project');

    expect(noteItem?.kind === 'note' ? noteItem.recording.id : null).toBe('note-common');

    expect(bookItem?.kind === 'book' ? bookItem.notebook.id : null).toBe('nb-book');
    expect(bookItem?.kind === 'book' ? bookItem.chapterCount : null).toBe(1);
    expect(bookItem?.kind === 'book' ? bookItem.words : null).toBe(3);

    expect(projectItem?.kind === 'project' ? projectItem.name : null).toBe('dyarium');
    expect(projectItem?.kind === 'project' ? projectItem.sessions : null).toBe(2);
    expect(projectItem?.kind === 'project' ? projectItem.date : null).toBe('2026-11-08T09:00');

    expect(items.some((i) => i.kind === 'note' && i.recording.notebookId === 'nb-mcp')).toBe(false);
  });

  it('data do livro usa o updatedAt do ultimo capitulo quando ele e mais novo', () => {
    const book = notebook({
      id: 'nb-book',
      name: 'Livro',
      kind: 'book',
      updatedAt: '2026-11-01T10:00:00.000Z',
    });
    const recordings: Recording[] = [
      rec('chapter-1', {
        notebookId: 'nb-book',
        text: 'texto',
        recordedAt: '2026-11-05T10:00:00.000Z',
        updatedAt: '2026-11-18T21:10:00.000Z',
        chapterKind: 'chapter',
      }),
    ];

    const items = buildRecentItems({ recordings, notebooks: [book] });
    const bookItem = items[0];
    expect(bookItem?.kind).toBe('book');
    expect(bookItem?.kind === 'book' ? bookItem.date : '').toBe('2026-11-18T21:10:00.000Z');
  });

  it('data do livro ignora recordedAt antigo e pega updatedAt do capitulo', () => {
    const book = notebook({
      id: 'nb-book',
      name: 'Livro',
      kind: 'book',
      updatedAt: '2026-11-01T10:00:00.000Z',
    });
    const recordings: Recording[] = [
      rec('chapter-1', {
        notebookId: 'nb-book',
        text: 'texto editado',
        recordedAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-11-18T21:10:00.000Z',
        chapterKind: 'chapter',
      }),
    ];

    const items = buildRecentItems({ recordings, notebooks: [book] });
    const bookItem = items[0];
    expect(bookItem?.kind).toBe('book');
    expect(bookItem?.kind === 'book' ? bookItem.date : '').toBe('2026-11-18T21:10:00.000Z');
  });

  it('ignora notas arquivadas ou rascunhos em branco', () => {
    const recordings: Recording[] = [
      rec('archived', { notebookId: 'notas-ao-acaso', archived: true }),
      rec('draft', {
        notebookId: 'notas-ao-acaso',
        title: '',
        text: '',
        status: 'draft',
      }),
    ];

    const items = buildRecentItems({ recordings, notebooks: [NOTEBOOKS[0]] });
    expect(items).toHaveLength(0);
  });
});

describe('sortRecent', () => {
  it('mistura notas, livros e projetos por data decrescente', () => {
    const items: RecentItem[] = [
      { kind: 'note', recording: rec('old-note', { recordedAt: '2026-11-05T10:00:00.000Z' }) },
      { kind: 'note', recording: rec('new-note', { recordedAt: '2026-11-09T10:00:00.000Z' }) },
      {
        kind: 'book',
        notebook: NOTEBOOKS[1],
        chapterCount: 1,
        words: 10,
        date: '2026-11-07T10:00:00.000Z',
      },
      { kind: 'project', name: 'dyarium', sessions: 1, date: '2026-11-08T09:00', mcpId: 'nb-mcp' },
    ];

    const sorted = sortRecent(items, 'newest');
    expect(sorted.map((i) => (i.kind === 'note' ? i.recording.id : i.kind === 'book' ? 'book' : i.name))).toEqual([
      'new-note',
      'dyarium',
      'book',
      'old-note',
    ]);
  });

  it('inverte apenas a ordem entre notas no modo mais antigas', () => {
    const items: RecentItem[] = [
      { kind: 'note', recording: rec('a', { recordedAt: '2026-11-01T10:00:00.000Z' }) },
      { kind: 'note', recording: rec('b', { recordedAt: '2026-11-03T10:00:00.000Z' }) },
      { kind: 'project', name: 'dyarium', sessions: 1, date: '2026-11-02T10:00', mcpId: 'nb-mcp' },
    ];

    const sorted = sortRecent(items, 'oldest');
    expect(sorted.map((i) => (i.kind === 'note' ? i.recording.id : i.kind === 'project' ? 'project' : 'other'))).toEqual([
      'a',
      'project',
      'b',
    ]);
  });
});

describe('filterRecent', () => {
  const items: RecentItem[] = [
    { kind: 'note', recording: rec('note', { notebookId: 'notas-ao-acaso', text: 'praia' }) },
    {
      kind: 'book',
      notebook: NOTEBOOKS[1],
      chapterCount: 1,
      words: 10,
      date: '2026-11-07T10:00:00.000Z',
    },
    { kind: 'project', name: 'dyarium', sessions: 1, date: '2026-11-08T09:00', mcpId: 'nb-mcp' },
  ];

  it('busca por nome de livro e de projeto', () => {
    expect(filterRecent(items, { query: 'vento' }).map((i) => i.kind)).toEqual(['book']);
    expect(filterRecent(items, { query: 'dyarium' }).map((i) => i.kind)).toEqual(['project']);
  });

  it('busca e filtra tags apenas em notas', () => {
    const noteItem = items[0];
    if (noteItem?.kind === 'note') {
      noteItem.recording.tags = ['viagem'];
    }

    expect(filterRecent(items, { query: 'praia' }).map((i) => i.kind)).toContain('note');
    // Tags so afetam notas; livros e projetos continuam visiveis.
    expect(filterRecent(items, { tags: ['viagem'] }).map((i) => i.kind)).toEqual([
      'note',
      'book',
      'project',
    ]);
    expect(filterRecent(items, { tags: ['viagem'], query: 'dyarium' }).map((i) => i.kind)).toEqual(['project']);
  });

  it('escopo por caderno comum mostra so notas daquele caderno', () => {
    const withOtherNote: RecentItem[] = [
      ...items,
      { kind: 'note', recording: rec('other', { notebookId: 'nb-outro', text: 'outro' }) },
    ];

    const result = filterRecent(withOtherNote, { notebookId: 'nb-outro' });
    expect(result.map((i) => (i.kind === 'note' ? i.recording.id : null))).toEqual(['other']);
    expect(result.some((i) => i.kind === 'book' || i.kind === 'project')).toBe(false);
  });
});
