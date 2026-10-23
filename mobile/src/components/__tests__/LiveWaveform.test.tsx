import { render, screen } from '@testing-library/react-native';

import { LiveWaveform } from '@/components/LiveWaveform';

function barHeight(testID: string): number {
  const styles = screen.getByTestId(testID).props.style;
  const list = Array.isArray(styles) ? styles : [styles];
  const style = list.find((item: unknown) => item && typeof item === 'object' && 'height' in item);
  return Number((style as { height: number }).height);
}

describe('LiveWaveform', () => {
  it('desenha a quantidade de barras pedida', () => {
    render(<LiveWaveform active={false} level={0} bars={8} />);

    expect(screen.getAllByTestId(/wave-bar-/)).toHaveLength(8);
  });

  it('a barra mais nova acompanha o nivel do microfone', () => {
    render(<LiveWaveform active level={0.5} bars={8} height={100} />);

    // A amostra entra na ponta direita; as antigas ficam no minimo.
    expect(barHeight('wave-bar-7')).toBe(50);
    expect(barHeight('wave-bar-0')).toBe(6);
  });

  it('com a gravacao parada, todas as barras ficam no minimo', () => {
    render(<LiveWaveform active={false} level={0.9} bars={8} height={100} />);

    expect(barHeight('wave-bar-7')).toBe(6);
  });

  it('pausada, a onda congela no ponto em que parou', () => {
    const { rerender } = render(
      <LiveWaveform active level={0.5} bars={8} height={100} />,
    );
    expect(barHeight('wave-bar-7')).toBe(50);

    rerender(<LiveWaveform active paused level={0} bars={8} height={100} />);

    expect(barHeight('wave-bar-7')).toBe(50);
  });
});
