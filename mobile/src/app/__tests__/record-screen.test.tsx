import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import type { Recording } from '@/core/types';
import { setPendingInsert, takePendingInsert } from '@/services/noteInsert';

import RecordScreen from '../record';

const mockRecording: Recording = {
  id: 'rec-1',
  title: 'Nota de hoje',
  recordedAt: '2026-10-01T10:00:00.000Z',
  dir: 'file:///rec-dir',
  filePath: 'file:///rec-dir/recording.aac',
  segmentCount: 1,
  durationMs: 5000,
  sizeBytes: 1000,
  status: 'recorded',
  offset: 0,
  attempts: 0,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
};

const mockStop = jest.fn<Promise<Recording | null>, [{ enqueue?: boolean }?]>();
const mockStart = jest.fn(async () => undefined);
const mockAttachAudio = jest.fn<
  Promise<boolean>,
  [string, Recording, { nodeId: string; offset: number } | null | undefined]
>();
const mockEnqueue = jest.fn<Promise<void>, [Recording]>();
const mockDeleteRow = jest.fn<Promise<void>, [string]>();
const mockMoveAudio = jest.fn<Promise<string | null>, [string, string, string?]>();
const mockSubmitNote = jest.fn<Promise<void>, [string]>();
const mockRefresh = jest.fn(async () => undefined);
// Mensagem que o contexto de gravacao mostraria na tela.
let mockError: string | null = null;
let mockParams: { noteId?: string; from?: string; atNodeId?: string; atOffset?: string } = {
  noteId: 'note-1',
  from: 'home',
};

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

jest.mock('@/components/LiveWaveform', () => ({
  LiveWaveform: () => null,
}));

jest.mock('@/state/RecordingContext', () => ({
  useRecording: () => ({
    active: mockRecording,
    error: mockError,
    busy: false,
    paused: false,
    pause: jest.fn(),
    unpause: jest.fn(),
    start: mockStart,
    stop: mockStop,
  }),
  useRecordingLive: () => ({ elapsedMs: 5000, level: 0.5 }),
}));

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({
    attachAudio: mockAttachAudio,
    enqueue: mockEnqueue,
    refresh: mockRefresh,
    submitNote: mockSubmitNote,
  }),
}));

jest.mock('@/services/db', () => ({
  deleteRecordingRow: (...args: [string]) => mockDeleteRow(...args),
}));

jest.mock('@/services/files', () => ({
  audioFileName: (id: string) => `audio-${id}.aac`,
  moveAudio: (...args: [string, string, string?]) => mockMoveAudio(...args),
  sessionDirUri: () => 'file:///note-dir',
  deleteSessionFiles: jest.fn(),
}));

async function pressCancel() {
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Cancelar'));
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}

async function pressStop() {
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Parar gravação'));
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}

describe('tela de gravacao', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockError = null;
    mockParams = { noteId: 'note-1', from: 'home' };
    mockStop.mockResolvedValue(mockRecording);
    mockAttachAudio.mockResolvedValue(true);
    mockMoveAudio.mockResolvedValue('file:///note-dir/audio-rec-1.aac');
  });

  it('anexa o audio na nota e abre a nota', async () => {
    render(<RecordScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    await pressStop();

    expect(mockMoveAudio).toHaveBeenCalledWith('rec-1', 'note-1', 'audio-rec-1.aac');
    expect(mockAttachAudio).toHaveBeenCalledWith(
      'note-1',
      expect.objectContaining({
        id: 'rec-1',
        dir: 'file:///note-dir',
        filePath: 'file:///note-dir/audio-rec-1.aac',
      }),
      null,
    );
    expect(mockDeleteRow).toHaveBeenCalledWith('rec-1');
    expect(mockSubmitNote).toHaveBeenCalledWith('note-1');
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/note/[id]',
      params: { id: 'note-1' },
    });
  });

  it('anexa o audio na posicao do cursor informada pela nota', async () => {
    mockParams = { noteId: 'note-1', from: 'note' };
    setPendingInsert('note-1', { nodeId: 't2', offset: 7 });

    render(<RecordScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    await pressStop();

    expect(mockAttachAudio).toHaveBeenCalledWith(
      'note-1',
      expect.anything(),
      { nodeId: 't2', offset: 7 },
    );
  });

  it('descarta a posicao guardada quando a gravacao e cancelada', async () => {
    mockParams = { noteId: 'note-1', from: 'note' };
    setPendingInsert('note-1', { nodeId: 't2', offset: 7 });

    render(<RecordScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    await pressCancel();

    // A proxima gravacao da nota nao pode herdar a posicao antiga.
    expect(takePendingInsert('note-1')).toBeNull();
  });

  it('nao apaga a gravacao quando a nota de destino sumiu', async () => {
    mockAttachAudio.mockResolvedValue(false);

    render(<RecordScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    await pressStop();

    expect(mockDeleteRow).not.toHaveBeenCalled();
    expect(mockSubmitNote).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ id: 'rec-1' }));
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/note/[id]',
      params: { id: 'rec-1' },
    });
  });

  it('mantem a tela e o aviso quando nada foi capturado', async () => {
    mockStop.mockResolvedValue(null);
    mockError = 'Nenhum áudio foi capturado. Verifique o microfone e tente de novo.';

    render(<RecordScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    await pressStop();

    expect(screen.getByText('Nenhum áudio foi capturado. Verifique o microfone e tente de novo.')).toBeTruthy();
    expect(mockDeleteRow).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
