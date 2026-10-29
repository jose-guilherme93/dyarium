import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, InteractionManager } from 'react-native';

import type { Recording } from '@/core/types';

import { takePendingInsert } from '@/services/noteInsert';

import NoteScreen from '../[id]';
import { resetNavigationGuard } from '@/services/appNavigation';

const mockUpdateNote = jest.fn(async () => undefined);
const mockSubmitNote = jest.fn(async () => undefined);
const mockRefresh = jest.fn(async () => undefined);
const mockKick = jest.fn();
const mockArchiveNote = jest.fn(async () => undefined);
const mockUnarchiveNote = jest.fn(async () => undefined);
const mockPickImage = jest.fn();
const mockSaveLocalImage = jest.fn();
const mockLocalImageUri = jest.fn();
const mockFormat = jest.fn();
const mockBlur = jest.fn();
const mockInsertAudio = jest.fn();
const mockInsertImage = jest.fn();
let mockInsertPosition: { nodeId: string; offset: number } | null = null;

const mockNote: Recording = {
  id: 'note-1',
  title: 'Minha nota',
  text: 'primeira linha',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  recordedAt: '2026-10-01T10:00:00.000Z',
  dir: 'file:///nota',
  segmentCount: 0,
  offset: 0,
  attempts: 0,
  status: 'completed',
  source: 'text',
  tags: [],
  notebookId: 'notas-ao-acaso',
};

let mockFocusListener: (() => void) | null = null;
let mockBlurListener: (() => void) | null = null;

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ id: 'note-1' }),
  useNavigation: () => ({
    addListener: (event: string, listener: () => void) => {
      if (event === 'focus') mockFocusListener = listener;
      if (event === 'blur') mockBlurListener = listener;
      return jest.fn();
    },
    dispatch: jest.fn(),
  }),
}));

// O corpo nativo e testado com um TextInput que faz o mesmo papel (entrega
// markdown, foco e as acoes imperativas do editor).
jest.mock('@/components/NoteBody', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text, TextInput } = require('react-native');
  return {
    NoteBody: React.forwardRef(function MockEditor(props: any, ref: any) {
      const current = React.useRef(props.value);
      React.useImperativeHandle(ref, () => ({
        focus: jest.fn(),
        blur: mockBlur,
        format: (...args: unknown[]) => mockFormat(...args),
        insertImage: (display: string, persist: string, alt: string, ...rest: unknown[]) => {
          mockInsertImage(display, persist, alt, ...rest);
          current.current = `${current.current}\n![${alt}](${persist})`;
          props.onChangeMarkdown(current.current);
        },
        removeImage: jest.fn(),
        insertAudio: (...args: unknown[]) => mockInsertAudio(...args),
        getInsertPosition: () => mockInsertPosition,
        insertLink: jest.fn(),
        flush: jest.fn(async () => undefined),
      }));
      const onLaidOut = props.onLaidOut;
      React.useEffect(() => {
        const timer = setTimeout(() => onLaidOut?.(), 0);
        return () => clearTimeout(timer);
      }, [onLaidOut]);
      const transcript = Object.values(props.audioTranscripts ?? {}).join('\n');
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(TextInput, {
          testID: 'note-body',
          defaultValue: props.value,
          placeholder: props.placeholder,
          onChangeText: (text: string) => {
            current.current = text;
            props.onChangeMarkdown(text);
          },
          onFocus: () => props.onEditingChange?.(true),
          onBlur: () => props.onEditingChange?.(false),
        }),
        transcript ? React.createElement(Text, { testID: 'audio-transcript' }, transcript) : null,
      );
    }),
  };
});

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({
    recordings: [mockNote],
    notebooks: [
      {
        id: 'notas-ao-acaso',
        name: 'Notas ao acaso',
        color: '',
        isDefault: true,
        createdAt: mockNote.createdAt,
        updatedAt: mockNote.updatedAt,
        dirty: false,
        synced: true,
      },
    ],
    updateNote: mockUpdateNote,
    submitNote: mockSubmitNote,
    refresh: mockRefresh,
    kick: mockKick,
    setNoteTags: jest.fn(),
    moveNoteToNotebook: jest.fn(),
    retry: jest.fn(),
    archiveNote: mockArchiveNote,
    unarchiveNote: mockUnarchiveNote,
  }),
}));

