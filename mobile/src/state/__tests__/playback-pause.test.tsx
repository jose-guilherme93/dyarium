import { act, render } from '@testing-library/react-native';

import { PlaybackProvider, usePauseOnUnmount } from '@/state/PlaybackContext';

const mockPause = jest.fn();
const mockRelease = jest.fn();

jest.mock('expo-audio', () => ({
  createAudioPlayer: () => ({
    pause: (...args: unknown[]) => mockPause(...args),
    release: (...args: unknown[]) => mockRelease(...args),
    replace: jest.fn(),
  }),
}));

function PauseOnUnmount() {
  usePauseOnUnmount();
  return null;
}

describe('pausa do player ao sair da tela', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPause.mockClear();
    mockRelease.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('nao chama a funcao sincrona do expo-audio durante o desmonte', async () => {
    const view = render(
      <PlaybackProvider>
        <PauseOnUnmount />
      </PlaybackProvider>,
    );

    // O desmonte roda no meio do dispatch de eventos do Fabric na thread
    // principal; a chamada sincrona do modulo espera essa thread e trava o app.
    view.unmount();
    expect(mockPause).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(mockPause).toHaveBeenCalledTimes(1);
  });
});
