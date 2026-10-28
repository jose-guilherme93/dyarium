import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { Recording } from '@/core/types';

import TrashScreen from '../trash';

const mockRestoreFromTrash = jest.fn(async () => undefined);
const mockListTrashed = jest.fn(async () => [] as Recording[]);
const mockPurge = jest.fn(async () => 0);

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(callback, [callback]);
    },
  };
});

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({ restoreFromTrash: mockRestoreFromTrash }),
}));

jest.mock('@/services/db', () => ({
  listTrashedRecordings: () => mockListTrashed(),
}));

jest.mock('@/services/trash', () => ({
  purgeExpiredTrash: () => mockPurge(),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('@/services/appNavigation', () => ({
  back: jest.fn(),
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

async function renderTrash() {
  render(<TrashScreen />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('tela da lixeira', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListTrashed.mockResolvedValue([]);
  });

  it('limpa o que passou dos 7 dias antes de mostrar a lista', async () => {
    await renderTrash();

    expect(mockPurge).toHaveBeenCalled();
    expect(mockListTrashed).toHaveBeenCalled();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('mostra os dias que restam e restaura a nota', async () => {
    const deletedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    mockListTrashed.mockResolvedValue([
      note({ id: 'a', title: 'Comprar cafe', deletedAt }),
    ]);

    await renderTrash();

    expect(screen.getByText('Comprar cafe')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Restaurar Comprar cafe'));
      await Promise.resolve();
    });

    expect(mockRestoreFromTrash).toHaveBeenCalledWith('a');
    expect(mockListTrashed).toHaveBeenCalledTimes(2);
  });
});