let mockTypography: {
  family: 'system' | 'serif' | 'mono';
  size: number;
  weight: 'light' | 'regular' | 'bold';
} = { family: 'system', size: 17, weight: 'regular' };

jest.mock('@/state/SettingsContext', () => ({
  useSettings: () => ({
    typography: mockTypography,
    setTypography: jest.fn(async () => undefined),
    analysisModel: 'modelo-local',
    setAnalysisModel: jest.fn(async () => undefined),
    analysisLowPower: false,
    setAnalysisLowPower: jest.fn(async () => undefined),
    transcriptionEnabled: false,
    setTranscriptionEnabled: jest.fn(async () => undefined),
    analysisEnabled: false,
    setAnalysisEnabled: jest.fn(async () => undefined),
    serverProcessing: false,
    setServerProcessing: jest.fn(async () => undefined),
    config: null,
    transcriptionModel: 'base',
    ready: true,
  }),
}));

const mockPlayer = {
  pause: jest.fn(),
  play: jest.fn(),
  seekTo: jest.fn(async () => undefined),
  replace: jest.fn(),
  currentTime: 0,
  duration: 0,
  addListener: jest.fn(() => () => undefined),
  release: jest.fn(),
};

jest.mock('@/state/PlaybackContext', () => ({
  usePlayback: () => mockPlayer,
  usePlayAt: () => jest.fn(),
  usePauseOnUnmount: () => undefined,
}));

jest.mock('@/state/RecordingContext', () => ({
  useRecording: () => ({
    start: jest.fn(async () => undefined),
  }),
}));

let mockStackAudios: {
  id: string;
  content_type: string;
  size_bytes: number;
  duration_seconds: number;
  created_at: string;
  transcript?: { text?: string };
}[] = [];

jest.mock('@/state/useAudioStack', () => ({
  useAudioStack: () => ({ audios: mockStackAudios, refresh: jest.fn(async () => undefined) }),
}));

jest.mock('@/state/useTranscriptionProgress', () => ({
  useTranscriptionProgress: () => 0,
  useTranscriptionRunning: () => false,
}));

jest.mock('@/core/features', () => ({
  localAnalysisEnabled: () => false,
}));

jest.mock('@/services/attachments', () => ({
  attachmentUri: jest.fn(async () => null),
  downloadMissingImageSources: jest.fn(async () => undefined),
  localImageUri: (...args: unknown[]) => mockLocalImageUri(...args),
  resolveImageSourcesLocal: () => ({}),
  saveLocalImage: (...args: unknown[]) => mockSaveLocalImage(...args),
}));

jest.mock('@/services/analysis', () => ({
  fetchNoteAnalysis: jest.fn(async () => null),
  hasServerConfig: jest.fn(async () => false),
  pushNoteAnalysis: jest.fn(async () => true),
  requestServerAnalysis: jest.fn(async () => ({ status: 'analyzing' })),
}));

jest.mock('@/services/analysisModels', () => ({
  installedAnalysisModels: () => [],
  isAnalysisModelInstalled: () => false,
}));

jest.mock('@/services/audioFocus', () => ({
  releaseAudioFocus: jest.fn(),
}));

const mockGetRecording = jest.fn<Promise<Recording | null>, [string]>(async () => mockNote);

jest.mock('@/services/db', () => ({
  getCachedAnalysis: jest.fn(async () => null),
  getAppFlag: jest.fn(async () => '1'),
  setAppFlag: jest.fn(async () => undefined),
  getRecording: (...args: [string]) => mockGetRecording(...args),
  moveCachedAnalysis: jest.fn(async () => undefined),
  saveAnalysisRuns: jest.fn(async () => undefined),
  saveCachedAnalyses: jest.fn(async () => undefined),
  upsertRecording: jest.fn(async () => undefined),
}));

jest.mock('@/services/files', () => ({
  directoryBytes: () => 0,
  sessionDirectory: () => ({ uri: 'file:///nota' }),
  sessionDirUri: () => 'file:///nota',
}));

jest.mock('@/services/image', () => ({
  pickImage: (...args: unknown[]) => mockPickImage(...args),
}));

