import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { Recording } from '@/core/types';

import ArchivedScreen from '../archived';

const mockUnarchiveNote = jest.fn(async () => undefined);

let mockRecordings: Recording[] = [];

const notebooks = [
  {
    id: 'notas-ao-acaso',
    name: 'Notas ao acaso',
    color: '',
    isDefault: true,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    dirty: false,
    synced: true,
  },
  {
    id: 'nb-tarefas',
    name: 'Tarefas e ideias',
    color: '#FF9F0A',
    isDefault: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    dirty: false,
    synced: true,
  },
  {
    id: 'nb-viagem',
    name: 'Viagem',
    color: '#30D158',
    isDefault: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    dirty: false,
    synced: true,
  },
];

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({
    recordings: mockRecordings,
    notebooks,
    ready: true,
    unarchiveNote: mockUnarchiveNote,
  }),
}));

jest.mock('@/state/SettingsContext', () => ({
  useSettings: () => ({ noteOrder: 'newest' }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('@/services/appNavigation', () => ({
  back: jest.fn(),
  push: jest.fn(),
}));

function note(patch: Partial<Recording>): Recording {
  return {
    id: 'nota',
    title: 'Nota',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    recordedAt: '2026-10-01T10:00:00.000Z',
    dir: '',
    segmentCount: 0,
    offset: 0,
    attempts: 0,
    status: 'completed',
    ...patch,
  };
}

describe('tela de arquivadas', () => {
  beforeEach(() => {
    mockUnarchiveNote.mockClear();
  });

  it('separa por caderno e esconde a lixeira e as ativas', () => {
    mockRecordings = [
      note({ id: 'a', title: 'Comprar cafe', notebookId: 'nb-tarefas', archived: true }),
      note({ id: 'b', title: 'Passagem', notebookId: 'nb-viagem', archived: true }),
      note({ id: 'c', title: 'Ativa', notebookId: 'nb-tarefas' }),
      note({
        id: 'd',
        title: 'Apagada',
        notebookId: 'nb-tarefas',
        archived: true,
        deletedAt: '2026-10-27T10:00:00.000Z',
      }),
    ];

    render(<ArchivedScreen />);

    expect(screen.getByText('Tarefas e ideias')).toBeTruthy();
    expect(screen.getByText('Viagem')).toBeTruthy();
    expect(screen.getByText('Comprar cafe')).toBeTruthy();
    expect(screen.getByText('Passagem')).toBeTruthy();
    expect(screen.queryByText('Ativa')).toBeNull();
    expect(screen.queryByText('Apagada')).toBeNull();
  });

  it('devolve a nota para a lista com um toque', async () => {
    mockRecordings = [
      note({ id: 'a', title: 'Comprar cafe', notebookId: 'nb-tarefas', archived: true }),
    ];

    render(<ArchivedScreen />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Desarquivar Comprar cafe'));
      await Promise.resolve();
    });

    expect(mockUnarchiveNote).toHaveBeenCalledWith('a');
  });
});
