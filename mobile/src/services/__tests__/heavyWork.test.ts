import {
  acquireHeavyWork,
  registerEngineReleaser,
  registerTranscriptionPause,
  reserveEngine,
  resetHeavyWorkForTests,
} from '../heavyWork';

beforeEach(() => {
  resetHeavyWorkForTests();
});

describe('fila dos trabalhos pesados', () => {
  it('deixa so uma passada rodar por vez', async () => {
    const first = await acquireHeavyWork('transcription');
    let secondGranted = false;
    const second = acquireHeavyWork('analysis').then((lease) => {
      secondGranted = true;
      return lease;
    });

    await Promise.resolve();
    expect(secondGranted).toBe(false);

    first.release();
    const secondLease = await second;
    expect(secondGranted).toBe(true);
    secondLease.release();
  });

  it('analise fura transcricao que espera e pausa a que esta rodando', async () => {
    let paused = 0;
    registerTranscriptionPause(() => {
      paused += 1;
    });

    const running = await acquireHeavyWork('transcription');
    let queuedGranted = false;
    const queued = acquireHeavyWork('transcription').then((lease) => {
      queuedGranted = true;
      return lease;
    });
    const interactive = acquireHeavyWork('analysis');

    await Promise.resolve();
    expect(paused).toBe(1);

    running.release();
    const interactiveLease = await interactive;
    await Promise.resolve();
    expect(queuedGranted).toBe(false);

    interactiveLease.release();
    const queuedLease = await queued;
    expect(queuedGranted).toBe(true);
    queuedLease.release();
  });

  it('libera o modelo do outro motor antes de carregar o proximo', async () => {
    const releaseLlama = jest.fn(async () => undefined);
    const releaseWhisper = jest.fn(async () => undefined);
    registerEngineReleaser('llama', releaseLlama);
    registerEngineReleaser('whisper', releaseWhisper);

    await reserveEngine('whisper');
    expect(releaseLlama).toHaveBeenCalledTimes(1);
    expect(releaseWhisper).not.toHaveBeenCalled();

    await reserveEngine('llama');
    expect(releaseWhisper).toHaveBeenCalledTimes(1);
  });
});
