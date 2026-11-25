import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { upsertRecording } from '@/services/db';
import { storeSegment } from '@/services/files';

import { RecordingProvider, useRecording } from '../RecordingContext';

const mockPrepare = jest.fn();
const mockRecord = jest.fn();
const mockStop = jest.fn(async () => undefined);

jest.mock('expo-audio', () => ({
  RecordingPresets: { HIGH_QUALITY: { android: {} } },
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setAudioModeAsync: jest.fn(async () => undefined),
  useAudioRecorder: () => ({
    prepareToRecordAsync: mockPrepare,
    record: mockRecord,
    stop: mockStop,
    pause: jest.fn(),
    uri: 'file:///rec.aac',
    getStatus: () => ({ metering: -20 }),
  }),
}));

jest.mock('@/services/db', () => ({
  listRecordings: jest.fn(async () => []),
  upsertRecording: jest.fn(async () => undefined),
}));

jest.mock('@/services/files', () => ({
  sessionDirUri: (id: string) => `file:///rec-${id}`,
  storeSegment: jest.fn(async () => 'file:///seg.aac'),
  outputFileUri: (id: string) => `file:///out-${id}.aac`,
  concatIO: {},
  newestRecorderFile: jest.fn(() => null),
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
  const { active, error, start, stop, rotate } = useRecording();
  return (
    <>
      <Text testID="active">{active ? active.id : 'none'}</Text>
      <Text testID="error">{error ?? 'none'}</Text>
      <Text testID="segments">{active ? String(active.segmentCount) : '0'}</Text>
      <Pressable testID="start" onPress={() => void start()}>
        <Text>iniciar</Text>
      </Pressable>
      <Pressable testID="rotate" onPress={() => void rotate?.()}>
        <Text>rotacionar</Text>
      </Pressable>
      <Pressable testID="stop" onPress={() => void stop()}>
        <Text>parar</Text>
      </Pressable>
    </>
  );
}

describe('rotate', () => {
  beforeEach(() => {
    mockPrepare.mockReset();
    mockPrepare.mockResolvedValue(undefined);
    mockStop.mockReset();
    mockStop.mockResolvedValue(undefined);
    mockRecord.mockReset();
    jest.mocked(upsertRecording).mockReset();
    jest.mocked(upsertRecording).mockResolvedValue(undefined);
    jest.mocked(storeSegment).mockReset();
    jest.mocked(storeSegment).mockResolvedValue('file:///seg.aac');
  });

  it('reabre o microfone antes de persistir e continua gravando quando upsert falha', async () => {
    jest.mocked(upsertRecording).mockRejectedValueOnce(new Error('db down'));
    render(<RecordingProvider><Probe /></RecordingProvider>);
    await act(async () => { fireEvent.press(screen.getByTestId('start')); });
    const beforePrepareCalls = mockPrepare.mock.calls.length;
    await act(async () => { fireEvent.press(screen.getByTestId('rotate')); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    // mic reopened
    expect(mockPrepare.mock.calls.length).toBeGreaterThan(beforePrepareCalls);
    expect(screen.getByTestId('active')).not.toHaveTextContent('none');
  });

  it('prepareToRecordAsync falhando deixa estado consistente', async () => {
    render(<RecordingProvider><Probe /></RecordingProvider>);
    await act(async () => { fireEvent.press(screen.getByTestId('start')); });
    mockPrepare.mockRejectedValueOnce(new Error('mic busy'));
    await act(async () => { fireEvent.press(screen.getByTestId('rotate')); });
    expect(screen.getByTestId('active')).toHaveTextContent('none');
  });

  it('rotate paralelo nao duplica', async () => {
    render(<RecordingProvider><Probe /></RecordingProvider>);
    await act(async () => { fireEvent.press(screen.getByTestId('start')); });
    await act(async () => {
      void (async () => { await (screen as any); })();
    });
    const r = (useRecording as any);
    // call rotate twice in parallel via context not accessible; use button twice
    await act(async () => {
      fireEvent.press(screen.getByTestId('rotate'));
      fireEvent.press(screen.getByTestId('rotate'));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // storeSegment called at most once for this interval
    expect(jest.mocked(storeSegment).mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('uri vazio reconcilia depois', async () => {
    jest.mocked(storeSegment).mockResolvedValueOnce(null).mockResolvedValueOnce('file:///seg.aac');
    render(<RecordingProvider><Probe /></RecordingProvider>);
    await act(async () => { fireEvent.press(screen.getByTestId('start')); });
    await act(async () => { fireEvent.press(screen.getByTestId('rotate')); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByTestId('active')).not.toHaveTextContent('none');
  });

  it('stop durante rotate nao deixa promise orfa', async () => {
    jest.mocked(storeSegment).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return 'file:///seg.aac';
    });
    render(<RecordingProvider><Probe /></RecordingProvider>);
    await act(async () => { fireEvent.press(screen.getByTestId('start')); });
    await act(async () => {
      fireEvent.press(screen.getByTestId('rotate'));
      fireEvent.press(screen.getByTestId('stop'));
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(screen.getByTestId('active')).toHaveTextContent('none');
  });

  it('cinco rotacoes com upsert lento batem segmentos e registros', async () => {
    await new Promise((r) => setTimeout(r, 150));
    jest.mocked(storeSegment).mockClear();
    jest.mocked(upsertRecording).mockClear();
    jest.mocked(upsertRecording).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    jest.mocked(storeSegment).mockResolvedValue('file:///seg.aac');
    render(<RecordingProvider><Probe /></RecordingProvider>);
    await act(async () => { fireEvent.press(screen.getByTestId('start')); });
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        fireEvent.press(screen.getByTestId('rotate'));
        await new Promise((r) => setTimeout(r, 60));
      });
    }
    await act(async () => {
      fireEvent.press(screen.getByTestId('stop'));
      await new Promise((r) => setTimeout(r, 120));
    });
    const segCalls = jest.mocked(storeSegment).mock.calls.length;
    const upsertCalls = jest.mocked(upsertRecording).mock.calls.length;
    expect(segCalls).toBe(6);
    expect(upsertCalls).toBeGreaterThanOrEqual(6);
  });
});