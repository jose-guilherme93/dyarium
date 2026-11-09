/**
 * O mapa desenha bolas, linhas e nomes no mesmo canvas do Skia.
 *
 * Nao e detalhe de implementacao. Quando cada nome virava uma view animada, um
 * arrasto atualizava dezenas de views por quadro e o mapa caia para 14 fps com
 * a tela parada. Este teste guarda o desenho no lugar: nomes sao texto do
 * canvas, e o Skia recebe a camera como numeros.
 */

import { createRef } from 'react';
import { act, render, screen, within } from '@testing-library/react-native';
import { View } from 'react-native';

import type { GraphLayout } from '@/core/graphLayout';
import type { EntityKind, GraphData } from '@/core/graphModel';
import { GRAPH_PALETTES } from '@/theme/graph';

import { GraphCanvas, type GraphCanvasHandle } from '../GraphCanvas';

// O Reanimated real nao inicializa no Jest. O mock devolve valores comuns e
// chama o worklet na hora; aqui interessa a estrutura do desenho.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    Easing: { out: (fn: unknown) => fn, cubic: (value: number) => value },
    runOnJS: (fn: unknown) => fn,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useDerivedValue: (factory: () => unknown) => ({ value: factory() }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useFrameCallback: () => ({ setActive: jest.fn(), isActive: false, callbackId: 0 }),
    withTiming: (value: unknown) => value,
    withDelay: (_delay: number, value: unknown) => value,
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
      'onFinalize',
      'onBegin',
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

// Skia nao inicializa no Jest; o mock devolve views comuns. O texto tem que sair
// de dentro do canvas mockado, e nao de uma view irma.
jest.mock('@shopify/react-native-skia', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: NativeText, View } = require('react-native');
  const fakePath = { fake: true };
  const fakeBuilder = {
    reset: () => fakeBuilder,
    addCircle: () => fakeBuilder,
    moveTo: () => fakeBuilder,
    lineTo: () => fakeBuilder,
    detach: () => fakePath,
    build: () => fakePath,
  };
  const Skia = {
    Path: { Make: () => fakePath, MakeFromSVGString: () => null },
    PathBuilder: { Make: () => fakeBuilder },
  };
  const font = {
    measureText: (text: string) => ({ width: text.length * 5, height: 10 }),
    getMetrics: () => ({ ascent: -8, descent: 2 }),
  };
  return {
    __esModule: true,
    Canvas: ({ children }: { children: unknown }) => (
      <View testID="graph-canvas">{children}</View>
    ),
    Circle: View,
    DashPathEffect: View,
    Group: View,
    Path: View,
    Points: View,
    RoundedRect: View,
    Skia,
    Text: ({ text }: { text: string }) => <NativeText>{text}</NativeText>,
    matchFont: () => font,
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

function desenha(
  ref?: React.Ref<GraphCanvasHandle>,
  props: Partial<React.ComponentProps<typeof GraphCanvas>> = {},
) {
  return render(
    <GraphCanvas
      ref={ref}
      data={data}
      layout={layout}
      colors={GRAPH_PALETTES.amoled}
      width={360}
      height={640}
      viewportTop={0}
      viewportBottom={320}
      selectedId={null}
      kinds={new Set<EntityKind>(['person', 'place', 'theme', 'decision'])}
      onSelect={() => undefined}
      {...props}
    />,
  );
}

describe('desenho do mapa', () => {
  it('so mostra os nomes ao aproximar, e no mesmo canvas das bolas', () => {
    // No encaixe o mapa e so bolas e ligacoes, como o "text fade threshold" do
    // Obsidian; o nome entra quando o usuario aproxima. A lista de nomes e
    // recalculada uma vez, depois da rajada de zoom (debounce de 120 ms).
    jest.useFakeTimers();
    const ref = createRef<GraphCanvasHandle>();
    desenha(ref);
    const canvas = screen.getByTestId('graph-canvas');
    expect(within(canvas).queryByText('Maria')).toBeNull();

    act(() => {
      ref.current?.zoomIn();
      jest.advanceTimersByTime(200);
    });

    expect(within(canvas).getByText('Maria')).toBeTruthy();
    expect(within(canvas).getByText('Praia')).toBeTruthy();
    expect(within(canvas).getByText('Você')).toBeTruthy();
    jest.useRealTimers();
  });

  it('na previa estatica, nomeia so as relacoes do no aberto', () => {
    // A tela da entidade abre o grafo sem gesto; o nome das relacoes e a
    // informacao, entao ele nasce junto com o desenho. O resto do mapa ali e
    // so contexto e nao ganha nome.
    desenha(undefined, { interactive: false, showLabels: true, selectedId: 'person:e1' });
    const canvas = screen.getByTestId('graph-canvas');
    expect(within(canvas).getByText('Maria')).toBeTruthy();
    expect(within(canvas).queryByText('Praia')).toBeNull();
    expect(within(canvas).queryByText('Você')).toBeNull();
  });

  it('passa a camera ao Skia como numero, nunca como objeto de shared value', () => {
    desenha();

    // O Skia nativo recebe o transform por JSI e responde "Value is an object,
    // expected a number" se um shared value for mandado solto dentro do array.
    // A camera tem que chegar como array de numeros (direto ou via derived).
    const comTransform = screen.UNSAFE_getAllByType(View).filter(
      (node) => node.props.transform !== undefined,
    );
    expect(comTransform.length).toBeGreaterThan(0);

    for (const node of comTransform) {
      const transform = node.props.transform;
      const passos = Array.isArray(transform) ? transform : transform.value;
      expect(Array.isArray(passos)).toBe(true);
      for (const passo of passos) {
        for (const valor of Object.values(passo as Record<string, unknown>)) {
          expect(typeof valor).toBe('number');
        }
      }
    }
  });

  it('nao anima opacidade (camada por quadro derruba o desenho)', () => {
    // Um <Group opacity={sharedValue}> vira saveLayer a cada quadro e foi o que
    // levou o mapa a 15 fps. Opacidade tem que ser numero estatico.
    desenha();
    for (const node of screen.UNSAFE_getAllByType(View)) {
      if (node.props.opacity === undefined) continue;
      expect(typeof node.props.opacity).toBe('number');
    }
  });
});
