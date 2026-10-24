import { fireEvent, render, screen } from '@testing-library/react-native';

import { Press } from '../Press';
import { NoteMenu, sheetDragMode, sheetReleaseAction } from '../NoteMenu';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const typography = { family: 'system', size: 17, weight: 'regular' } as const;

describe('NoteMenu', () => {
  it('deixa o deslize para baixo recolher a folha expandida no topo', () => {
    expect(sheetDragMode(false, true)).toEqual({ enabled: true, bothDirections: true });
    expect(sheetDragMode(true, true)).toEqual({ enabled: true, bothDirections: false });
    expect(sheetDragMode(true, false)).toEqual({ enabled: false, bothDirections: false });
  });

  it('fecha com uma puxada para baixo, recolhe com uma curta', () => {
    expect(sheetReleaseAction(false, 60, 0)).toBe('close');
    expect(sheetReleaseAction(false, -40, 0)).toBe('expand');
    expect(sheetReleaseAction(true, 60, 0)).toBe('collapse');
    expect(sheetReleaseAction(true, 160, 0)).toBe('close');
    expect(sheetReleaseAction(true, 10, -800)).toBe('expand');
  });

  it('nao fecha com um arrasto curto e lento para baixo', () => {
    // Cerca de 1 cm, devagar: volta para a posicao recolhida.
    expect(sheetReleaseAction(false, 30, 500)).toBe('collapse');
    expect(sheetReleaseAction(false, 30, 900)).toBe('close');
    expect(sheetReleaseAction(true, 30, -200)).toBe('expand');
    expect(sheetReleaseAction(true, 30, 500)).toBe('collapse');
  });

  it('sobe recolhido e expande os detalhes pela acao de acessibilidade', () => {
    const view = render(
      <NoteMenu
        visible
        title="Reunião de segunda"
        properties={[
          { label: 'Caderno', value: 'Trabalho' },
          { label: 'Palavras', value: '128' },
        ]}
        typography={typography}
        onChangeTypography={jest.fn()}
        onClose={jest.fn()}
        onShare={jest.fn()}
      />,
    );

    expect(screen.getByText('Puxe para cima para ver tudo')).toBeTruthy();
    expect(screen.getByText('Compartilhar nota')).toBeTruthy();
    expect(screen.getByText('Propriedades')).toBeTruthy();
    expect(screen.getByText('128')).toBeTruthy();

    const backdrop = view
      .UNSAFE_getAllByType(Press)
      .find((item) => item.props.accessibilityLabel === 'Fechar menu');
    expect(backdrop?.props.feedback).toBe(false);

    const header = screen.getByLabelText('Detalhes da nota');
    expect(header.props.accessibilityState).toEqual({ expanded: false });
    expect(screen.getByTestId('note-menu-scroll').props.scrollEnabled).toBe(false);

    fireEvent(header, 'accessibilityAction', {
      nativeEvent: { actionName: 'expand' },
    });

    expect(screen.getByText('Puxe para baixo para recolher')).toBeTruthy();
    expect(screen.getByLabelText('Detalhes da nota').props.accessibilityState).toEqual({
      expanded: true,
    });
    expect(screen.getByTestId('note-menu-scroll').props.scrollEnabled).toBe(true);
  });
});
