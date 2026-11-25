import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import MapScreen from '../map';
import { back, push } from '@/services/appNavigation';

const mockLoadSnapshot = jest.fn();
const mockPanel = jest.fn();
const mockGraph = jest.fn();
const mockLayout = jest.fn(async (_data: unknown, _focus?: string) => ({
  key: 'layout',
  bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
  positions: {
    user: { x: 0, y: 0, r: 30 },
    'person:e1': { x: 60, y: 0, r: 10 },
    'place:e2': { x: -60, y: 0, r: 10 },
  },
}));

// O Reanimated real nao inicializa no Jest. A folha do mapa usa so a API
// comum; aqui basta ela responder sem thread de UI.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    runOnJS: (fn: unknown) => fn,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withTiming: (value: unknown, _options?: unknown, callback?: (done: boolean) => void) => {
      // O Reanimated de verdade chama o callback no fim; aqui o fim e agora.
      callback?.(true);
      return value;
    },
    useEvent: () => () => undefined,
    useHandler: () => ({ context: {}, doDependenciesDiffer: false, useWeb: false }),
  };
});

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/services/notebooks', () => ({
  listNotebooks: async () => [],
}));

jest.mock('@/services/appNavigation', () => ({
  back: jest.fn(),
  push: jest.fn(),
}));

jest.mock('@/services/entitySync', () => ({
  syncEntities: jest.fn(async () => undefined),
}));

const mockRename = jest.fn(async () => undefined);
const mockSetIcon = jest.fn(async () => undefined);
const mockClaim = jest.fn(async () => 'João');

jest.mock('@/services/db', () => ({
  ensureEntityDerivation: jest.fn(async () => 0),
  claimLocalSelf: () => mockClaim(),
  renameLocalEntity: () => mockRename(),
  setLocalEntityIcon: () => mockSetIcon(),
  changeEntityKind: jest.fn(async () => ({})),
  setEntityLabel: jest.fn(async () => ({})),
  deleteEntityAndReject: jest.fn(async () => undefined),
  snapshotEntityForUndo: jest.fn(async () => null),
  restoreEntitySnapshot: jest.fn(async () => undefined),
  listEntityRejections: jest.fn(async () => []),
  addEntityRejection: jest.fn(async () => undefined),
  removeEntityRejection: jest.fn(async () => undefined),
}));

jest.mock('@/services/graphData', () => ({
  loadGraphSnapshot: (filters: unknown) => mockLoadSnapshot(filters),
  graphFromSnapshot: (snapshot: unknown, options: unknown) => mockGraph(snapshot, options),
  kindCounts: () => ({ person: 1, place: 1, theme: 0, decision: 0 }),
  layoutForGraph: (data: unknown, focus?: string) => mockLayout(data, focus),
  layoutSeeded: (data: unknown, focus?: string) => mockLayout(data, focus),
  panelForEntity: (snapshot: unknown, id: string) => mockPanel(snapshot, id),
  loadEntityPanel: async (snapshot: unknown, id: string) => mockPanel(snapshot, id),
  loadMoodSeries: async () => [],
  noteKeyFromNode: (id: string) => id,
  readCachedSnapshot: async () => null,
  rememberSnapshot: () => undefined,
}));

jest.mock('@/components/graph/GraphCanvas', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { forwardRef } = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text, View } = require('react-native');
  return {
    GraphCanvas: forwardRef(function MockGraphCanvas({
      data,
      onSelect,
      kinds: mockKinds,
    }: {
      data: { nodes: Array<{ id: string; label: string; kind: string }> };
      kinds?: Set<string>;
      onSelect: (id: string) => void;
    }) {
      return (
        <View>
          {data.nodes
            .filter(
              (node) =>
                node.kind !== 'user' &&
                node.kind !== 'note' &&
                (!mockKinds || mockKinds.has(node.kind)),
            )
            .map((node) => (
              <Pressable
                key={node.id}
                accessibilityLabel={`Abrir ${node.label}`}
                onPress={() => onSelect(node.id)}
              >
                <Text>{node.label}</Text>
              </Pressable>
            ))}
        </View>
      );
    }),
  };
});

