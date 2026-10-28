import { act, render, screen } from '@testing-library/react-native';

import { LiveWaveform } from '@/components/LiveWaveform';
import { MIN_BAR, SAMPLE_MS } from '@/components/liveWaveAnimation';

// O Reanimated real nao inicializa no Jest. O mock devolve valores comuns e
// chama o worklet na hora; o que importa aqui e a estrutura, a cadencia da
// amostragem e o desenho, nao o quadro.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedProps: (factory: () => unknown) => factory(),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useFrameCallback: () => ({ setActive: jest.fn(), isActive: false, callbackId: 0 }),
  };
});

jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { __esModule: true, default: View, Path: View };
});

function pathD(): string {
  return String(screen.getByTestId('wave-path').props.animatedProps?.d ?? '');
}

describe('LiveWaveform', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('desenha uma barra a mais que a area (a que entra pela direita)', () => {
    render(<LiveWaveform active={false} bars={8} />);

    expect(pathD().match(/M/g)).toHaveLength(9);
  });

  it('comeca com todas as barras no traco minimo', () => {
    render(<LiveWaveform active={false} bars={8} height={100} />);

    // Sem largura medida, todas as barras caem em x = 0; altura = MIN_LEVEL.
    expect(pathD()).toContain('48.7V51.4');
    expect(MIN_BAR).toBeGreaterThanOrEqual(2);
  });

  it('amostra o microfone no ritmo da onda enquanto grava', () => {
    const sampleMetering = jest.fn(() => -20);
    render(<LiveWaveform active sampleMetering={sampleMetering} bars={8} />);

    act(() => {
      jest.advanceTimersByTime(SAMPLE_MS * 3);
    });

    expect(sampleMetering.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('nao amostra com a gravacao parada ou pausada', () => {
    const sampleMetering = jest.fn(() => -20);
    const { rerender } = render(
      <LiveWaveform active={false} sampleMetering={sampleMetering} bars={8} />,
    );

    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(sampleMetering).not.toHaveBeenCalled();

    rerender(<LiveWaveform active paused sampleMetering={sampleMetering} bars={8} />);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(sampleMetering).not.toHaveBeenCalled();
  });
});
