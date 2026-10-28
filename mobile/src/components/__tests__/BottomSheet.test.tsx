import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { BottomSheet } from '../BottomSheet';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

describe('BottomSheet', () => {
  it('mostra o conteudo e fecha pelo fundo', () => {
    const onClose = jest.fn();
    render(
      <BottomSheet visible onClose={onClose}>
        <Text>Conteudo da folha</Text>
      </BottomSheet>,
    );

    expect(screen.getByText('Conteudo da folha')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Fechar menu'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('nao monta o conteudo quando esta fechada', () => {
    render(
      <BottomSheet visible={false} onClose={jest.fn()}>
        <Text>Conteudo da folha</Text>
      </BottomSheet>,
    );

    expect(screen.queryByText('Conteudo da folha')).toBeNull();
  });
});
