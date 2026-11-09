import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import MapEntityScreen from '../map/[id]';

type PanelPage = { panel: unknown; hasMore: boolean };

/** Promessa que o teste resolve quando quiser, para medir a ordem das camadas. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await Promise.resolve();
    await Promise.resolve();
  });
}

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: { View, createAnimatedComponent: (c: unknown) => c }, runOnJS: (fn: unknown) => fn, useSharedValue: (i: unknown) => ({ value: i }), useAnimatedStyle: (f: () => unknown) => f(), withTiming: (v: unknown) => v, useEvent: () => () => undefined, useHandler: () => ({ context: {}, doDependenciesDiffer: false, useWeb: false }) };
});

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'person:e1' }),
}));

jest.mock('@/services/appNavigation', () => ({ back: jest.fn(), push: jest.fn() }));

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({ recordings: [] }),
}));

const SNAPSHOT = {
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
  entities: [{ id: 'e1', kind: 'person', name: 'Maria', icon: '', updatedAt: '' }],
  links: [{ entryId: 'srv1', entityId: 'e1', count: 2, sentiment: 0.4 }],
  centerLabel: 'João',
  ownerName: 'João',
  ownerAliases: [],
  aliases: {},
  allNotesMine: true,
  analyzed: 1,
  total: 1,
  entryByKey: {},
};

const PANEL = {
  entity: { id: 'e1', kind: 'person', name: 'Maria', icon: '', updatedAt: '' },
  mentions: 2,
  notes: 1,
  sentiment: 0.4,
  lastSeen: '2026-10-20T10:00:00',
  groups: [],
  excerpts: [],
  notesList: [],
};

const mockLoadGraphSnapshot = jest.fn();
const mockLoadEntityPanel = jest.fn();
const mockReadSessionSnapshot = jest.fn();

jest.mock('@/services/graphData', () => ({
  ENTITY_PANEL_PAGE: 15,
  ENTITY_PANEL_MORE: 30,
  loadGraphSnapshot: (...args: unknown[]) => mockLoadGraphSnapshot(...args),
  graphFromSnapshot: () => ({
    center: { id: 'user', kind: 'user', label: 'João', mentions: 0, notes: 0 },
    nodes: [{ id: 'person:e1', kind: 'person', label: 'Maria', mentions: 2, notes: 1 }],
    edges: [],
    totalNodes: 1,
    totalEdges: 0,
  }),
  layoutSeeded: () => ({
    positions: { user: { x: 0, y: 0, r: 30 }, 'person:e1': { x: 60, y: 0, r: 10 } },
    bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 },
    key: 'layout',
  }),
  loadEntityPanel: (...args: unknown[]) => mockLoadEntityPanel(...args),
  readSessionSnapshot: (...args: unknown[]) => mockReadSessionSnapshot(...args),
}));

jest.mock('@/components/graph/GraphCanvas', () => {
  const { View, Text } = require('react-native');
  return { GraphCanvas: (props: any) => <View testID="graph-canvas"><Text>GRAPH</Text></View> };
});

jest.mock('@/components/graph/MoodPanel', () => {
  const { View, Text } = require('react-native');
  return { MoodPanel: () => <View testID="mood-panel"><Text>MOOD</Text></View> };
});

jest.mock('@/components/graph/EntityDetail', () => {
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    EntityDetail: (props: any) => (
      <View testID="entity-detail">
        <Text>DETAIL</Text>
        {props.hasMore ? (
          <TouchableOpacity testID="ver-mais" onPress={props.onLoadMore}>
            <Text>Ver mais</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    ),
  };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function mount() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <MapEntityScreen />
    </SafeAreaProvider>,
  );
}

describe('map entity screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadGraphSnapshot.mockResolvedValue(SNAPSHOT);
    mockLoadEntityPanel.mockResolvedValue({ panel: PANEL, hasMore: false });
    mockReadSessionSnapshot.mockReturnValue(null);
  });

  it('mostra esqueleto enquanto o recorte nao chega', async () => {
    const snapshot = deferred<typeof SNAPSHOT>();
    mockLoadGraphSnapshot.mockReturnValue(snapshot.promise);
    mount();
    await flush();

    // Humor, referencias e grafo ainda nao existem: o lugar deles esta reservado.
    expect(screen.queryByTestId('mood-panel')).toBeNull();
    expect(screen.queryByTestId('entity-detail')).toBeNull();
    expect(screen.queryByTestId('graph-canvas')).toBeNull();
    expect(screen.getAllByLabelText('Carregando').length).toBeGreaterThanOrEqual(2);

    snapshot.resolve(SNAPSHOT);
    await flush();
    expect(screen.getByTestId('mood-panel')).toBeTruthy();
  });

  it('carrega humor, depois referencias e so entao o grafo', async () => {
    const panel = deferred<PanelPage>();
    mockLoadEntityPanel.mockReturnValue(panel.promise);
    mount();
    await flush();

    // Camada 1 ja apareceu; a 2 esta no esqueleto e a 3 ainda nao existe.
    expect(screen.getByTestId('mood-panel')).toBeTruthy();
    expect(screen.queryByTestId('entity-detail')).toBeNull();
    expect(screen.queryByTestId('graph-canvas')).toBeNull();

    panel.resolve({ panel: PANEL, hasMore: false });
    await flush();

    // A 2 assenta e so entao a 3 entra.
    expect(screen.getByTestId('entity-detail')).toBeTruthy();
    expect(screen.getByTestId('graph-canvas')).toBeTruthy();
    expect(mockLoadEntityPanel).toHaveBeenCalledWith(SNAPSHOT, 'e1', { limit: 15 });
  });

  it('reaproveita o recorte que o mapa ja leu, sem reler a biblioteca', async () => {
    mockReadSessionSnapshot.mockReturnValue(SNAPSHOT);
    mount();
    await flush();

    expect(mockLoadGraphSnapshot).not.toHaveBeenCalled();
    expect(screen.getByTestId('graph-canvas')).toBeTruthy();
  });

  it('pede so 15 referencias e carrega mais no "Ver mais"', async () => {
    mockLoadEntityPanel.mockResolvedValue({ panel: PANEL, hasMore: true });
    mount();
    await flush();

    expect(screen.getByTestId('ver-mais')).toBeTruthy();
    fireEvent.press(screen.getByTestId('ver-mais'));
    await flush();

    expect(mockLoadEntityPanel).toHaveBeenCalledTimes(2);
    // Primeira pagina de 15, "Ver mais" traz mais 30.
    expect(mockLoadEntityPanel).toHaveBeenLastCalledWith(SNAPSHOT, 'e1', { limit: 45 });
  });
});
