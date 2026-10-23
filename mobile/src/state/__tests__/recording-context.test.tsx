import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { upsertRecording } from '@/services/db';

import { RecordingProvider, useRecording } from '../RecordingContext';

/**
 * O microfone pode falhar no preparo (ocupado por outro app, por exemplo).
 * Nesse caso a sessao nao pode ficar presa: o proximo toque em gravar tem de
 * tentar de novo.
 */

const mockPrepare = jest.fn();

jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: { android: {} } },
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setAudioModeAsync: jest.fn(async () => undefined),
  useAudioRecorder: () => ({
    prepareToRecordAsync: mockPrepare,
    record: jest.fn(),
    stop: jest.fn(async () => undefined),
    pause: jest.fn(),
    uri: 'file:///rec.aac',
  }),
  useAudioRecorderState: () => ({ metering: -20 }),
}));

jest.mock('@/services/db', () => ({
  listRecordings: jest.fn(async () => []),
  upsertRecording: jest.fn(async () => undefined),
}));

jest.mock('@/services/files', () => ({
  sessionDirUri: (id: string) => `file:///rec-${id}`,
  storeSegment: jest.fn(async () => null),
  outputFileUri: (id: string) => `file:///out-${id}.aac`,
  concatIO: {},
}));

jest.mock('@/services/notifications', () => ({
  ensureNotificationPermission: jest.fn(async () => true),
  notificationPermissionGranted: jest.fn(async () => true),
}));

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({
    refresh: jest.fn(async () => undefined),
    enqueue: jest.fn(async () => undefined),
  }),
}));

jest.mock('@/core/concat', () => ({
  concatenateSegments: jest.fn(async () => 0),
}));

jest.mock('@/dev/perf', () => ({
  bumpRender: jest.fn(),
  mark: jest.fn(),
}));

function Probe() {
  const { active, error, start } = useRecording();
  return (
    <>
      <Text testID="active">{active ? active.id : 'none'}</Text>
      <Text testID="error">{error ?? 'none'}</Text>
      <Pressable testID="start" onPress={() => void start()}>
        <Text>iniciar</Text>
      </Pressable>
    </>
  );
}

describe('RecordingProvider', () => {
  beforeEach(() => {
    mockPrepare.mockReset();
    mockPrepare.mockResolvedValue(undefined);
    jest.mocked(upsertRecording).mockReset();
    jest.mocked(upsertRecording).mockResolvedValue(undefined);
  });

  it('mostra a sessao ativa antes de esperar a escrita no banco', async () => {
    let release: () => void = () => undefined;
    jest.mocked(upsertRecording).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    render(
      <RecordingProvider>
        <Probe />
      </RecordingProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('start'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // O microfone ja esta gravando e a tela ja tem cronometro/waveform; o
    // registro da sessao entra logo atras.
    expect(screen.getByTestId('active')).not.toHaveTextContent('none');
    expect(screen.getByTestId('error')).toHaveTextContent('none');

    await act(async () => {
      release();
      await Promise.resolve();
    });
  });

  it('libera uma nova tentativa quando o preparo do microfone falha', async () => {
    mockPrepare.mockRejectedValueOnce(new Error('microfone ocupado'));

    render(
      <RecordingProvider>
        <Probe />
      </RecordingProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('start'));
    });

    // A sessao nao pode ficar ativa: o aparelho nao esta gravando.
    expect(screen.getByTestId('active')).toHaveTextContent('none');
    expect(screen.getByTestId('error')).toHaveTextContent(
      'Não foi possível iniciar a gravação.',
    );

    // A segunda tentativa tem de chegar ao preparo de novo.
    mockPrepare.mockResolvedValueOnce(undefined);
    await act(async () => {
      fireEvent.press(screen.getByTestId('start'));
    });

    expect(mockPrepare).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('active')).not.toHaveTextContent('none');
  });
});
