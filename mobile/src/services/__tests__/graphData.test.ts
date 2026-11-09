import type { EntityLink, GraphEntity, GraphEntry } from '@/core/graphModel';

import type { EntityPanelRow } from '../db';
import {
  graphFromSnapshot,
  kindCounts,
  loadEntityPanel,
  loadGraphSnapshot,
  loadMoodSeries,
  noteKeyFromNode,
  type GraphSnapshot,
} from '../graphData';

const mockRows = jest.fn();
const mockEntities = jest.fn();
const mockLinks = jest.fn();
const mockAliases = jest.fn();
const mockOwnerAliases = jest.fn();
const mockOwnerSettings = jest.fn();
const mockPanelRows = jest.fn();
const mockSentiments = jest.fn();

jest.mock('../db', () => ({
  listGraphRecordings: () => mockRows(),
  listLocalEntities: () => mockEntities(),
  listEntityLinks: () => mockLinks(),
  listEntityAliases: () => mockAliases(),
  listOwnerAliases: () => mockOwnerAliases(),
  loadEntityPanelRows: (ids: string[]) => mockPanelRows(ids),
  loadAnalysisSentiments: (ids: string[]) => mockSentiments(ids),
  loadGraphLayout: jest.fn(async () => null),
  saveGraphLayout: jest.fn(async () => undefined),
}));

jest.mock('../authorSettings', () => ({
  loadAuthorSettings: () => mockOwnerSettings(),
}));

const ROWS = [
  {
    localId: 'arquivada',
    title: 'Arquivada',
    recordedAt: '2026-10-22T10:00:00',
    notebookId: 'nb1',
    archived: true,
  },
  {
    localId: 'local2',
    title: 'Trabalho',
    recordedAt: '2026-10-21T10:00:00',
    notebookId: 'nb2',
    archived: false,
    local: { key: 'local2', origin: 'local', sentiment: -0.2 },
  },
  {
    localId: 'local1',
    entryId: 'srv1',
    title: 'Praia',
    recordedAt: '2026-10-20T10:00:00',
    notebookId: 'nb1',
    archived: false,
    definitive: { key: 'srv1', origin: 'server', sentiment: 0.4 },
  },
  {
    localId: 'local3',
    entryId: 'srv3',
    title: 'Pendente',
    recordedAt: '2026-10-19T10:00:00',
    notebookId: 'nb1',
    archived: false,
    definitive: { key: 'srv3', origin: 'server', sentiment: 0 },
    local: { key: 'local3', origin: 'local', sentiment: 0.7 },
  },
];

const ENTITIES = [
  { id: 'e-maria', kind: 'person' as const, name: 'Maria', icon: '', updatedAt: '' },
  { id: 'e-praia', kind: 'place' as const, name: 'Praia', icon: '', updatedAt: '' },
  { id: 'e-descanso', kind: 'theme' as const, name: 'descanso', icon: '', updatedAt: '' },
  { id: 'e-trabalho', kind: 'theme' as const, name: 'trabalho', icon: '', updatedAt: '' },
  { id: 'e-voltar', kind: 'decision' as const, name: 'Voltar no verão', icon: '', updatedAt: '' },
];

const LINKS = [
  { entryId: 'srv1', entityId: 'e-maria', count: 2, sentiment: 0.4, relation: 'amiga' },
  { entryId: 'srv1', entityId: 'e-praia', count: 1 },
  { entryId: 'srv1', entityId: 'e-descanso', count: 1 },
  { entryId: 'srv1', entityId: 'e-voltar', count: 1 },
  { entryId: 'local2', entityId: 'e-maria', count: 1 },
  { entryId: 'local2', entityId: 'e-trabalho', count: 1 },
  { entryId: 'apagada', entityId: 'e-maria', count: 1 },
];

const MARIA: GraphEntity = { id: 'e-maria', kind: 'person', name: 'Maria', icon: '', updatedAt: '' };

/** Recorte com `count` notas ligadas a Maria, uma por dia, da mais antiga à nova. */
function snapshotWithNotes(count: number): GraphSnapshot {
  const entries: GraphEntry[] = [];
  const links: EntityLink[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = `n${String(index).padStart(2, '0')}`;
    entries.push({
      id,
      localId: `local-${id}`,
      title: `Nota ${id}`,
      recordedAt: `2026-10-${String(index + 1).padStart(2, '0')}T10:00:00`,
      notebookId: 'nb1',
      hasAnalysis: true,
    });
    links.push({ entryId: id, entityId: 'e-maria', count: 1 });
  }
  return {
    entries,
    entities: [MARIA],
    links,
    centerLabel: 'João',
    ownerName: 'João',
    ownerAliases: [],
    aliases: {},
    allNotesMine: true,
    analyzed: count,
    total: count,
    entryByKey: Object.fromEntries(entries.map((entry) => [entry.id, entry])),
  };
}

