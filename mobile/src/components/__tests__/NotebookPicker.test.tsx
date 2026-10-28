import { fireEvent, render, screen } from '@testing-library/react-native';

import { NotebookPicker } from '../NotebookPicker';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const NOTEBOOKS = [
  {
    id: 'viagem',
    name: 'Viagem',
    color: '#C7D8F2',
    isDefault: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'ideias',
    name: 'Ideias',
    color: '',
    isDefault: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('NotebookPicker', () => {
  it('escolhe paginas recentes, um caderno ou a gestao', () => {
    const onSelect = jest.fn();
    const onSelectRecent = jest.fn();
    const onManage = jest.fn();
    render(
      <NotebookPicker
        visible
        notebooks={NOTEBOOKS}
        title="Cadernos"
        recentSelected
        onClose={jest.fn()}
        onSelect={onSelect}
        onSelectRecent={onSelectRecent}
        onManage={onManage}
      />,
    );

    expect(screen.getByText('Cadernos')).toBeTruthy();
    fireEvent.press(screen.getByText('Páginas recentes'));
    expect(onSelectRecent).toHaveBeenCalled();

    fireEvent.press(screen.getByText('Viagem'));
    expect(onSelect).toHaveBeenCalledWith('viagem');

    fireEvent.press(screen.getByText('Novo ou gerenciar cadernos'));
    expect(onManage).toHaveBeenCalled();
  });

  it('sem as opções da home continua sendo o seletor de mover nota', () => {
    render(
      <NotebookPicker visible notebooks={NOTEBOOKS} onClose={jest.fn()} onSelect={jest.fn()} />,
    );

    expect(screen.getByText('Mover para caderno')).toBeTruthy();
    expect(screen.queryByText('Páginas recentes')).toBeNull();
    expect(screen.queryByText('Novo ou gerenciar cadernos')).toBeNull();
  });
});
