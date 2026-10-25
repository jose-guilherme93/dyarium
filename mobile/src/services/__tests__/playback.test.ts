import type { AudioPlayer } from 'expo-audio';

import { seekPlayer, startPlayer } from '@/services/playback';

jest.mock('@/services/audioFocus', () => ({
  requestAudioFocus: jest.fn(),
}));

function fakePlayer(overrides: Partial<Record<string, unknown>> = {}) {
  const player = {
    currentTime: 0,
    duration: 120,
    // Fonte pronta: o seek nao espera.
    currentStatus: { isLoaded: true },
    play: jest.fn(),
    seekTo: jest.fn(async () => undefined),
    ...overrides,
  };
  return player;
}

describe('seekPlayer', () => {
  it('pula direto para o trecho pedido', async () => {
    const player = fakePlayer();

    await seekPlayer(player as never as AudioPlayer, 42);

    expect(player.seekTo).toHaveBeenCalledWith(42);
  });

  it('espera a fonte nova carregar antes de buscar', async () => {
    // O ADTS so tem seek map depois de preparado; buscar antes disso fazia a
    // posicao voltar a 0 quando a fonte terminava de abrir.
    const player = fakePlayer({ currentStatus: { isLoaded: false } });

    const pending = seekPlayer(player as never as AudioPlayer, 42);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(player.seekTo).not.toHaveBeenCalled();

    player.currentStatus = { isLoaded: true };
    await pending;
    expect(player.seekTo).toHaveBeenCalledWith(42);
  });

  it('pedir o inicio nao espera a fonte (o play ja comeca ao abrir)', async () => {
    const player = fakePlayer({ currentStatus: { isLoaded: false } });

    await seekPlayer(player as never as AudioPlayer, 0, { autoplay: true });

    expect(player.seekTo).toHaveBeenCalledWith(0);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('toca ao chegar quando pedido', async () => {
    const player = fakePlayer();

    await seekPlayer(player as never as AudioPlayer, 10, { autoplay: true });

    expect(player.seekTo).toHaveBeenCalledWith(10);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('nao toca quando so o seek foi pedido', async () => {
    const player = fakePlayer();

    await seekPlayer(player as never as AudioPlayer, 10);

    expect(player.play).not.toHaveBeenCalled();
  });

  it('ignora uma posicao invalida em vez de voltar ao comeco', async () => {
    const player = fakePlayer();

    await seekPlayer(player as never as AudioPlayer, Number.NaN);

    expect(player.seekTo).not.toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
  });

  it('limita uma posicao negativa a zero', async () => {
    const player = fakePlayer();

    await seekPlayer(player as never as AudioPlayer, -3);

    expect(player.seekTo).toHaveBeenCalledWith(0);
  });
});

describe('startPlayer', () => {
  it('toca sem mexer na posicao', () => {
    const player = fakePlayer({ currentTime: 42 });

    startPlayer(player as never as AudioPlayer);

    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.seekTo).not.toHaveBeenCalled();
  });
});