jest.mock('@/services/imageRatios', () => ({
  cachedImageRatio: () => undefined,
  measureImageRatio: () => Promise.resolve(4 / 3),
  rememberImageRatio: jest.fn(),
}));

jest.mock('@/services/localAnalysis', () => ({
  analyzeNote: jest.fn(),
  analysisThreads: () => 2,
  localAnalysisAvailable: () => false,
  stopAnalysis: jest.fn(),
}));

jest.mock('@/services/localTranscription', () => ({
  isTranscribing: () => false,
  maybeTranscribeLocally: jest.fn(async () => undefined),
  stopTranscription: jest.fn(async () => undefined),
}));

jest.mock('@/services/whisper', () => ({
  transcriptionPlace: jest.fn(async () => ({ place: 'disabled', runsOnDevice: false, needsModel: false })),
}));


jest.mock('@/services/noteVisibility', () => ({
  enterNote: jest.fn(),
  leaveNote: jest.fn(),
}));

jest.mock('@/services/noteSync', () => ({
  fetchTheirs: jest.fn(async () => null),
  syncNoteForcing: jest.fn(async () => undefined),
}));

jest.mock('@/services/transcriptSync', () => ({
  pushTranscript: jest.fn(async () => undefined),
}));

jest.mock('@/services/playback', () => ({
  playPlayer: jest.fn(),
}));

// Reanimated/worklets nao inicializa no Jest; a previa nao e o foco do teste.
jest.mock('@/components/SyncedTranscript', () => ({
  SyncedTranscript: () => null,
}));

jest.mock('expo-audio', () => ({
  useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0 }),
}));

jest.mock('expo-battery', () => ({
  getBatteryLevelAsync: jest.fn(async () => 1),
}));

jest.mock('expo-clipboard', () => ({
  getStringAsync: jest.fn(async () => ''),
}));


