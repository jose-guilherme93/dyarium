import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';

import { PlaybackProvider, usePlayAt } from '@/state/PlaybackContext';

const mockPlayer = {
  currentTime: 0,
  duration: 120,
  currentStatus: { isLoaded: true },
  replace: jest.fn(),
  seekTo: jest.fn(async () => undefined),
  play: jest.fn(),
  pause: jest.fn(),
};

jest.mock('expo-audio', () => ({
  createAudioPlayer: () => mockPlayer,
}));

jest.mock('@/services/audioFocus', () => ({
  requestAudioFocus: jest.fn(),
  releaseAudioFocus: jest.fn(),
}));

type PlayAt = (uri: string, seconds: number) => void;

/** Guarda o `playAt` de dentro do provider para o teste chamar. */
const sink: { current: PlayAt | null } = { current: null };

function Probe() {
  const playAt = usePlayAt();
  useEffect(() => {
    sink.current = playAt;
  }, [playAt]);
  return null;
}

async function play(uri: string, seconds: number) {
  await act(async () => {
    sink.current?.(uri, seconds);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('playAt do player unico', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayer.currentTime = 0;
    mockPlayer.duration = 120;
    render(
      <PlaybackProvider>
        <Probe />
      </PlaybackProvider>,
    );
  });

  it('toca um audio novo a partir do trecho pedido', async () => {
    await play('file:///a.aac', 12);

    expect(mockPlayer.replace).toHaveBeenCalledWith('file:///a.aac');
    expect(mockPlayer.seekTo).toHaveBeenCalledWith(12);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });

  it('no mesmo audio, so pula: nao recarrega a fonte (o audio nao reinicia)', async () => {
    await play('file:///a.aac', 12);
    mockPlayer.replace.mockClear();
    mockPlayer.seekTo.mockClear();
    mockPlayer.play.mockClear();

    await play('file:///a.aac', 40);

    expect(mockPlayer.replace).not.toHaveBeenCalled();
    expect(mockPlayer.seekTo).toHaveBeenCalledWith(40);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });

  it('nao reinicia quando o audio tinha acabado e um trecho e pedido', async () => {
    await play('file:///a.aac', 12);
    // Player parado no fim: `playPlayer` reiniciaria por causa da posicao velha.
    mockPlayer.currentTime = 120;
    mockPlayer.seekTo.mockClear();
    mockPlayer.play.mockClear();

    await play('file:///a.aac', 40);

    expect(mockPlayer.seekTo).toHaveBeenCalledTimes(1);
    expect(mockPlayer.seekTo).toHaveBeenCalledWith(40);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });

  it('troca a fonte uma vez so quando o audio realmente muda', async () => {
    await play('file:///a.aac', 12);
    await play('file:///b.aac', 40);
    await play('file:///b.aac', 80);

    expect(mockPlayer.replace).toHaveBeenCalledTimes(2);
    expect(mockPlayer.replace).toHaveBeenNthCalledWith(1, 'file:///a.aac');
    expect(mockPlayer.replace).toHaveBeenNthCalledWith(2, 'file:///b.aac');
    expect(mockPlayer.seekTo).toHaveBeenLastCalledWith(80);
    expect(mockPlayer.play).toHaveBeenCalledTimes(3);
  });

  it('um trecho invalido nao vira seek negativo', async () => {
    await play('file:///a.aac', -5);

    expect(mockPlayer.seekTo).toHaveBeenCalledWith(0);
  });
});
