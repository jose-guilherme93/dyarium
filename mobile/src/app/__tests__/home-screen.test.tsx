import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { Notebook } from '@/core/notebooks';
import type { Recording } from '@/core/types';

import HomeScreen from '../index';

const mockRefresh = jest.fn(async () => undefined);
const mockPull = jest.fn();
const mockPush = jest.fn();
const mockKick = jest.fn();
const mockCreateDraftNote = jest.fn(async () => ({ id: 'draft' }));
const mockArchiveNote = jest.fn();
const mockUnarchiveNote = jest.fn();
const mockRemove = jest.fn();
const mockStartRecording = jest.fn();
const mockSetLastNotebookId = jest.fn(async () => undefined);
const mockSetNoteOrder = jest.fn(async () => undefined);

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({})),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('@/services/appNavigation', () => ({
  back: jest.fn(),
  push: (...args: unknown[]) => mockPush(...args),
}));

jest.mock('@/services/files', () => ({
  directoryBytes: jest.fn(() => 0),
  sessionDirectory: jest.fn(() => ''),
}));

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({
    recordings: mockRecordings,
    notebooks: NOTEBOOKS,
    ready: true,
    refresh: mockRefresh,
    pull: mockPull,
    kick: mockKick,
    createDraftNote: mockCreateDraftNote,
    archiveNote: mockArchiveNote,
    unarchiveNote: mockUnarchiveNote,
    remove: mockRemove,
  }),
}));

jest.mock('@/state/RecordingContext', () => ({
  useRecording: () => ({ start: mockStartRecording }),
}));

jest.mock('@/state/SettingsContext', () => ({
  useSettings: () => ({
    swipeAction: 'archive',
    lastNotebookId: undefined,
    setLastNotebookId: mockSetLastNotebookId,
    noteOrder: 'newest',
    setNoteOrder: mockSetNoteOrder,
  }),
}));

jest.mock('@/state/useActivities', () => ({
  useActivities: () => [],
}));

jest.mock('@/state/useDrive', () => ({
  useDrive: () => ({ status: 'off' }),
}));

jest.mock('@/state/useTranscriptionProgress', () => ({
  useTranscriptionProgress: jest.fn(() => 0),
  useTranscriptionRunning: jest.fn(() => false),
}));

jest.mock('@/dev/perf', () => ({
  useRenderCount: jest.fn(),
  bumpRender: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
}));

let mockRecordings: Recording[] = [];

const NOTEBOOKS: Notebook[] = [
  {
    id: 'notas-ao-acaso',
    name: 'Notas ao acaso',
    color: '',
    isDefault: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  },
  {
    id: 'nb-book',
    name: 'O nome do vento',
    color: '',
    isDefault: false,
    kind: 'book',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-11-07T21:10:00.000Z',
  },
  {
    id: 'nb-mcp',
    name: 'Projetos',
    color: '',
    isDefault: false,
    kind: 'mcp',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  },
];

function rec(id: string, over: Partial<Recording> = {}): Recording {
  return {
    id,
    title: over.title ?? id,
    recordedAt: over.recordedAt ?? '2026-10-01T10:00:00.000Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    createdAt: over.createdAt ?? '2026-10-01T10:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

function projectBody(date: string, time: string): string {
  return [
    '```dyarium-json',
    `{"v":1,"project":"dyarium","date":"${date}","time":"${time}","host":"vps-dev","detail":"concise","items":[{"kind":"feat","title":"item"}]}`,
    '```',
  ].join('\n');
}

function fullSet(): Recording[] {
  return [
    rec('note-common', {
      notebookId: 'notas-ao-acaso',
      text: 'fechamos o fluxo de selecao',
      recordedAt: '2026-11-09T14:00:00.000Z',
    }),
    rec('note-mcp-1', {
      notebookId: 'nb-mcp',
      title: 'dyarium',
      text: projectBody('2026-11-07', '14:58'),
      recordedAt: '2026-11-07T14:58:00.000Z',
    }),
    rec('note-mcp-2', {
      notebookId: 'nb-mcp',
      title: 'dyarium',
      text: projectBody('2026-11-08', '18:02'),
      recordedAt: '2026-11-08T18:02:00.000Z',
    }),
    rec('chapter-1', {
      notebookId: 'nb-book',
      title: 'Capitulo um',
      text: 'era uma vez',
      recordedAt: '2026-11-07T21:10:00.000Z',
      chapterKind: 'chapter',
    }),
  ];
}

async function drain() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScreen() {
  render(<HomeScreen />);
  await drain();
}

beforeEach(() => {
  mockPush.mockClear();
  mockRecordings = [];
});

describe('home misturada (Recentes)', () => {
  it('mostra nota, livro e projeto na mesma lista', async () => {
    mockRecordings = fullSet();
    await renderScreen();

    expect(screen.getByText('note-common')).toBeTruthy();
    expect(screen.getByText('O nome do vento')).toBeTruthy();
    expect(screen.getByText('dyarium')).toBeTruthy();

    // Livro e projeto nao entram como notas.
    expect(screen.queryByText('Capitulo um')).toBeNull();
    expect(screen.queryByText('note-mcp-1')).toBeNull();
    expect(screen.queryByText('note-mcp-2')).toBeNull();
  });

  it('ordena por data decrescente: nota nova no topo, depois projeto e livro', async () => {
    mockRecordings = fullSet();
    await renderScreen();

    const titles = screen
      .getAllByText(/note-common|dyarium|O nome do vento/)
      .map((el) => el.props.children);
    expect(titles).toEqual(['note-common', 'dyarium', 'O nome do vento']);
  });

  it('toque no livro abre a tela do livro', async () => {
    mockRecordings = fullSet();
    await renderScreen();

    fireEvent.press(screen.getByText('O nome do vento'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/books/[id]',
      params: { id: 'nb-book' },
    });
  });

  it('toque no projeto abre a superficie Projetos', async () => {
    mockRecordings = fullSet();
    await renderScreen();

    fireEvent.press(screen.getByText('dyarium'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/projects',
      params: { notebook: 'nb-mcp' },
    });
  });

  it('toque na nota abre a nota', async () => {
    mockRecordings = fullSet();
    await renderScreen();

    fireEvent.press(screen.getByText('note-common'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/note/[id]',
      params: { id: 'note-common' },
    });
  });

  it('usa o FAB circular de 44 e mantem o menu de nova nota', async () => {
    await renderScreen();

    const fab = screen.getByLabelText('Nova nota');
    const fabStyle = StyleSheet.flatten(fab.props.style) as {
      width: number;
      height: number;
      borderRadius: number;
    };
    expect(fabStyle.width).toBe(44);
    expect(fabStyle.height).toBe(44);
    expect(fabStyle.borderRadius).toBe(22);

    fireEvent.press(fab);

    expect(screen.getByLabelText('Link')).toBeTruthy();
    expect(screen.getByLabelText('Imagem')).toBeTruthy();
    expect(screen.getByLabelText('Áudio')).toBeTruthy();
    expect(screen.getByLabelText('Texto')).toBeTruthy();
  });
});