describe('tela da nota', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllTimers();
    resetNavigationGuard();
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(((task: () => void) => {
      task();
      return { cancel: jest.fn() };
    }) as never);
    mockInsertPosition = null;
    mockFocusListener = null;
    mockBlurListener = null;
    mockStackAudios = [];
    mockTypography = { family: 'system', size: 17, weight: 'regular' };
    mockGetRecording.mockResolvedValue(mockNote);
    mockLocalImageUri.mockReturnValue('file:///nota/img-1.jpg');
    mockSaveLocalImage.mockImplementation(
      async (_noteId: string, _bytes: Uint8Array, _mime: string, name?: string) =>
        name ?? 'img-1.jpg',
    );
    mockPickImage.mockImplementation(async (onPreview?: (preview: unknown) => void) => {
      const preview = {
        uri: 'file:///seletor/foto-original.jpg',
        name: 'foto.jpg',
        mimeType: 'image/jpeg',
        width: 1200,
        height: 800,
        localName: 'img-1.jpg',
      };
      onPreview?.(preview);
      return {
        name: 'foto.jpg',
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([1, 2, 3]),
        width: 1200,
        height: 800,
        localName: 'img-1.jpg',
      };
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const renderNote = async () => {
    const view = render(<NoteScreen />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      // A midia entra depois do primeiro frame; os timers apenas liberam a
      // fase de anexos/pilha/segmentos.
      jest.advanceTimersByTime(200);
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });
    return view;
  };

  it('monta o editor rico formatado no primeiro frame, sem carregamento na frente', () => {
    render(<NoteScreen />);

    // Cabecalho, titulo e editor rico aparecem de imediato: a nota nunca troca
    // de aparencia por causa de carregamento.
    expect(screen.getByPlaceholderText('título da nota')).toBeTruthy();
    expect(screen.getByLabelText('Configurações da nota')).toBeTruthy();
    expect(screen.getByTestId('note-body')).toBeTruthy();
    expect(screen.queryByTestId('note-body-hydrating')).toBeNull();
    expect(screen.queryByTestId('note-body-preview')).toBeNull();

    // O corpo ja vem com o texto da nota (o markdown vira o formato do editor).
    expect(screen.getByDisplayValue('primeira linha')).toBeTruthy();
  });

  it('marca a captura como feita pelo check ao lado da data', async () => {
    const library = jest.requireMock('@/state/LibraryContext') as {
      useLibrary: () => Record<string, unknown>;
    };
    const original = library.useLibrary;
    const capture = { ...mockNote, notebookId: 'tarefas' };
    library.useLibrary = () => ({
      ...original(),
      recordings: [capture],
      notebooks: [
        {
          id: 'tarefas',
          name: 'Tarefas e ideias',
          color: '',
          isDefault: false,
          createdAt: capture.createdAt,
          updatedAt: capture.updatedAt,
          dirty: false,
          synced: true,
        },
      ],
    });
    try {
      await renderNote();
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Concluir captura'));
        await Promise.resolve();
      });
      expect(mockArchiveNote).toHaveBeenCalledWith('note-1');
    } finally {
      library.useLibrary = original;
    }
  });

  it('nao mostra o check em nota de outro caderno', async () => {
    await renderNote();
    expect(screen.queryByLabelText('Concluir captura')).toBeNull();
    expect(screen.queryByLabelText('Reabrir captura')).toBeNull();
  });

  it('aplica a tipografia no titulo sem remontar a nota', async () => {
    const view = await renderNote();
    const title = screen.getByPlaceholderText('título da nota');
    expect(title.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ fontFamily: 'Inter_400Regular' })]),
    );

    mockTypography = { family: 'serif', size: 21, weight: 'bold' };
    await act(async () => {
      view.rerender(<NoteScreen />);
    });

    // A fonte escolhida no menu e a mesma do corpo; trocar de fonte nao pode
    // remontar a nota nem quebrar o layout.
    expect(screen.getByPlaceholderText('título da nota').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ fontFamily: 'serif' })]),
    );
    expect(screen.getByTestId('note-body')).toBeTruthy();
  });

  it('fecha o teclado antes de sair da nota', async () => {
    await renderNote();

    fireEvent.press(screen.getByLabelText('Voltar'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockBlur).toHaveBeenCalled();
    expect(router.back).toHaveBeenCalled();
  });

  it('aplica formatacao pela barra mesmo sem o teclado aberto', async () => {
    await renderNote();

    fireEvent.press(screen.getByLabelText('Negrito'));
    fireEvent.press(screen.getByLabelText('Tachado'));
    fireEvent.press(screen.getByLabelText('Lista numerada'));

    expect(mockFormat).toHaveBeenCalledWith('bold');
    expect(mockFormat).toHaveBeenCalledWith('strike');
    expect(mockFormat).toHaveBeenCalledWith('ordered');
  });

  it('abre em leitura, edita texto, insere foto e salva ao sair', async () => {    await renderNote();

    expect(screen.getByDisplayValue('primeira linha')).toBeTruthy();

    const input = screen.getByTestId('note-body');
    fireEvent(input, 'focus');
    fireEvent.changeText(input, 'texto novo');

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(mockUpdateNote).toHaveBeenCalledWith(
      'note-1',
      expect.objectContaining({ text: 'texto novo' }),
    );

    fireEvent.press(screen.getByLabelText('Adicionar foto'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(mockSaveLocalImage).toHaveBeenCalled();
    expect(mockUpdateNote).toHaveBeenLastCalledWith(
      'note-1',
      expect.objectContaining({ text: expect.stringContaining('local:img-1.jpg') }),
    );

    fireEvent.press(screen.getByLabelText('Voltar'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(router.back).toHaveBeenCalled();
  });

  it('mostra a foto borrada antes de terminar de preparar o arquivo', async () => {
    let finish: ((value: unknown) => void) | null = null;
    mockPickImage.mockImplementation((onPreview?: (preview: unknown) => void) => {
      const preview = {
        uri: 'file:///seletor/foto-original.jpg',
        name: 'foto.jpg',
        mimeType: 'image/jpeg',
        width: 1200,
        height: 800,
        localName: 'img-pendente.jpg',
      };
      onPreview?.(preview);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });

    const view = await renderNote();
    fireEvent.press(screen.getByLabelText('Adicionar foto'));

    // Antes de recompressao/gravacao, o no ja entrou com a foto do seletor.
    expect(mockInsertImage).toHaveBeenCalledWith(
      'file:///seletor/foto-original.jpg',
      'local:img-pendente.jpg',
      'foto.jpg',
      expect.any(Number),
      1200,
      800,
    );
    expect(mockSaveLocalImage).not.toHaveBeenCalled();

    await act(async () => {
      finish?.({
        name: 'foto.jpg',
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([1]),
        width: 1200,
        height: 800,
        localName: 'img-pendente.jpg',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSaveLocalImage).toHaveBeenCalledWith(
      'note-1',
      expect.any(Uint8Array),
      'image/jpeg',
      'img-pendente.jpg',
    );

    // Fecha a tela e descarrega o autosave pendente da foto antes do proximo
    // teste: um timer antigo nao pode gravar na nota seguinte.
    view.unmount();
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
  });

  it('abrir uma nota antiga com audio nao a marca como editada', async () => {
    mockNote.filePath = 'file:///audio.aac';

    try {
      const view = await renderNote();
      await act(async () => {
        jest.advanceTimersByTime(2000);
        await Promise.resolve();
      });

      // O audio virou um no do documento so para exibir; nada mudou de fato.
      expect(mockUpdateNote).not.toHaveBeenCalled();

      view.unmount();
      await act(async () => {
        jest.advanceTimersByTime(50);
        await Promise.resolve();
      });

      expect(mockUpdateNote).not.toHaveBeenCalled();
      expect(mockSubmitNote).not.toHaveBeenCalled();
    } finally {
      delete mockNote.filePath;
    }
  });

  it('mantem o audio do corpo visivel enquanto o teclado esta aberto', async () => {
    mockNote.filePath = 'file:///audio.aac';

    try {
      await renderNote();

      // O audio antigo vira um no do documento na abertura.
      expect(screen.getByDisplayValue('primeira linha\n!audio[local:audio.aac]')).toBeTruthy();

      fireEvent(screen.getByTestId('note-body'), 'focus');

      expect(screen.getByDisplayValue('primeira linha\n!audio[local:audio.aac]')).toBeTruthy();
    } finally {
      delete mockNote.filePath;
    }
  });

  it('mantem a transcricao do audio no corpo enquanto o teclado esta aberto', async () => {
    mockNote.filePath = 'file:///audio.aac';
    mockNote.transcript = 'texto transcrito';
    mockNote.hasTranscript = true;

    try {
      await renderNote();

      expect(screen.getByTestId('audio-transcript').props.children).toBe('texto transcrito');

      fireEvent(screen.getByTestId('note-body'), 'focus');

      // A previa pertence ao no de audio; o teclado nao a esconde.
      expect(screen.getByTestId('audio-transcript').props.children).toBe('texto transcrito');
    } finally {
      delete mockNote.filePath;
      delete mockNote.transcript;
      delete mockNote.hasTranscript;
    }
  });

  it('leva para a gravacao quando a nota ainda nao tem audio', async () => {
    await renderNote();

    fireEvent.press(screen.getByLabelText('Gravar áudio'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/record',
      params: { noteId: 'note-1', from: 'note' },
    });
  });

  it('passa a posicao do cursor para o audio entrar no meio do texto', async () => {
    mockInsertPosition = { nodeId: 't0', offset: 2 };
    await renderNote();

    fireEvent.press(screen.getByLabelText('Gravar áudio'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // A posicao nao viaja pela rota: ela fica guardada por nota, e a rota
    // leva so o id.
    expect(takePendingInsert('note-1')).toEqual({
      nodeId: 't0',
      offset: 2,
    });
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/record',
      params: { noteId: 'note-1', from: 'note' },
    });
  });

  it('permite gravar outro audio numa nota ja sincronizada', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockNote.entryId = 'entry-1';
    mockNote.filePath = 'file:///audio.aac';

    try {
      await renderNote();
      fireEvent.press(screen.getByLabelText('Gravar áudio'));
      await act(async () => {
        jest.advanceTimersByTime(2000);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(alert).not.toHaveBeenCalled();
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/record',
        params: { noteId: 'note-1', from: 'note' },
      });
    } finally {
      delete mockNote.entryId;
      delete mockNote.filePath;
      alert.mockRestore();
    }
  });

  it('reabre com o audio gravado no corpo ao voltar da gravacao', async () => {
    await renderNote();
    expect(screen.getByDisplayValue('primeira linha')).toBeTruthy();

    const withAudio = {
      ...mockNote,
      text: 'primeira linha\n!audio[local:audio-rec-1.aac]{d=5}\n',
    };
    mockGetRecording.mockResolvedValue(withAudio);

    await act(async () => {
      mockBlurListener?.();
      mockFocusListener?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      screen.getByDisplayValue('primeira linha\n!audio[local:audio-rec-1.aac]{d=5}\n'),
    ).toBeTruthy();
  });

  it('leva de volta ao trecho que originou uma tarefa ou ideia', async () => {
    mockNote.captureSourceId = 'note-1';
    mockNote.captureStartMs = 5_000;
    try {
      await renderNote();
      fireEvent.press(screen.getByLabelText('Ouvir o trecho em 00:05'));

      expect(router.push).toHaveBeenCalledWith({
        pathname: '/transcript/[id]',
        params: { id: 'note-1', at: '5000' },
      });
    } finally {
      delete mockNote.captureSourceId;
      delete mockNote.captureStartMs;
    }
  });

  it('mostra a pilha inteira de uma nota somente do servidor', async () => {
    mockStackAudios = [
      {
        id: 'at_1',
        content_type: 'audio/aac',
        size_bytes: 1,
        duration_seconds: 3,
        created_at: '2026-10-01T10:00:00Z',
      },
      {
        id: 'at_2',
        content_type: 'audio/aac',
        size_bytes: 2,
        duration_seconds: 4,
        created_at: '2026-10-02T10:00:00Z',
      },
    ];

    await renderNote();

    expect(screen.getByLabelText('Ouvir áudio 1 de 2')).toBeTruthy();
    expect(screen.getByLabelText('Ouvir áudio 2 de 2')).toBeTruthy();
  });

  it('mostra no card a transcricao que chega da pilha do servidor', async () => {
    mockNote.text = 'A\n!audio[attachment:at_1]{d=3}\nB';
    mockStackAudios = [
      {
        id: 'at_1',
        content_type: 'audio/aac',
        size_bytes: 1,
        duration_seconds: 3,
        created_at: '2026-10-01T10:00:00Z',
        transcript: { text: 'fala do servidor' },
      },
    ];

    try {
      await renderNote();

      expect(screen.getByTestId('audio-transcript').props.children).toBe('fala do servidor');
    } finally {
      mockNote.text = 'primeira linha';
    }
  });

  it('nao duplica no topo o audio que ja esta no corpo', async () => {
    mockNote.text = 'A\n!audio[local:a.aac]{d:3}\nB';
    mockNote.filePath = 'file:///audio.aac';

    try {
      await renderNote();

      // O player do documento e o unico; o player legado do topo nao aparece.
      expect(screen.queryByLabelText('Tocar')).toBeNull();
    } finally {
      mockNote.text = 'primeira linha';
      delete mockNote.filePath;
    }
  });

  it('ao sair, grava o texto antes de liberar a fila de sincronizacao', async () => {
    const order: string[] = [];
    mockUpdateNote.mockImplementation(async () => {
      order.push('update');
    });
    mockRefresh.mockImplementation(async () => {
      order.push('refresh');
    });
    mockKick.mockImplementation(() => {
      order.push('kick');
    });

    try {
      const view = render(<NoteScreen />);
      await act(async () => {
        jest.advanceTimersByTime(200);
        await Promise.resolve();
      });
      fireEvent.changeText(screen.getByTestId('note-body'), 'texto editado');
      await act(async () => {
        jest.advanceTimersByTime(100);
        await Promise.resolve();
      });

      view.unmount();
      await act(async () => {
        jest.advanceTimersByTime(10);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // A saida grava o texto, atualiza a lista e so entao acorda o worker:
      // nada de upload/rede competindo com o ultimo autosave. (A tela do teste
      // anterior pode deixar uma saida pendente; vale a ultima sequencia.)
      expect(order.slice(-3)).toEqual(['update', 'refresh', 'kick']);
    } finally {
      mockUpdateNote.mockImplementation(async () => undefined);
      mockRefresh.mockImplementation(async () => undefined);
      mockKick.mockImplementation(() => undefined);
    }
  });
});
