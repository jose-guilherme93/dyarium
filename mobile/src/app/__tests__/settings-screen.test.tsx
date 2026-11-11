import { act, fireEvent, render, screen } from '@testing-library/react-native';

import SettingsScreen from '../settings';

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockSetTheme = jest.fn(async () => undefined);
const mockSetSwipeAction = jest.fn(async () => undefined);
const mockCountTrashed = jest.fn(async () => 3);

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(callback, [callback]);
    },
  };
});

jest.mock('@/services/appNavigation', () => ({
  back: () => mockBack(),
  push: (route: string) => mockPush(route),
}));

jest.mock('@/services/db', () => ({
  countTrashedRecordings: () => mockCountTrashed(),
}));

jest.mock('@/components/ProcessingToggles', () => ({
  ProcessingToggles: () => null,
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('@/state/LibraryContext', () => ({
  useLibrary: () => ({
    ready: true,
    recordings: [
      { id: 'a', archived: true },
      { id: 'b', archived: true },
      { id: 'c', archived: false },
    ],
  }),
}));

jest.mock('@/state/SettingsContext', () => ({
  useSettings: () => ({
    config: null,
    ready: true,
    swipeAction: 'delete',
    setSwipeAction: mockSetSwipeAction,
    theme: 'amoled',
    setTheme: mockSetTheme,
  }),
}));

async function renderSettings() {
  render(<SettingsScreen />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('tela de opções', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mostra as contagens como valor da linha', async () => {
    await renderSettings();

    expect(screen.getByText('Arquivadas')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('Lixeira')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('abre os destinos pela linha', async () => {
    await renderSettings();

    fireEvent.press(screen.getByLabelText('Arquivadas'));
    expect(mockPush).toHaveBeenCalledWith('/archived');

    fireEvent.press(screen.getByLabelText('Lixeira'));
    expect(mockPush).toHaveBeenCalledWith('/trash');

    fireEvent.press(screen.getByLabelText('Backup local'));
    expect(mockPush).toHaveBeenCalledWith('/backup');
  });

  it('troca o tema pelo seletor da linha', async () => {
    await renderSettings();

    fireEvent.press(screen.getByLabelText('Escuro'));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('nao repete frases de apoio na tela', async () => {
    await renderSettings();

    [
      'Por caderno.',
      '7 dias.',
      'Muda apenas as cores do app.',
      'Toque para configurar o servidor.',
      'Uso no aparelho e liberar espaço.',
    ].forEach((text) => {
      expect(screen.queryByText(text)).toBeNull();
    });
  });

  it('mostra o servidor como estado, nao como frase', async () => {
    await renderSettings();

    expect(screen.getByText('Não configurado')).toBeTruthy();
  });
});
