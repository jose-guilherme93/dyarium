import type { AudioPlayer } from 'expo-audio';

import { seekPlayer, startPlayer } from '@/services/playback';

jest.mock('@/services/audioFocus', () => ({
  requestAudioFocus: jest.fn(),
}));

function fakePlayer(overrides: Partial<Record<string, unknown>> = {}) {
  const player = {
    currentTime: 0,
    duration: 120,
    isLoaded: true,
    // Fonte pronta: o seek nao espera.
    currentStatus: { isLoaded: true },
    play: jest.fn(),
    seekTo: jest.fn(async (seconds: number) => {
      player.currentTime = seconds;
    }),
    ...overrides,
  };
  return player;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  it('depois de trocar a fonte, espera o estado vivo, nao o status em cache', async () => {
    // `currentStatus` ainda e o retrato da fonte anterior (isLoaded true); o
    // player vivo diz que a nova ainda esta abrindo. Buscar agora perdia o
    // seek quando o ADTS terminava de preparar.
    const player = fakePlayer({ currentStatus: { isLoaded: true }, isLoaded: false });

    const pending = seekPlayer(player as never as AudioPlayer, 42, { freshSource: true });
    await sleep(60);
    expect(player.seekTo).not.toHaveBeenCalled();

    player.isLoaded = true;
    await pending;

    expect(player.seekTo).toHaveBeenCalledWith(42);
  });

  it('repete o seek quando a fonte prepara e joga a posicao de volta ao zero', async () => {
    // O primeiro seek e descartado quando o ADTS termina de abrir (posicao
    // volta a 0). Sem a segunda tentativa a minutagem "reiniciava" o audio.
    let calls = 0;
    const player = fakePlayer({
      seekTo: jest.fn(async (seconds: number) => {
        calls += 1;
        player.currentTime = seconds;
        if (calls === 1) {
          setTimeout(() => {
            player.currentTime = 0;
          }, 80);
        }
      }),
    });

    await seekPlayer(player as never as AudioPlayer, 42, { freshSource: true });

    expect(player.seekTo).toHaveBeenCalledTimes(2);
    expect(player.currentTime).toBe(42);
  });

  it('nao repete o seek quando a posicao ficou onde foi pedida', async () => {
    const player = fakePlayer();

    await seekPlayer(player as never as AudioPlayer, 42, { freshSource: true });

    expect(player.seekTo).toHaveBeenCalledTimes(1);
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
