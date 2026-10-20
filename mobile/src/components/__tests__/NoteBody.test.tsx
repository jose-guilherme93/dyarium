import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';

import { NoteBody, type NoteBodyHandle } from '@/components/NoteBody';

const typography = { family: 'system', size: 17, weight: 'regular' } as const;

describe('corpo da nota', () => {
  it('mostra o texto do corpo e entrega o markdown a cada tecla', () => {
    const onChange = jest.fn();
    render(<NoteBody value="linha" onChangeMarkdown={onChange} typography={typography} />);

    const field = screen.getByDisplayValue('linha');
    fireEvent.changeText(field, 'linha nova');

    expect(onChange).toHaveBeenCalledWith('linha nova');
  });

  it('aplica a formatacao no texto selecionado', () => {
    const onChange = jest.fn();
    const ref = createRef<NoteBodyHandle>();
    render(
      <NoteBody ref={ref} value="linha" onChangeMarkdown={onChange} typography={typography} />,
    );

    const field = screen.getByDisplayValue('linha');
    fireEvent(field, 'focus');
    fireEvent(field, 'selectionChange', {
      nativeEvent: { selection: { start: 0, end: 5 } },
    });

    act(() => {
      ref.current?.format('bold');
    });
    expect(onChange).toHaveBeenLastCalledWith('**linha**');

    act(() => {
      ref.current?.format('list');
    });
    expect(onChange).toHaveBeenLastCalledWith('- **linha**');
  });

  it('coloca o link no texto selecionado', () => {
    const onChange = jest.fn();
    const ref = createRef<NoteBodyHandle>();
    render(
      <NoteBody ref={ref} value="linha" onChangeMarkdown={onChange} typography={typography} />,
    );

    const field = screen.getByDisplayValue('linha');
    fireEvent(field, 'focus');
    fireEvent(field, 'selectionChange', {
      nativeEvent: { selection: { start: 0, end: 5 } },
    });

    act(() => {
      ref.current?.insertLink('https://exemplo.test');
    });
    expect(onChange).toHaveBeenLastCalledWith('[linha](https://exemplo.test)');
  });

  it('insere a foto no corpo', () => {
    const onChange = jest.fn();
    const ref = createRef<NoteBodyHandle>();
    render(
      <NoteBody ref={ref} value="linha" onChangeMarkdown={onChange} typography={typography} />,
    );

    act(() => {
      ref.current?.insertImage('file:///foto.jpg', 'local:foto.jpg', 'foto');
    });

    expect(onChange).toHaveBeenCalledWith('linha\n![foto](local:foto.jpg)');
  });

  it('a foto do corpo usa o arquivo local', () => {
    render(
      <NoteBody
        value={'![foto](local:foto.jpg)'}
        onChangeMarkdown={jest.fn()}
        imageSources={{ 'local:foto.jpg': 'file:///dados/foto.jpg' }}
        typography={typography}
      />,
    );

    expect(screen.getByLabelText('foto')).toBeTruthy();
  });

  it('bloco que o app nao edita (tabela) volta intacto ao salvar', () => {
    const onChange = jest.fn();
    const ref = createRef<NoteBodyHandle>();
    render(
      <NoteBody
        ref={ref}
        value={'| a | b |\n| - | - |\n| 1 | 2 |'}
        onChangeMarkdown={onChange}
        typography={typography}
      />,
    );

    act(() => {
      ref.current?.insertImage('file:///foto.jpg', 'local:foto.jpg', 'foto');
    });

    expect(onChange).toHaveBeenCalledWith(
      '| a | b |\n| - | - |\n| 1 | 2 |\n![foto](local:foto.jpg)',
    );
  });
});
