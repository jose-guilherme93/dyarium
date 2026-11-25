import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { HomeHeader } from '../HomeHeader';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const NOTEBOOK = {
  id: 'viagem',
  name: 'Viagem',
  color: '#C7D8F2',
  isDefault: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ACTION_LABELS = [
  'Sincronização',
  'Atividade',
  'Calendário',
  'Mapa de relações',
  'Buscar notas',
  'Opções',
  'Perfil',
];

function setup(overrides: Partial<React.ComponentProps<typeof HomeHeader>> = {}) {
  const props: React.ComponentProps<typeof HomeHeader> = {
    notebook: NOTEBOOK,
    syncState: 'ok',
    searchOpen: false,
    query: '',
    onToggleSearch: jest.fn(),
    onChangeQuery: jest.fn(),
    onOpenNotebooks: jest.fn(),
    onOpenSync: jest.fn(),
    onOpenMap: jest.fn(),
    onOpenCalendar: jest.fn(),
    onOpenActivity: jest.fn(),
    onOpenSettings: jest.fn(),
    onOpenProfile: jest.fn(),
    ...overrides,
  };
  render(<HomeHeader {...props} />);
  return props;
}

describe('HomeHeader, duas linhas', () => {
  it('coloca o caderno na primeira linha e as acoes na segunda', () => {
    setup();

    const notebookRow = screen.getByTestId('home-header-notebook');
    const actionsRow = screen.getByTestId('home-header-actions');

    expect(within(notebookRow).getByText('Viagem')).toBeTruthy();
    expect(within(notebookRow).queryByLabelText('Sincronização')).toBeNull();
    expect(within(actionsRow).getByLabelText('Sincronização')).toBeTruthy();
  });

  it('mostra o nome inteiro do caderno, sem limite de linhas que corte o texto', () => {
    setup({
      notebook: { ...NOTEBOOK, name: 'Caderno de campo' },
    });

    const name = screen.getByText('Caderno de campo');
    expect(name.props.numberOfLines).toBeUndefined();
  });

  it('abre os cadernos pelo nome inteiro', () => {
    const props = setup();

    fireEvent.press(screen.getByLabelText('Caderno Viagem. Trocar de caderno'));
    expect(props.onOpenNotebooks).toHaveBeenCalled();
  });

  it('mostra Recentes quando nenhum caderno está no escopo', () => {
    const props = setup({ notebook: undefined });

    expect(screen.getByText('Recentes')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Recentes. Escolher caderno'));
    expect(props.onOpenNotebooks).toHaveBeenCalled();
  });
});

describe('HomeHeader, seis acoes e avatar', () => {
  it('mantem as seis acoes e deixa o avatar por ultimo', () => {
    setup();

    const actionsRow = screen.getByTestId('home-header-actions');
    const buttons = within(actionsRow).getAllByRole('button');

    expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual(ACTION_LABELS);
  });

  it('alcanca todas as seis acoes do topo', () => {
    const props = setup();

    fireEvent.press(screen.getByLabelText('Sincronização'));
    expect(props.onOpenSync).toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Atividade'));
    expect(props.onOpenActivity).toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Calendário'));
    expect(props.onOpenCalendar).toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Mapa de relações'));
    expect(props.onOpenMap).toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Buscar notas'));
    expect(props.onToggleSearch).toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Opções'));
    expect(props.onOpenSettings).toHaveBeenCalled();
  });

  it('abre o perfil pelo avatar', () => {
    const props = setup();

    fireEvent.press(screen.getByLabelText('Perfil'));
    expect(props.onOpenProfile).toHaveBeenCalled();
  });
});

describe('HomeHeader, busca', () => {
  it('so ocupa espaco com a busca quando ela esta aberta', () => {
    setup();

    expect(screen.queryByPlaceholderText('Buscar em todos os cadernos')).toBeNull();
  });

  it('digita, limpa e fecha a busca aberta', () => {
    const props = setup({ searchOpen: true, query: 'praia' });

    fireEvent.changeText(screen.getByLabelText('Buscar notas'), 'serra');
    expect(props.onChangeQuery).toHaveBeenCalledWith('serra');

    fireEvent.press(screen.getByLabelText('Limpar busca'));
    expect(props.onChangeQuery).toHaveBeenCalledWith('');

    fireEvent.press(screen.getByLabelText('Fechar busca'));
    expect(props.onToggleSearch).toHaveBeenCalled();
  });
});

describe('HomeHeader, avatar de perfil', () => {
  it('renderiza iniciais quando nao ha foto e chama onOpenProfile', () => {
    const props = setup({
      profile: { name: 'Ana Silva', email: 'a@b.com', picture: '' },
      accountState: 'connected',
    } as Partial<React.ComponentProps<typeof HomeHeader>>);

    expect(screen.getByText('AS')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Perfil'));
    expect(props.onOpenProfile).toHaveBeenCalled();
  });

  it('renderiza a foto do perfil quando existe', () => {
    setup({
      profile: { name: 'Ana', email: 'a@b.com', picture: 'http://pic' },
      accountState: 'connected',
    } as Partial<React.ComponentProps<typeof HomeHeader>>);

    expect(screen.getByTestId('home-header-avatar-photo')).toBeTruthy();
  });

  it('mostra a marca de estado dentro do avatar, a 2px da borda', () => {
    setup({
      profile: { name: 'Ana', email: 'a@b.com', picture: 'http://pic' },
      accountState: 'connected',
    } as Partial<React.ComponentProps<typeof HomeHeader>>);

    const mark = StyleSheet.flatten(
      screen.getByTestId('home-header-state').props.style,
    ) as { right: number; bottom: number; backgroundColor: string };

    expect(mark.right).toBe(2);
    expect(mark.bottom).toBe(2);
    expect(mark.backgroundColor).not.toBe('transparent');
  });

  it('marca sessao vencida com anel de aviso e sem preenchimento', () => {
    setup({
      profile: { name: 'Ana', email: 'a@b.com', picture: '' },
      accountState: 'expired',
    } as Partial<React.ComponentProps<typeof HomeHeader>>);

    const mark = StyleSheet.flatten(
      screen.getByTestId('home-header-state').props.style,
    ) as { backgroundColor: string; borderStyle?: string };

    expect(mark.backgroundColor).toBe('transparent');
    expect(mark.borderStyle).toBeUndefined();
  });

  it('marca a falta de conta com anel tracejado', () => {
    setup();

    const mark = StyleSheet.flatten(
      screen.getByTestId('home-header-state').props.style,
    ) as { backgroundColor: string; borderStyle?: string };

    expect(mark.backgroundColor).toBe('transparent');
    expect(mark.borderStyle).toBe('dashed');
  });
});
