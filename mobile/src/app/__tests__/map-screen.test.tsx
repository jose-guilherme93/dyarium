import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import MapScreen from '../map';

const mockLoadSnapshot = jest.fn();
const mockPanel = jest.fn();

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
    withTiming: (value: unknown) => value,
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
}));

jest.mock('@/services/graphData', () => ({
  loadGraphSnapshot: (filters: unknown) => mockLoadSnapshot(filters),
  graphFromSnapshot: () => ({
    center: { id: 'user', kind: 'user', label: 'João', mentions: 0, notes: 0 },
    nodes: [
      { id: 'person:e1', kind: 'person', label: 'Maria', mentions: 2, notes: 1 },
      { id: 'place:e2', kind: 'place', label: 'Praia', mentions: 1, notes: 1 },
    ],
    edges: [],
    totalNodes: 2,
    totalEdges: 0,
  }),
  kindCounts: () => ({ person: 1, place: 1, theme: 0, decision: 0 }),
  layoutForGraph: async () => ({
    key: 'layout',
    bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
    positions: {
      user: { x: 0, y: 0, r: 30 },
      'person:e1': { x: 60, y: 0, r: 10 },
      'place:e2': { x: -60, y: 0, r: 10 },
    },
  }),
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
  return {
    GraphCanvas: forwardRef(function MockGraphCanvas() {
      return null;
    }),
  };
});

jest.mock('@/components/graph/GraphIcon', () => ({ GraphIcon: () => null }));
jest.mock('@/components/graph/MoodPanel', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return { MoodPanel: () => <Text>Tom médio</Text> };
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
  links: [{ entryId: 'srv1', entityId: 'e1', count: 2 }],
  centerLabel: 'João',
  ownerName: 'João',
  ownerAliases: [],
  aliases: {},
  allNotesMine: true,
  analyzed: 1,
  total: 1,
  entryByKey: {},
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
    mockPanel.mockReturnValue(panel);
  });

  it('abre no repouso com os numeros do recorte', async () => {
    await renderMap();

    expect(screen.getByText('2 entidades · 1 notas')).toBeTruthy();
    expect(screen.getByLabelText('Pessoa: 1')).toBeTruthy();
    expect(screen.getByLabelText('Lugar: 1')).toBeTruthy();
    expect(screen.getByLabelText('Maria, 2 menções')).toBeTruthy();
    expect(screen.getByLabelText('Praia, 1 menções')).toBeTruthy();
  });

  it('abre a bola e mostra os trechos da relação', async () => {
    await renderMap();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Maria, 2 menções'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('A Maria chegou cedo.')).toBeTruthy();
    expect(screen.getByText('0:01')).toBeTruthy();
    expect(screen.getByText('Fala sobre a amiga.')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Sou eu'));
      await Promise.resolve();
    });
    expect(mockClaim).toHaveBeenCalled();
  });

  it('troca para a aba de humor', async () => {
    await renderMap();

    await act(async () => {
      fireEvent.press(screen.getByText('Humor'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('Tom médio')).toBeTruthy();
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
