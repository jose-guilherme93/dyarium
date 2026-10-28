import { fireEvent, render, screen } from '@testing-library/react-native';

import { TagFilterRow } from '../TagFilterRow';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('TagFilterRow', () => {
  it('mostra Todas, tags e contagem, e alterna a tag', () => {
    const onToggle = jest.fn();
    render(
      <TagFilterRow
        tags={[
          { name: 'viagem', count: 3 },
          { name: 'familia', count: 1 },
        ]}
        selected={[]}
        onToggle={onToggle}
        onClear={jest.fn()}
        onManage={jest.fn()}
        order="newest"
        onPressOrder={jest.fn()}
      />,
    );

    expect(screen.getByText('Todas')).toBeTruthy();
    expect(screen.getByText('viagem')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();

    fireEvent.press(screen.getByText('viagem'));
    expect(onToggle).toHaveBeenCalledWith('viagem');
  });

  it('abre o gerenciador de tags', () => {
    const onManage = jest.fn();
    render(
      <TagFilterRow
        tags={[]}
        selected={[]}
        onToggle={jest.fn()}
        onClear={jest.fn()}
        onManage={onManage}
        order="newest"
        onPressOrder={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByLabelText('Gerenciar tags'));
    expect(onManage).toHaveBeenCalled();
  });

  it('abre a ordenacao e anuncia a ordem atual', () => {
    const onPressOrder = jest.fn();
    render(
      <TagFilterRow
        tags={[]}
        selected={[]}
        onToggle={jest.fn()}
        onClear={jest.fn()}
        onManage={jest.fn()}
        order="oldest"
        onPressOrder={onPressOrder}
      />,
    );
    fireEvent.press(screen.getByLabelText('Ordenar notas: mais antigas primeiro'));
    expect(onPressOrder).toHaveBeenCalled();
  });
});
