import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { Recording } from '@/core/types';
import TranscriptScreen from '@/app/transcript/[id]';

const mockPlayAt = jest.fn();
const mockPlayer = {
  currentTime: 0,
  duration: 0,
  playing: false,
  pause: jest.fn(),
};

let mockStatus = { playing: false, currentTime: 0, duration: 0, isLoaded: true };

jest.mock('expo-audio', () => ({
  useAudioPlayerStatus: () => mockStatus,
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'note-1' }),
}));

jest.mock('@/services/appNavigation', () => ({
  back: jest.fn(),
}));

jest.mock('@/services/attachments', () => ({
  resolveAudioSource: jest.fn(async () => 'file:///nota/audio-1.aac'),
}));

jest.mock('@/services/audioFocus', () => ({
  releaseAudioFocus: jest.fn(),
}));

jest.mock('@/services/db', () => ({
  getRecording: jest.fn(async () => null),
  upsertRecording: jest.fn(async () => undefined),
}));

jest.mock('@/services/secure', () => ({
  loadServerConfig: jest.fn(async () => null),
}));

jest.mock('@/services/transcriptSync', () => ({
  pushTranscript: jest.fn(async () => undefined),
}));

jest.mock('@/services/uploaderLoop', () => ({
  emitRecording: jest.fn(),
}));

const mockNote: Recording = {
  id: 'note-1',
  title: 'Nota com audio',
  text: '',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  recordedAt: '2026-10-01T10:00:00.000Z',
  dir: 'file:///nota',
  filePath: 'file:///nota/audio-1.aac',
  durationMs: 120_000,
  segmentCount: 1,
  offset: 0,
  attempts: 0,
  status: 'completed',
  source: 'microphone',
  tags: [],
  notebookId: 'notas-ao-acaso',
  transcript: 'bom dia hoje e quinta',
  transcriptStatus: 'ready',
  transcriptSegments: [
    { start_ms: 0, end_ms: 5_000, text: 'bom dia' },
    { start_ms: 5_000, end_ms: 12_000, text: 'hoje e quinta' },
  ],
};

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({ recordings: [mockNote] }),
}));

jest.mock('@/state/PlaybackContext', () => ({
  usePlayback: () => mockPlayer,
  usePlayAt: () => mockPlayAt,
}));

jest.mock('@/state/useTranscriptionProgress', () => ({
  useTranscriptionProgress: () => 0,
}));

jest.mock('@/state/SettingsContext', () => ({
  useSettings: () => ({
    reviewTranscript: false,
    literalTranscript: false,
    setLiteralTranscript: jest.fn(async () => undefined),
  }),
}));

describe('tela da transcricao', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = { playing: false, currentTime: 0, duration: 120, isLoaded: true };
  });

  const renderScreen = async () => {
    const view = render(<TranscriptScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    return view;
  };

  it('tocar na minutagem leva o audio para aquele trecho', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Ouvir a partir de 00:05'));
      await Promise.resolve();
    });

    expect(mockPlayAt).toHaveBeenCalledWith('file:///nota/audio-1.aac', 5);
  });

  it('tocar no texto do trecho tambem busca aquele ponto, sem reiniciar', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByText('hoje e quinta'));
      await Promise.resolve();
    });

    expect(mockPlayAt).toHaveBeenCalledWith('file:///nota/audio-1.aac', 5);
  });

  it('mostra a onda do audio da nota', async () => {
    await renderScreen();

    expect(screen.getByLabelText('Posição do áudio')).toBeTruthy();
  });

  it('mostra o texto revisado e revela o original do whisper', async () => {
    const revised = {
      ...mockNote,
      transcriptSegments: [
        { start_ms: 0, end_ms: 5_000, text: 'bom dia', revised: 'Bom dia.' },
        { start_ms: 5_000, end_ms: 12_000, text: 'hoje e quinta' },
      ],
    };
    const library = jest.requireMock('@/state/LibraryContext') as {
      useLibrary: () => { recordings: unknown[] };
    };
    const original = library.useLibrary;
    library.useLibrary = () => ({ recordings: [revised] });
    try {
      await renderScreen();
      expect(screen.getByText('Bom dia.')).toBeTruthy();
      expect(screen.queryByText(/Original do whisper/)).toBeNull();

      fireEvent.press(screen.getByLabelText('Ver o texto original do whisper'));
      expect(screen.getByText(/Original do whisper: bom dia/)).toBeTruthy();
    } finally {
      library.useLibrary = original;
    }
  });

  it('tocar no play aponta a fonte e toca do ponto atual', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Tocar'));
      await Promise.resolve();
    });

    expect(mockPlayAt).toHaveBeenCalledWith('file:///nota/audio-1.aac', 0);
  });
});