describe('loadGraphSnapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRows.mockResolvedValue(ROWS);
    mockEntities.mockResolvedValue(ENTITIES);
    mockLinks.mockResolvedValue(LINKS);
    mockAliases.mockResolvedValue({ 'e-maria': ['Mariana'] });
    mockOwnerAliases.mockResolvedValue(['João']);
    mockOwnerSettings.mockResolvedValue({ ownerName: 'João', allNotesMine: true });
    mockPanelRows.mockResolvedValue({
      local1: {
        id: 'local1',
        text: 'Falei com a Maria na praia.',
        transcriptSegments: [
          { start_ms: 1200, end_ms: 2400, text: 'A Maria chegou cedo.' },
          { start_ms: 2400, end_ms: 3000, text: 'Fomos embora.' },
        ],
        reading: 'Fala sobre a amiga.',
        summary: 'resumo',
      },
    });
    mockSentiments.mockResolvedValue({ srv1: 0.4, local2: -0.2, local3: 0.7 });
  });

  it('usa a chave da analise certa e ignora arquivadas', async () => {
    const snapshot = await loadGraphSnapshot();

    expect(snapshot.entries.map((entry) => entry.id)).toEqual(['local2', 'srv1', 'local3']);
    expect(snapshot.entries[0]).toMatchObject({ localId: 'local2', entryId: undefined });
    expect(snapshot.entries[1]).toMatchObject({
      localId: 'local1',
      entryId: 'srv1',
      hasAnalysis: true,
    });
    // Analise local pendente vence a copia do servidor, como na tela da nota.
    expect(snapshot.entries[2]).toMatchObject({ id: 'local3', hasAnalysis: true });
    expect(snapshot.analyzed).toBe(3);
    expect(snapshot.total).toBe(3);
    expect(snapshot.centerLabel).toBe('João');
    expect(snapshot.ownerAliases).toEqual(['João']);
    expect(snapshot.entries[1].analysis).toBeUndefined();
    expect(snapshot.entries[1].sentiment).toBeUndefined();
    expect(snapshot.links.every((link) => link.entryId !== 'apagada')).toBe(true);
  });

  it('carrega o humor só quando pedido', async () => {
    const snapshot = await loadGraphSnapshot();
    const series = await loadMoodSeries(snapshot.entries);
    expect(mockSentiments).toHaveBeenCalledWith(['local2', 'srv1', 'local3']);
    expect(series.map((point) => point.date)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
    ]);
    expect(series[1].sentiment).toBeCloseTo(0.4);
    expect(series[2].sentiment).toBeCloseTo(-0.2);
  });

  it('recorta por caderno e por periodo', async () => {
    const notebook = await loadGraphSnapshot({ notebookId: 'nb2' });
    expect(notebook.entries.map((entry) => entry.title)).toEqual(['Trabalho']);
    expect(notebook.entities.map((entity) => entity.name)).toEqual(['Maria', 'trabalho']);

    const recent = await loadGraphSnapshot({ from: '2026-10-21' });
    expect(recent.entries.map((entry) => entry.title)).toEqual(['Trabalho']);
  });

  it('monta o grafo e respeita os filtros de tipo', async () => {
    const snapshot = await loadGraphSnapshot();
    const data = graphFromSnapshot(snapshot);
    expect(data.nodes.find((node) => node.label === 'Maria')?.mentions).toBe(3);
    expect(kindCounts(data)).toEqual({ person: 1, place: 1, theme: 2, decision: 1 });

    const places = graphFromSnapshot(snapshot, { kinds: new Set(['place']) });
    expect(places.nodes.map((node) => node.label)).toEqual(['Praia']);
  });

  it('abre o foco com a nota como evidência', async () => {
    const snapshot = await loadGraphSnapshot();
    const data = graphFromSnapshot(snapshot, { focus: 'person:e-maria' });
    expect(data.nodes.filter((node) => node.kind === 'note').map((node) => node.id)).toEqual([
      'note:local2',
      'note:srv1',
    ]);
    expect(noteKeyFromNode('note:srv1')).toBe('srv1');
  });

  it('reaproveita a montagem do grafo para o mesmo recorte e as mesmas opcoes', async () => {
    const snapshot = await loadGraphSnapshot();
    const options = { nodeLimit: 120, edgesPerNode: 6 };
    const first = graphFromSnapshot(snapshot, options);
    const second = graphFromSnapshot(snapshot, options);
    // Mesmo objeto: o mapa e a tela da entidade compartilham a conta.
    expect(second).toBe(first);
    const filtered = graphFromSnapshot(snapshot, { ...options, kinds: new Set(['person']) });
    expect(filtered).not.toBe(first);
    expect(filtered.nodes.map((node) => node.label)).toEqual(['Maria']);
  });

  it('hidrata só as notas da entidade escolhida', async () => {
    const snapshot = await loadGraphSnapshot();
    const page = await loadEntityPanel(snapshot, 'e-maria');
    expect(page.panel?.mentions).toBe(3);
    expect(page.panel?.notes).toBe(2);
    expect(page.hasMore).toBe(false);
    expect(page.panel?.groups.map((group) => group.entryId)).toEqual(['srv1']);
    const srv1 = page.panel?.groups[0];
    expect(srv1?.items.map((item) => item.source)).toEqual(['transcript', 'text']);
    expect(srv1?.items[0].text).toBe('A Maria chegou cedo.');
    expect(srv1?.comment).toBe('Fala sobre a amiga.');
    // Uma chamada só, com as notas da página na ordem (mais recente primeiro).
    expect(mockPanelRows).toHaveBeenCalledTimes(1);
    expect(mockPanelRows).toHaveBeenCalledWith(['local2', 'local1']);
    expect((await loadEntityPanel(snapshot, 'nao-existe')).panel).toBeNull();
  });

  it('pagina por trechos: uma nota com 188 trechos mostra so 15', async () => {
    const snapshot = snapshotWithNotes(1);
    mockPanelRows.mockImplementation(async (ids: string[]) => {
      const rows: Record<string, EntityPanelRow> = {};
      for (const id of ids) {
        rows[id] = {
          id,
          text: Array.from({ length: 188 }, (_, index) => `Maria apareceu ${index}.`).join(' '),
        };
      }
      return rows;
    });

    const page = await loadEntityPanel(snapshot, 'e-maria', { limit: 15 });

    expect(page.panel?.excerpts).toHaveLength(15);
    // O grupo da nota fica pela metade; o resto vem no "Ver mais".
    expect(page.panel?.groups).toHaveLength(1);
    expect(page.panel?.groups[0].items).toHaveLength(15);
    expect(page.hasMore).toBe(true);
    expect(mockPanelRows).toHaveBeenCalledTimes(1);

    const more = await loadEntityPanel(snapshot, 'e-maria', { limit: 45 });
    expect(more.panel?.excerpts).toHaveLength(45);
    expect(more.hasMore).toBe(true);
  });

  it('le as notas em blocos mas mostra so a pagina de trechos', async () => {
    const snapshot = snapshotWithNotes(20);
    mockPanelRows.mockImplementation(async (ids: string[]) => {
      const rows: Record<string, EntityPanelRow> = {};
      for (const id of ids) rows[id] = { id, text: 'Maria apareceu.' };
      return rows;
    });

    const page = await loadEntityPanel(snapshot, 'e-maria', { limit: 15 });

    expect(page.panel?.excerpts).toHaveLength(15);
    expect(page.panel?.groups).toHaveLength(15);
    // Os numeros falam do recorte inteiro, nao da pagina.
    expect(page.panel?.notes).toBe(20);
    expect(page.hasMore).toBe(true);
    // Blocos de 15 notas: 15 + 5 para saber que ainda ha trechos.
    expect(mockPanelRows).toHaveBeenCalledTimes(2);
    expect(mockPanelRows).toHaveBeenNthCalledWith(
      1,
      Array.from({ length: 15 }, (_, index) => `local-n${String(19 - index).padStart(2, '0')}`),
    );
  });

  it('reaproveita o painel da sessão sem ler o banco de novo', async () => {
    const snapshot = snapshotWithNotes(19);
    mockPanelRows.mockImplementation(async (ids: string[]) => {
      const rows: Record<string, EntityPanelRow> = {};
      for (const id of ids) rows[id] = { id, text: 'Maria apareceu.' };
      return rows;
    });

    const first = await loadEntityPanel(snapshot, 'e-maria', { limit: 15 });
    expect(mockPanelRows).toHaveBeenCalledTimes(2);
    mockPanelRows.mockClear();

    const second = await loadEntityPanel(snapshot, 'e-maria', { limit: 15 });

    expect(mockPanelRows).not.toHaveBeenCalled();
    expect(second).toBe(first);
    expect(second.panel?.notes).toBe(19);
    expect(second.hasMore).toBe(true);
  });
});
