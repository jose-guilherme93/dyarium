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
      />,
    );
    fireEvent.press(screen.getByLabelText('Gerenciar tags'));
    expect(onManage).toHaveBeenCalled();
  });
});
