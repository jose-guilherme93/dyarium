import { fireEvent, render, screen } from '@testing-library/react-native';

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
    onOpenActivity: jest.fn(),
    onOpenSettings: jest.fn(),
    ...overrides,
  };
  render(<HomeHeader {...props} />);
  return props;
}

describe('HomeHeader', () => {
  it('abre os cadernos pelo icone e mantem as acoes do topo', () => {
    const props = setup();

    expect(screen.getByText('Viagem')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Caderno Viagem. Trocar de caderno'));
    expect(props.onOpenNotebooks).toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Sincronização'));
    expect(props.onOpenSync).toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Opções'));
    expect(props.onOpenSettings).toHaveBeenCalled();
  });

  it('mostra páginas recentes quando nenhum caderno está no escopo', () => {
    const props = setup({ notebook: undefined });

    expect(screen.getByText('Páginas recentes')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Páginas recentes. Escolher caderno'));
    expect(props.onOpenNotebooks).toHaveBeenCalled();
  });

  it('abre o centro de atividade ao lado da nuvem', () => {
    const props = setup();

    fireEvent.press(screen.getByLabelText('Atividade'));
    expect(props.onOpenActivity).toHaveBeenCalled();
  });

  it('so ocupa espaco com a busca quando ela esta aberta', () => {
    const props = setup();

    expect(screen.queryByPlaceholderText('Buscar em todos os cadernos')).toBeNull();
    fireEvent.press(screen.getByLabelText('Buscar notas'));
    expect(props.onToggleSearch).toHaveBeenCalled();
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
