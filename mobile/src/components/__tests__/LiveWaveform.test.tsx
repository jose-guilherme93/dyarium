import { render, screen } from '@testing-library/react-native';

import { LiveWaveform } from '@/components/LiveWaveform';

// O reanimated real roda na thread de UI e nao existe no Jest. O fake avalia o
// estilo animado como o faria: e o que permite conferir o que a barra anima.
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (style: () => unknown) => style(),
    useFrameCallback: () => ({ setActive: jest.fn() }),
  };
});

describe('LiveWaveform', () => {
  it('anima a altura das barras por transformacao, e nao por layout', () => {
    render(<LiveWaveform active level={0.5} />);

    // Mudar `height` de 48 barras a cada frame forca layout no Android e
    // derrubava a gravacao para ~38 fps. A animacao tem de ser `scaleY`.
    const bar = screen.getByTestId('wave-bar-0');
    const styles = Array.isArray(bar.props.style) ? bar.props.style : [bar.props.style];
    const animated = styles.find((style) => style && style.transform);
    expect(animated).toBeTruthy();
    expect(styles.some((style) => style && 'height' in style)).toBe(true);
  });

  it('desenha a quantidade de barras pedida', () => {
    render(<LiveWaveform active={false} level={0} bars={8} />);

    expect(screen.getAllByTestId(/wave-bar-/)).toHaveLength(8);
  });
});
