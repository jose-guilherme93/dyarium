import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from '@/components/Button';

describe('Button', () => {
  it('mostra o rotulo quando nao esta carregando', () => {
    render(<Button label="Enviar agora" onPress={() => undefined} />);
    expect(screen.getByText('Enviar agora')).toBeTruthy();
  });

  it('mantem o rotulo enquanto carrega', () => {
    // Antes o rotulo era trocado por um ActivityIndicator e o botao virava um
    // card vazio: o usuario nao sabia o que estava em andamento.
    render(<Button label="Testar e salvar" onPress={() => undefined} loading />);
    expect(screen.getByText('Testar e salvar')).toBeTruthy();
  });

  it('nao dispara onPress enquanto carrega', () => {
    const onPress = jest.fn();
    render(<Button label="Enviar agora" onPress={onPress} loading />);

    fireEvent.press(screen.getByText('Enviar agora'));

    expect(onPress).not.toHaveBeenCalled();
  });
});
