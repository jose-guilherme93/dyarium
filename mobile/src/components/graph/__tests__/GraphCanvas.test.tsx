/**
 * O mapa desenha bolas e linhas em SVG, mas o nome de cada bola e texto de
 * tela: uma view comum, fora do desenho.
 *
 * Nao e detalhe de implementacao. O `react-native-svg` joga fora o bitmap da
 * cena inteira a cada prop que muda; quando os nomes eram nos de SVG, cada
 * quadro de arrasto custava um redesenho de tela cheia por nome. Este teste
 * guarda o desenho de volta no lugar: nomes como texto, cena como desenho.
 */

import { render, screen } from '@testing-library/react-native';

import type { GraphLayout } from '@/core/graphLayout';
import type { GraphData } from '@/core/graphModel';
import { GRAPH_PALETTES } from '@/theme/graph';

import { GraphCanvas } from '../GraphCanvas';

// O Reanimated real nao inicializa no Jest. O mock devolve valores comuns e
// chama o worklet na hora; aqui interessa a estrutura do desenho.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    runOnJS: (fn: unknown) => fn,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useFrameCallback: () => ({ setActive: jest.fn(), isActive: false, callbackId: 0 }),
  };
});

// O detector de gestos depende do `useEvent` do Reanimated; aqui o gesto nao
// importa, so o desenho.
jest.mock('react-native-gesture-handler', () => {
  const gesto = () => {
    const builder: Record<string, unknown> = {};
    for (const name of [
      'maxPointers',
      'minDistance',
      'maxDistance',
      'maxDuration',
      'onStart',
      'onUpdate',
      'onEnd',
    ]) {
      builder[name] = () => builder;
    }
    return builder;
  };
  return {
    GestureDetector: ({ children }: { children: unknown }) => children,
    Gesture: {
      Pan: gesto,
      Pinch: gesto,
      Tap: gesto,
      Simultaneous: (first: unknown) => first,
      Exclusive: (first: unknown) => first,
    },
  };
});

jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View, Text } = require('react-native');
  return {
    __esModule: true,
    default: View,
    Circle: View,
    Path: View,
    // Marca qualquer texto que volte a ser desenhado dentro do SVG.
    Text: (props: { children?: unknown }) => <Text testID="svg-text">{props.children}</Text>,
  };
});

const data: GraphData = {
  center: { id: 'user', kind: 'user', label: 'Você', mentions: 0, notes: 0 },
  nodes: [
    { id: 'person:e1', kind: 'person', label: 'Maria', mentions: 3, notes: 1 },
    { id: 'place:e2', kind: 'place', label: 'Praia', mentions: 2, notes: 1 },
  ],
  edges: [
    { source: 'user', target: 'person:e1', kind: 'relation', weight: 3 },
    { source: 'user', target: 'place:e2', kind: 'relation', weight: 2 },
  ],
  totalNodes: 3,
  totalEdges: 2,
};

const layout: GraphLayout = {
  key: 'teste',
  bounds: { minX: -120, minY: -120, maxX: 120, maxY: 120 },
  positions: {
    user: { x: 0, y: 0, r: 26 },
    'person:e1': { x: 70, y: 0, r: 12 },
    'place:e2': { x: -70, y: 0, r: 12 },
  },
};

function desenha() {
  return render(
    <GraphCanvas
      data={data}
      layout={layout}
      colors={GRAPH_PALETTES.amoled}
      width={360}
      height={640}
      viewportTop={0}
      viewportBottom={320}
      selectedId={null}
      onSelect={() => undefined}
    />,
  );
}

describe('desenho do mapa', () => {
  it('mostra o nome das bolas como texto de tela', () => {
    desenha();

    expect(screen.getByText('Maria')).toBeTruthy();
    expect(screen.getByText('Praia')).toBeTruthy();
    expect(screen.getByText('Você')).toBeTruthy();
  });

  it('nao desenha nome dentro do SVG', () => {
    desenha();

    // Cada nome e uma view de texto; nenhum deles e um no de SVG.
    expect(screen.queryByTestId('svg-text')).toBeNull();
  });
});
