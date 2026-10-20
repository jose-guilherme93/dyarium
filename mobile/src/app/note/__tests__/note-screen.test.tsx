import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, InteractionManager } from 'react-native';

import type { Recording } from '@/core/types';

import NoteScreen from '../[id]';

const mockUpdateNote = jest.fn(async () => undefined);
const mockSubmitNote = jest.fn(async () => undefined);
const mockRefresh = jest.fn(async () => undefined);
const mockPickImage = jest.fn();
const mockSaveLocalImage = jest.fn();
const mockLocalImageUri = jest.fn();
const mockFormat = jest.fn();

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

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ id: 'note-1' }),
  useNavigation: () => ({
    addListener: jest.fn(() => jest.fn()),
    dispatch: jest.fn(),
  }),
}));

// A barra que acompanha o teclado usa o componente do TenTap, que depende de
// modulos nativos; no Jest ele vira uma View comum.
jest.mock('@10play/tentap-editor', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    EditorKeyboardAvoidingView: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement(View, props, children),
  };
});

// O WebView nao existe no Jest: a tela e testada com um TextInput que faz o
// mesmo papel (entrega markdown, foco e as acoes imperativas do editor).
jest.mock('@/components/TentapNoteEditor', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextInput } = require('react-native');
  return {
    TentapNoteEditor: React.forwardRef(function MockEditor(props: any, ref: any) {
      const current = React.useRef(props.value);
      React.useImperativeHandle(ref, () => ({
        focus: jest.fn(),
        format: (...args: unknown[]) => mockFormat(...args),
        insertImage: (_display: string, persist: string, alt: string) => {
          current.current = `${current.current}\n![${alt}](${persist})`;
          props.onChangeMarkdown(current.current);
        },
        insertLink: jest.fn(),
        flush: jest.fn(async () => undefined),
      }));
      return React.createElement(TextInput, {
        testID: 'note-body',
        defaultValue: props.value,
        placeholder: props.placeholder,
        onChangeText: (text: string) => {
          current.current = text;
          props.onChangeMarkdown(text);
        },
        onFocus: () => props.onEditingChange?.(true),
        onBlur: () => props.onEditingChange?.(false),
      });
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
    setNoteTags: jest.fn(),
    moveNoteToNotebook: jest.fn(),
    retry: jest.fn(),
  }),
}));

jest.mock('@/state/SettingsContext', () => ({
  useSettings: () => ({
    typography: { family: 'system', size: 17, weight: 'regular' },
    setTypography: jest.fn(async () => undefined),
    analysisModel: 'modelo-local',
    setAnalysisModel: jest.fn(async () => undefined),
    analysisLowPower: false,
    setAnalysisLowPower: jest.fn(async () => undefined),
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
  usePlaybackSource: () => mockPlayer,
  useLoadPlayback: () => jest.fn(),
  usePauseOnUnmount: () => undefined,
}));

jest.mock('@/state/useAudioStack', () => ({
  useAudioStack: () => ({ audios: [], refresh: jest.fn(async () => undefined) }),
}));

jest.mock('@/state/useTranscriptionProgress', () => ({
  useTranscriptionProgress: () => 0,
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
}));

jest.mock('@/services/analysisModels', () => ({
  installedAnalysisModels: () => [],
  isAnalysisModelInstalled: () => false,
}));

jest.mock('@/services/audioFocus', () => ({
  releaseAudioFocus: jest.fn(),
}));

jest.mock('@/services/db', () => ({
  getCachedAnalysis: jest.fn(async () => null),
  getRecording: jest.fn(async () => mockNote),
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
}));

jest.mock('@/services/localAnalysis', () => ({
  analyzeRecording: jest.fn(),
  localAnalysisAvailable: () => false,
  stopAnalysis: jest.fn(),
}));

jest.mock('@/services/localTranscription', () => ({
  maybeTranscribeLocally: jest.fn(async () => undefined),
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
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(((task: () => void) => {
      task();
      return { cancel: jest.fn() };
    }) as never);
    mockLocalImageUri.mockReturnValue('file:///nota/img-1.jpg');
    mockSaveLocalImage.mockResolvedValue('img-1.jpg');
    mockPickImage.mockResolvedValue({
      name: 'foto.jpg',
      mimeType: 'image/jpeg',
      bytes: new Uint8Array([1, 2, 3]),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const renderNote = async () => {
    render(<NoteScreen />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

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

  it('avisa que nota ja sincronizada nao aceita outro audio', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockNote.entryId = 'entry-1';
    mockNote.filePath = 'file:///audio.aac';

    await renderNote();
    fireEvent.press(screen.getByLabelText('Gravar áudio'));

    expect(alert).toHaveBeenCalledWith(
      'Nota já sincronizada',
      expect.stringContaining('nota nova'),
    );
    expect(router.push).not.toHaveBeenCalled();

    delete mockNote.entryId;
    delete mockNote.filePath;
    alert.mockRestore();
  });
});
