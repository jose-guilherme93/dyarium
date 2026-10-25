import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { AudioTransport } from '@/components/AudioTransport';
import type { TranscriptSegment } from '@/core/types';

const player = {
  currentTime: 0,
  duration: 120,
  currentStatus: { isLoaded: true },
  playing: true,
  isLoaded: true,
  pause: jest.fn(),
  play: jest.fn(),
  seekTo: jest.fn(async () => undefined),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
};

let mockStatus = { playing: true, currentTime: 0, duration: 120, isLoaded: true };

jest.mock('expo-audio', () => ({
  useAudioPlayerStatus: () => mockStatus,
}));

jest.mock('@/services/audioFocus', () => ({
  requestAudioFocus: jest.fn(),
  releaseAudioFocus: jest.fn(),
}));

const segments: TranscriptSegment[] = [
  { start_ms: 0, end_ms: 30_000, text: 'primeira frase' },
  { start_ms: 60_000, end_ms: 90_000, text: 'frase do meio' },
];

const WIDTH = 240;

describe('AudioTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = { playing: true, currentTime: 0, duration: 120, isLoaded: true };
  });

  it('toque na onda busca aquele ponto do audio', async () => {
    render(<AudioTransport player={player as never} seed="audio-1" durationMs={120_000} />);

    const wave = screen.getByLabelText('Posição do áudio');
    // 3/4 da largura = 90 s de um audio de 2 min.
    fireEvent(wave, 'layout', { nativeEvent: { layout: { width: WIDTH, height: 34 } } });
    await act(async () => {
      fireEvent(wave, 'responderGrant', { nativeEvent: { locationX: (WIDTH * 3) / 4 } });
      fireEvent(wave, 'responderRelease', { nativeEvent: { locationX: (WIDTH * 3) / 4 } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(player.seekTo).toHaveBeenCalledWith(90);
  });

  it('parado, tocar na onda busca o ponto e ja toca', async () => {
    mockStatus = { playing: false, currentTime: 0, duration: 120, isLoaded: true };
    render(<AudioTransport player={player as never} seed="audio-1" durationMs={120_000} />);

    const wave = screen.getByLabelText('Posição do áudio');
    fireEvent(wave, 'layout', { nativeEvent: { layout: { width: WIDTH, height: 34 } } });
    await act(async () => {
      fireEvent(wave, 'responderGrant', { nativeEvent: { locationX: WIDTH / 2 } });
      fireEvent(wave, 'responderRelease', { nativeEvent: { locationX: WIDTH / 2 } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(player.seekTo).toHaveBeenCalledWith(60);
    expect(player.play).toHaveBeenCalled();
  });

  it('toque numa linha da transcricao busca o trecho e toca', async () => {
    render(
      <AudioTransport
        player={player as never}
        seed="audio-1"
        durationMs={120_000}
        segments={segments}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Ouvir a partir de 01:00'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(player.seekTo).toHaveBeenCalledWith(60);
    expect(player.play).toHaveBeenCalled();
  });
});
