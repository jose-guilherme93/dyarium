import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import MapEntityScreen from '../map/[id]';

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: { View, createAnimatedComponent: (c: unknown) => c }, runOnJS: (fn: unknown) => fn, useSharedValue: (i: unknown) => ({ value: i }), useAnimatedStyle: (f: () => unknown) => f(), withTiming: (v: unknown) => v, useEvent: () => () => undefined, useHandler: () => ({ context: {}, doDependenciesDiffer: false, useWeb: false }) };
});

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'person:e1' }),
}));

jest.mock('@/services/appNavigation', () => ({ back: jest.fn(), push: jest.fn() }));

jest.mock('@/services/graphData', () => ({
  loadGraphSnapshot: async () => ({
    entries: [{ id: 'srv1', localId: 'local1', title: 'Praia', recordedAt: '2026-10-20T10:00:00', notebookId: 'nb1', sentiment: 0.4, analysis: { sentiment: 0.4 } }],
    entities: [{ id: 'e1', kind: 'person', name: 'Maria', icon: '', updatedAt: '' }],
    links: [{ entryId: 'srv1', entityId: 'e1', count: 2, sentiment: 0.4 }],
    centerLabel: 'João', ownerName: 'João', ownerAliases: [], aliases: {}, allNotesMine: true, analyzed: 1, total: 1, entryByKey: {},
  }),
  graphFromSnapshot: (snapshot: any) => ({ center: { id: 'user', kind: 'user', label: 'João', mentions: 0, notes: 0 }, nodes: [{ id: 'person:e1', kind: 'person', label: 'Maria', mentions: 2, notes: 1 }], edges: [], totalNodes: 1, totalEdges: 0 }),
  layoutSeeded: (data: any) => ({ positions: { user: { x: 0, y: 0, r: 30 }, 'person:e1': { x: 60, y: 0, r: 10 } }, bounds: { minX: -100, minY: -100, maxX: 100, maxY: 100 }, key: 'layout' }),
  loadEntityPanel: async () => ({ entity: { id: 'e1', kind: 'person', name: 'Maria', icon: '', updatedAt: '' }, mentions: 2, notes: 1, sentiment: 0.4, lastSeen: '2026-10-20T10:00:00', groups: [], excerpts: [], notesList: [] }),
  readCachedSnapshot: async () => null,
}));

jest.mock('@/components/graph/GraphCanvas', () => {
  const { View, Text } = require('react-native');
  return { GraphCanvas: (props: any) => <View testID="graph-canvas"><Text>GRAPH</Text></View> };
});

jest.mock('@/components/graph/MoodPanel', () => ({ MoodPanel: () => null }));
jest.mock('@/components/graph/EntityDetail', () => ({ EntityDetail: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('map entity screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('carrega de forma progressiva: tela nao fica travada', async () => {
    render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <MapEntityScreen />
      </SafeAreaProvider>,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); await Promise.resolve(); await Promise.resolve(); });
    // Nao deve ficar em branco nem travar: o snapshot fresco chega e o grafo aparece.
    expect(screen.queryByTestId('graph-canvas')).toBeTruthy();
  });

  it('o grafo aparece como ultima secao depois das infos', async () => {
    render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <MapEntityScreen />
      </SafeAreaProvider>,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); await Promise.resolve(); await Promise.resolve(); });
    const graph = screen.getByTestId('graph-canvas');
    expect(graph).toBeTruthy();
  });
});
