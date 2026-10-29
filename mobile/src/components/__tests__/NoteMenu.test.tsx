import { fireEvent, render, screen } from '@testing-library/react-native';

import { NoteMenu } from '../NoteMenu';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const typography = { family: 'system', size: 17, weight: 'regular' } as const;

describe('NoteMenu', () => {
  it('abre como tela de configuracoes com as propriedades atuais', () => {
    const onClose = jest.fn();
    const onShare = jest.fn();

    render(
      <NoteMenu
        visible
        title="Reunião de segunda"
        properties={[
          { label: 'Caderno', value: 'Trabalho' },
          { label: 'Palavras', value: '128' },
        ]}
        typography={typography}
        onChangeTypography={jest.fn()}
        onClose={onClose}
        onShare={onShare}
      />,
    );

    expect(screen.getByText('Configurações')).toBeTruthy();
    expect(screen.getByText('Reunião de segunda')).toBeTruthy();
    expect(screen.getByText('Compartilhar nota')).toBeTruthy();
    expect(screen.getByText('Propriedades')).toBeTruthy();
    expect(screen.getByText('128')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Compartilhar nota'));
    expect(onShare).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText('Fechar configurações'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('nao mistura analise com as configuracoes da nota', () => {
    render(
      <NoteMenu
        visible
        title="Nota"
        properties={[]}
        typography={typography}
        onChangeTypography={jest.fn()}
        onClose={jest.fn()}
        onShare={jest.fn()}
      />,
    );

    expect(screen.queryByText('Analisar nota')).toBeNull();
    expect(screen.queryByText('Análise')).toBeNull();
  });
});
