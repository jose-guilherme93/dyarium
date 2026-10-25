import { fireEvent, render, screen } from '@testing-library/react-native';

import { AudioWaveform, waveTouchX } from '@/components/AudioWaveform';
import type { TranscriptSegment } from '@/core/types';

const SEGMENTS: TranscriptSegment[] = [
  { start_ms: 0, end_ms: 30_000, text: 'primeira frase' },
  { start_ms: 60_000, end_ms: 90_000, text: 'frase do meio' },
];

const WIDTH = 240;

function place(node: ReturnType<typeof screen.getByLabelText>) {
  fireEvent(node, 'layout', { nativeEvent: { layout: { width: WIDTH, height: 34 } } });
}

describe('waveTouchX', () => {
  it('usa a origem medida quando o evento veio de uma barra filha', () => {
    // locationX viria relativo a uma barra de 4 dp; o pageX e absoluto.
    expect(waveTouchX(160, 3, 100)).toBe(60);
  });

  it('cai no locationX antes de a onda ser medida', () => {
    expect(waveTouchX(160, 60, null)).toBe(60);
  });

  it('devolve null quando o evento nao tem posicao', () => {
    expect(waveTouchX(Number.NaN, Number.NaN, null)).toBeNull();
  });
});

describe('AudioWaveform', () => {
  it('desenha as barras da onda', () => {
    render(<AudioWaveform seed="audio-1" current={0} duration={120} bars={16} onSeek={jest.fn()} />);

    expect(screen.getAllByTestId(/^wave-bar-/)).toHaveLength(16);
  });

  it('mostra a posicao atual e a duracao para a acessibilidade', () => {
    render(<AudioWaveform seed="audio-1" current={65} duration={120} onSeek={jest.fn()} />);

    const wave = screen.getByLabelText('Posição do áudio');
    expect(wave.props.accessibilityValue).toMatchObject({ min: 0, max: 120, now: 65 });
  });

  it('toque numa parte da onda pula para aquele trecho', () => {
    const onSeek = jest.fn();
    render(
      <AudioWaveform seed="audio-1" current={0} duration={120} segments={SEGMENTS} onSeek={onSeek} />,
    );

    const wave = screen.getByLabelText('Posição do áudio');
    place(wave);
    fireEvent(wave, 'responderGrant', { nativeEvent: { locationX: WIDTH / 4 } });
    fireEvent(wave, 'responderRelease', { nativeEvent: { locationX: WIDTH / 4 } });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(30);
  });

  it('acompanha o dedo e so busca ao soltar', () => {
    const onSeek = jest.fn();
    const onScrubChange = jest.fn();
    render(
      <AudioWaveform
        seed="audio-1"
        current={0}
        duration={120}
        onSeek={onSeek}
        onScrubChange={onScrubChange}
      />,
    );

    const wave = screen.getByLabelText('Posição do áudio');
    place(wave);
    fireEvent(wave, 'responderGrant', { nativeEvent: { locationX: WIDTH / 2 } });
    fireEvent(wave, 'responderMove', { nativeEvent: { locationX: WIDTH / 2 } });

    expect(onScrubChange).toHaveBeenCalledWith(60);
    expect(onSeek).not.toHaveBeenCalled();

    fireEvent(wave, 'responderRelease', { nativeEvent: { locationX: WIDTH / 2 } });

    expect(onScrubChange).toHaveBeenLastCalledWith(null);
    expect(onSeek).toHaveBeenCalledWith(60);
  });

  it('TalkBack anda de 10 em 10 segundos pela onda', () => {
    const onSeek = jest.fn();
    render(<AudioWaveform seed="audio-1" current={60} duration={120} onSeek={onSeek} />);

    const wave = screen.getByLabelText('Posição do áudio');
    fireEvent(wave, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onSeek).toHaveBeenCalledWith(70);

    fireEvent(wave, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onSeek).toHaveBeenLastCalledWith(50);
  });

  it('nao busca nada enquanto nao sabe a duracao', () => {
    const onSeek = jest.fn();
    render(<AudioWaveform seed="audio-1" current={0} duration={0} onSeek={onSeek} />);

    const wave = screen.getByLabelText('Posição do áudio');
    place(wave);
    fireEvent(wave, 'responderGrant', { nativeEvent: { locationX: WIDTH / 2 } });
    fireEvent(wave, 'responderRelease', { nativeEvent: { locationX: WIDTH / 2 } });

    expect(onSeek).not.toHaveBeenCalled();
  });
});
