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

let mockParams: { id: string; edit?: string; at?: string } = { id: 'note-1' };

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
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
  getRecording: jest.fn(),
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

const mockGetRecording = jest.fn();

const mockCreateNotebook = jest.fn(async () => ({ id: 'nb-tarefas', name: 'Tarefas e ideias' }));
const mockCreateTextNote = jest.fn(async () => ({ id: 'note-2' }));
const mockSetNoteTags = jest.fn(async () => undefined);
const mockUpdateNote = jest.fn(async () => undefined);
const mockMoveNoteToNotebook = jest.fn(async () => undefined);
const mockKick = jest.fn();

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({
    recordings: [mockNote],
    notebooks: [] as { id: string; name: string }[],
    createNotebook: mockCreateNotebook,
    createTextNote: mockCreateTextNote,
    setNoteTags: mockSetNoteTags,
    updateNote: mockUpdateNote,
    moveNoteToNotebook: mockMoveNoteToNotebook,
    kick: mockKick,
  }),
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
    mockGetRecording.mockResolvedValue(mockNote);
    (jest.requireMock('@/services/db') as { getRecording: typeof mockGetRecording }).getRecording =
      mockGetRecording;
    mockParams = { id: 'note-1' };
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

  it('tocar no texto abre o popup de edicao do trecho', async () => {
    await renderScreen();

    fireEvent.press(screen.getByLabelText(/Trecho de 00:05/));

    expect(screen.getByDisplayValue('hoje e quinta')).toBeTruthy();
    expect(screen.getByLabelText('Salvar trecho')).toBeTruthy();
  });

  it('segurar um trecho cria uma tarefa no caderno Tarefas e ideias', async () => {
    await renderScreen();

    fireEvent(screen.getByLabelText(/Trecho de 00:05/), 'longPress', {
      nativeEvent: { pageX: 80, pageY: 300 },
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Tarefa'));
      await Promise.resolve();
    });

    expect(mockCreateNotebook).toHaveBeenCalledWith({ name: 'Tarefas e ideias' });
    expect(mockCreateTextNote).toHaveBeenCalledWith(
      expect.objectContaining({
        notebookId: 'nb-tarefas',
        text: '“hoje e quinta”\n\n— Nota com audio, 00:05',
      }),
    );
    expect(mockSetNoteTags).toHaveBeenCalledWith('note-2', ['tarefa']);
    const db = jest.requireMock('@/services/db') as { upsertRecording: jest.Mock };
    const stored = db.upsertRecording.mock.calls.at(-1)?.[0];
    expect(stored.transcriptSegments[1].capture).toBe('task');
  });

  it('acumula as capturas na mesma nota, sem criar uma por tarefa', async () => {
    const captureNote = {
      id: 'note-cap',
      title: 'capturas desta nota',
      text: '“trecho antigo”',
      captureSourceId: 'note-1',
      tags: ['ideia'],
      notebookId: 'nb-tarefas',
    };
    const library = jest.requireMock('@/state/LibraryContext') as {
      useLibrary: () => Record<string, unknown>;
    };
    const original = library.useLibrary;
    library.useLibrary = () => ({ ...original(), recordings: [mockNote, captureNote] });
    try {
      await renderScreen();
      fireEvent(screen.getByLabelText(/Trecho de 00:05/), 'longPress', {
        nativeEvent: { pageX: 80, pageY: 300 },
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Tarefa'));
        await Promise.resolve();
      });

      expect(mockCreateTextNote).not.toHaveBeenCalled();
      expect(mockUpdateNote).toHaveBeenCalledWith('note-cap', {
        text: expect.stringContaining('“hoje e quinta”'),
      });
      expect(mockSetNoteTags).toHaveBeenCalledWith('note-cap', ['ideia', 'tarefa']);
    } finally {
      library.useLibrary = original;
    }
  });

  it('traz a nota acumulada de volta para o caderno de capturas', async () => {
    const captureNote = {
      id: 'note-cap',
      title: 'capturas',
      text: '“trecho antigo”',
      captureSourceId: 'note-1',
      tags: ['ideia'],
      notebookId: 'outro-caderno',
    };
    const library = jest.requireMock('@/state/LibraryContext') as {
      useLibrary: () => Record<string, unknown>;
    };
    const original = library.useLibrary;
    library.useLibrary = () => ({ ...original(), recordings: [mockNote, captureNote] });
    try {
      await renderScreen();
      fireEvent(screen.getByLabelText(/Trecho de 00:05/), 'longPress', {
        nativeEvent: { pageX: 80, pageY: 300 },
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Ideia'));
        await Promise.resolve();
      });

      expect(mockMoveNoteToNotebook).toHaveBeenCalledWith('note-cap', 'nb-tarefas');
    } finally {
      library.useLibrary = original;
    }
  });

  it('mostra o icone do tipo ao lado do trecho ja capturado', async () => {
    const captured = {
      ...mockNote,
      transcriptSegments: [
        { start_ms: 0, end_ms: 5_000, text: 'bom dia' },
        { start_ms: 5_000, end_ms: 12_000, text: 'hoje e quinta', capture: 'task' as const },
      ],
    };
    const library = jest.requireMock('@/state/LibraryContext') as {
      useLibrary: () => Record<string, unknown>;
    };
    const original = library.useLibrary;
    library.useLibrary = () => ({ ...original(), recordings: [captured] });
    try {
      await renderScreen();
      expect(screen.getByLabelText('Tarefa')).toBeTruthy();
    } finally {
      library.useLibrary = original;
    }
  });

  it('abre no ponto exato quando vem de uma nota capturada', async () => {
    mockParams = { id: 'note-1', at: '5000' };
    await renderScreen();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockPlayAt).toHaveBeenCalledWith('file:///nota/audio-1.aac', 5);
  });

  it('acende e pulsa a minutagem do trecho que esta tocando', async () => {
    mockStatus = { playing: true, currentTime: 5, duration: 120, isLoaded: true };
    await renderScreen();

    expect(screen.getByText('00:05')).toBeTruthy();
    // 00:00 fica atras do 00:05 na mesma faixa: a ativa e a que pulsa.
    expect(screen.getByText('00:00')).toBeTruthy();
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
      expect(screen.getByText(/Bom dia\./)).toBeTruthy();
      expect(screen.queryByText(/Original do whisper/)).toBeNull();

      fireEvent.press(screen.getByLabelText('Ver o texto antigo do whisper'));
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