jest.mock('@/components/graph/GraphIcon', () => ({ GraphIcon: () => null }));
jest.mock('@/components/graph/MoodPanel', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    MoodPanel: ({ series, subject }: { series: unknown[]; subject?: string | null }) => (
      <Text>
        {subject ? `Tom sobre ${subject}` : 'Tom médio'} ({series.length})
      </Text>
    ),
  };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const snapshot = {
  entries: [
    {
      id: 'srv1',
      localId: 'local1',
      title: 'Praia',
      recordedAt: '2026-10-20T10:00:00',
      notebookId: 'nb1',
      sentiment: 0.4,
      analysis: { sentiment: 0.4 },
    },
  ],
  entities: [
    { id: 'e1', kind: 'person', name: 'Maria', icon: '', updatedAt: '' },
    { id: 'e2', kind: 'place', name: 'Praia', icon: '', updatedAt: '' },
  ],
  links: [
    { entryId: 'srv1', entityId: 'e1', count: 2, sentiment: 0.4 },
    { entryId: 'srv1', entityId: 'e2', count: 3, sentiment: -0.2 },
  ],
  centerLabel: 'João',
  ownerName: 'João',
  ownerAliases: [],
  aliases: {},
  allNotesMine: true,
  analyzed: 1,
  total: 1,
  entryByKey: {},
};

const graph = {
  center: { id: 'user', kind: 'user', label: 'João', mentions: 0, notes: 0 },
  nodes: [
    { id: 'person:e1', kind: 'person', label: 'Maria', mentions: 2, notes: 1 },
    { id: 'place:e2', kind: 'place', label: 'Praia', mentions: 3, notes: 1 },
  ],
  edges: [],
  totalNodes: 2,
  totalEdges: 0,
};

const panel = {
  entity: { id: 'e1', kind: 'person', name: 'Maria', icon: '', updatedAt: '' },
  mentions: 2,
  notes: 1,
  sentiment: 0.4,
  lastSeen: '2026-10-20T10:00:00',
  groups: [
    {
      entryId: 'srv1',
      title: 'Praia',
      date: '2026-10-20T10:00:00',
      comment: 'Fala sobre a amiga.',
      items: [
        {
          entryId: 'srv1',
          title: 'Praia',
          date: '2026-10-20T10:00:00',
          source: 'transcript',
          text: 'A Maria chegou cedo.',
          term: 'Maria',
          startMs: 1200,
          comment: 'Fala sobre a amiga.',
        },
      ],
    },
  ],
  excerpts: [],
  notesList: [{ entryId: 'srv1', title: 'Praia', date: '2026-10-20T10:00:00', count: 2 }],
};

async function renderMap() {
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <MapScreen />
    </SafeAreaProvider>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
  });
}

describe('tela do mapa', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadSnapshot.mockResolvedValue(snapshot);
    mockGraph.mockReturnValue(graph);
    mockPanel.mockReturnValue(panel);
  });

  it('abre no repouso com os numeros do recorte', async () => {
    await renderMap();

    expect(screen.getByLabelText('Pessoa: 1')).toBeTruthy();
    expect(screen.getByLabelText('Lugar: 1')).toBeTruthy();
  });

  it('abre a entidade em tela propria', async () => {
    await renderMap();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Abrir Maria'));
      await Promise.resolve();
    });

    expect(push).toHaveBeenCalledWith('/map/person:e1');
  });

  it('esconder um tipo e so desenho: nao refaz o grafo nem o layout', async () => {
    await renderMap();
    const grafoAntes = mockGraph.mock.calls.length;
    const layoutAntes = mockLayout.mock.calls.length;

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Lugar: 1'));
      await Promise.resolve();
    });

    // O mesmo conjunto: quem some e so o desenho das bolas de lugar.
    expect(mockGraph.mock.calls.length).toBe(grafoAntes);
    expect(mockLayout.mock.calls.length).toBe(layoutAntes);
    expect(screen.queryByLabelText('Abrir Praia')).toBeNull();
    expect(screen.getByLabelText('Abrir Maria')).toBeTruthy();
  });

  it('aba Humor mostra o painel de tom', async () => {
    await renderMap();

    fireEvent.press(screen.getByText('Humor'));

    expect(screen.getByTestId('map-mood-panel')).toBeTruthy();
  });

  it('o Voltar do cabeçalho volta para a tela anterior', async () => {
    await renderMap();

    fireEvent.press(screen.getByLabelText('Voltar'));

    expect(back).toHaveBeenCalled();
  });

  it('abre os filtros por período', async () => {
    await renderMap();

    fireEvent.press(screen.getByLabelText('Filtros do mapa'));
    expect(screen.getByText('Período')).toBeTruthy();
    fireEvent.press(screen.getByText('30d'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
    // O recorte novo chega na leitura, mesmo quando o cache pintou na hora.
    expect(mockLoadSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
    );
  });
});
