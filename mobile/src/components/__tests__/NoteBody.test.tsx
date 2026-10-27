import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';
import { Alert } from 'react-native';

import { NoteBody, type NoteBodyHandle } from '@/components/NoteBody';

const typography = { family: 'system', size: 17, weight: 'regular' } as const;

const mockSetLink = jest.fn();
const mockSetSelection = jest.fn();
const mockFocus = jest.fn();
const mockGetHTML = jest.fn();
const mockToggleBold = jest.fn();
const mockToggleItalic = jest.fn();
const mockToggleStrike = jest.fn();
const mockToggleCode = jest.fn();
const mockToggleH2 = jest.fn();
const mockToggleList = jest.fn();
const mockToggleOrdered = jest.fn();
const mockToggleQuote = jest.fn();

// O componente nativo nao existe no Jest. O fake guarda o HTML como o editor
// faria: cada tecla atualiza o valor e o `getHTML` devolve o ultimo conteudo.
jest.mock('react-native-enriched-html', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text, TextInput } = require('react-native');
  return {
    EnrichedText: ({ children }: { children: string }) => React.createElement(Text, null, children),
    EnrichedTextInput: React.forwardRef(function FakeEditor(props: any, ref: any) {
      const [value, setValue] = React.useState(props.defaultValue ?? '');
      const html = React.useRef(props.defaultValue ?? '');
      React.useImperativeHandle(ref, () => ({
        focus: mockFocus,
        blur: jest.fn(),
        setValue: (next: string) => {
          html.current = next;
          setValue(next);
        },
        getHTML: async () => {
          mockGetHTML();
          return html.current;
        },
        setSelection: (start: number, end: number) => {
          mockSetSelection(start, end);
        },
        toggleBold: mockToggleBold,
        toggleItalic: mockToggleItalic,
        toggleStrikeThrough: mockToggleStrike,
        toggleInlineCode: mockToggleCode,
        toggleH2: mockToggleH2,
        toggleUnorderedList: mockToggleList,
        toggleOrderedList: mockToggleOrdered,
        toggleBlockQuote: mockToggleQuote,
        setLink: mockSetLink,
      }));
      return React.createElement(TextInput, {
        testID: 'rich-editor',
        value,
        placeholder: props.placeholder,
        onChangeText: (text: string) => {
          html.current = text;
          setValue(text);
          props.onChangeSelection?.({
            nativeEvent: { start: text.length, end: text.length, text: '' },
          });
        },
        onFocus: props.onFocus,
        onBlur: props.onBlur,
        onSelectionChange: props.onChangeSelection,
        style: props.style,
        scrollEnabled: props.scrollEnabled,
      });
    }),
  };
});

jest.mock('@expo/vector-icons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => React.createElement(Text, null, name),
  };
});

jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(async () => undefined),
    currentTime: 0,
    duration: 3,
  }),
  useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 3 }),
}));

jest.mock('@/services/imageRatios', () => ({
  cachedImageRatio: () => undefined,
  imageRatio: () => 4 / 3,
  measureImageRatio: async () => 4 / 3,
  rememberImageRatio: jest.fn(),
}));

describe('corpo da nota em nos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const flushDebounce = async () => {
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const settle = async (task: () => void) => {
    await act(async () => {
      task();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  /** Foca o editor de um trecho (o que o toque no campo faz nativamente). */
  const focusEditor = async (index = 0) => {
    await act(async () => {
      fireEvent(screen.getAllByTestId('rich-editor')[index], 'focus');
      await Promise.resolve();
    });
  };

  it('todo trecho de texto e o editor nativo, sem previa no meio', () => {
    render(
      <NoteBody
        value={'A\n![foto](local:f.jpg){w=50}\nB'}
        onChangeMarkdown={jest.fn()}
        imageSources={{ 'local:f.jpg': 'file:///dados/f.jpg' }}
        typography={typography}
      />,
    );

    // Dois trechos de texto, dois editores: o toque chega direto no campo
    // nativo e o cursor e do proprio Android.
    expect(screen.getAllByTestId('rich-editor')).toHaveLength(2);
    expect(screen.queryAllByTestId('text-preview')).toHaveLength(0);
    expect(screen.getByLabelText('foto')).toBeTruthy();
  });

  it('monta texto, foto e audio na ordem do documento', () => {
    render(
      <NoteBody
        value={'A\n![foto](local:f.jpg){w=50}\nB\n!audio[local:a.aac]{d=3}\nC'}
        onChangeMarkdown={jest.fn()}
        imageSources={{ 'local:f.jpg': 'file:///dados/f.jpg' }}
        typography={typography}
      />,
    );

    // A, B e C: tres trechos de texto, tres editores.
    expect(screen.getAllByTestId('rich-editor')).toHaveLength(3);
    expect(screen.getByLabelText('foto')).toBeTruthy();
    expect(screen.getByLabelText('Tocar áudio')).toBeTruthy();
    expect(screen.getByText('00:03')).toBeTruthy();
  });

  it('entrega o markdown de todos os nos depois do debounce', async () => {
    const onChange = jest.fn();
    render(
      <NoteBody
        value={'A\n![foto](local:f.jpg){w=50}\nB'}
        onChangeMarkdown={onChange}
        typography={typography}
      />,
    );

    const editors = screen.getAllByTestId('rich-editor');
    fireEvent.changeText(editors[1], '<p>B novo</p>');
    await flushDebounce();

    expect(onChange).toHaveBeenLastCalledWith('A\n![foto](local:f.jpg){w=50}\nB novo');
  });

  it('mexer so a selecao nao marca a nota como editada', async () => {
    const onChange = jest.fn();
    render(<NoteBody value="linha" onChangeMarkdown={onChange} typography={typography} />);

    await focusEditor();
    fireEvent(screen.getByTestId('rich-editor'), 'selectionChange', {
      nativeEvent: { start: 2, end: 2, text: '' },
    });
    await flushDebounce();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('mover o cursor nao le o HTML do trecho', async () => {
    render(<NoteBody value="linha" onChangeMarkdown={jest.fn()} typography={typography} />);

    // Trocar o cursor entre duas letras e so selecao: nao pode custar uma
    // leitura do HTML (que serializa o trecho inteiro e trava o quadro).
    fireEvent(screen.getByTestId('rich-editor'), 'selectionChange', {
      nativeEvent: { start: 1, end: 1, text: '' },
    });
    fireEvent(screen.getByTestId('rich-editor'), 'selectionChange', {
      nativeEvent: { start: 2, end: 2, text: '' },
    });
    await act(async () => {
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(mockGetHTML).not.toHaveBeenCalled();
  });

  it('nunca cobre o texto com indicador de carregamento', () => {
    render(<NoteBody value="linha" onChangeMarkdown={jest.fn()} typography={typography} />);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId('note-body-loading')).toBeNull();
    expect(screen.queryByTestId('note-body-skeleton')).toBeNull();
    expect(screen.getByTestId('rich-editor')).toBeTruthy();
  });

  it('atualiza a fonte do trecho nativo sem remontar o editor', () => {
    const { rerender } = render(
      <NoteBody value="linha" onChangeMarkdown={jest.fn()} typography={typography} />,
    );
    expect(screen.getByTestId('rich-editor').props.style.fontSize).toBe(17);

    rerender(
      <NoteBody
        value="linha"
        onChangeMarkdown={jest.fn()}
        typography={{ family: 'serif', size: 21, weight: 'bold' }}
      />,
    );

    const style = screen.getByTestId('rich-editor').props.style;
    expect(style.fontSize).toBe(21);
    expect(style.fontFamily).toBe('serif');
    expect(style.fontWeight).toBe('700');
  });

  it('insere a foto no cursor, dividendo o no de texto', async () => {
    const ref = createRef<NoteBodyHandle>();
    const onChange = jest.fn();
    render(
      <NoteBody ref={ref} value="AB" onChangeMarkdown={onChange} typography={typography} />,
    );

    await focusEditor();
    fireEvent(screen.getByTestId('rich-editor'), 'selectionChange', {
      nativeEvent: { start: 1, end: 1, text: '' },
    });

    await settle(() => ref.current?.insertImage('file:///f.jpg', 'local:f.jpg', 'foto', 50));

    expect(onChange).toHaveBeenLastCalledWith('A\n![foto](local:f.jpg){w=50}\nB');
  });

  it('inserir a foto no fim nao perde o texto e deixa um editor embaixo', async () => {
    const ref = createRef<NoteBodyHandle>();
    const onChange = jest.fn();
    render(
      <NoteBody
        ref={ref}
        value="A"
        onChangeMarkdown={onChange}
        imageSources={{ 'local:f.jpg': 'file:///dados/f.jpg' }}
        typography={typography}
      />,
    );

    await focusEditor();
    fireEvent(screen.getByTestId('rich-editor'), 'selectionChange', {
      nativeEvent: { start: 1, end: 1, text: '' },
    });

    await settle(() => ref.current?.insertImage('file:///f.jpg', 'local:f.jpg', 'foto', 50));

    expect(onChange).toHaveBeenLastCalledWith('A\n![foto](local:f.jpg){w=50}\n');
    // O texto de cima continua la e o trecho debaixo da foto existe.
    expect((screen.getAllByTestId('rich-editor')[0].props.value as string)).toContain('A');
    expect(screen.getAllByTestId('rich-editor')).toHaveLength(2);
    expect(screen.getByLabelText('foto')).toBeTruthy();
  });

  it('da para digitar abaixo de uma imagem que veio do documento', async () => {
    const onChange = jest.fn();
    render(
      <NoteBody
        value={'A\n![foto](local:f.jpg)'}
        onChangeMarkdown={onChange}
        imageSources={{ 'local:f.jpg': 'file:///dados/f.jpg' }}
        typography={typography}
      />,
    );

    const editors = screen.getAllByTestId('rich-editor');
    expect(editors).toHaveLength(2);
    fireEvent.changeText(editors[1], 'B');
    await flushDebounce();

    expect(onChange).toHaveBeenLastCalledWith('A\n![foto](local:f.jpg)\nB');
  });

  it('mostra esqueleto e giro enquanto a foto carrega', async () => {
    const view = render(
      <NoteBody
        value={'![foto](local:f.jpg)'}
        onChangeMarkdown={jest.fn()}
        imageSources={{ 'local:f.jpg': 'file:///dados/f.jpg' }}
        imageLoading={{ 'local:f.jpg': true }}
        typography={typography}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('note-image-loading')).toBeTruthy();

    view.rerender(
      <NoteBody
        value={'![foto](local:f.jpg)'}
        onChangeMarkdown={jest.fn()}
        imageSources={{ 'local:f.jpg': 'file:///dados/f.jpg' }}
        imageLoading={{}}
        typography={typography}
      />,
    );
    fireEvent(screen.getByTestId('note-image'), 'loadEnd');

    expect(screen.queryByTestId('note-image-loading')).toBeNull();
  });

  it('foto sem arquivo local ainda ocupa o tamanho com esqueleto', () => {
    render(
      <NoteBody
        value={'![foto](local:f.jpg)'}
        onChangeMarkdown={jest.fn()}
        typography={typography}
      />,
    );

    expect(screen.getByTestId('note-image-skeleton')).toBeTruthy();
    expect(screen.getByTestId('note-image-loading')).toBeTruthy();
  });

  it('opcoes da foto: tamanhos e remover por ultimo, sem botoes sobre a imagem', () => {
    render(
      <NoteBody
        value={'A\n![foto](local:f.jpg){w=50}'}
        onChangeMarkdown={jest.fn()}
        typography={typography}
      />,
    );

    expect(screen.queryByLabelText('Redimensionar foto')).toBeNull();
    expect(screen.queryByLabelText('Remover foto')).toBeNull();

    fireEvent.press(screen.getByLabelText('Opções da foto'));
    // O menu abre com os tres tamanhos e o remover no fim. (O Alert do Android
    // so mostra tres botoes: por isso as opcoes sao um menu proprio.)
    expect(screen.getByText('Largura total')).toBeTruthy();
    expect(screen.getByText('Metade da largura')).toBeTruthy();
    expect(screen.getByText('Miniatura')).toBeTruthy();
    expect(screen.getByText('Remover foto')).toBeTruthy();
  });

  it('insere o audio entre dois trechos de texto', async () => {
    const ref = createRef<NoteBodyHandle>();
    const onChange = jest.fn();
    render(
      <NoteBody ref={ref} value="ABC" onChangeMarkdown={onChange} typography={typography} />,
    );

    await focusEditor();
    fireEvent(screen.getByTestId('rich-editor'), 'selectionChange', {
      nativeEvent: { start: 2, end: 2, text: '' },
    });

    await settle(() => ref.current?.insertAudio('local:a.aac', 3000));

    expect(onChange).toHaveBeenLastCalledWith('AB\n!audio[local:a.aac]{d=3}\nC');
    // O audio entrou no documento: o card dele aparece.
    expect(screen.getByLabelText('Tocar áudio')).toBeTruthy();
  });

  it('redimensiona a foto e devolve o markdown com a nova largura', async () => {
    const onChange = jest.fn();
    render(
      <NoteBody
        value={'A\n![foto](local:f.jpg){w=30}'}
        onChangeMarkdown={onChange}
        typography={typography}
      />,
    );

    fireEvent.press(screen.getByLabelText('Opções da foto'));
    await settle(() => fireEvent.press(screen.getByText('Metade da largura')));

    expect(onChange).toHaveBeenLastCalledWith('A\n![foto](local:f.jpg){w=50}');
  });

  it('nao remonta o trecho de texto ao redimensionar a foto', async () => {
    render(
      <NoteBody
        value={'A\n![foto](local:f.jpg){w=30}'}
        onChangeMarkdown={jest.fn()}
        typography={typography}
      />,
    );

    const before = screen.getAllByTestId('rich-editor')[0];
    fireEvent.press(screen.getByLabelText('Opções da foto'));
    await settle(() => fireEvent.press(screen.getByText('Metade da largura')));

    expect(screen.getAllByTestId('rich-editor')[0]).toBe(before);
  });

  it('remove a foto pela ultima opcao', async () => {
    const onChange = jest.fn();
    render(
      <NoteBody
        value={'A\n![foto](local:f.jpg){w=50}'}
        onChangeMarkdown={onChange}
        typography={typography}
      />,
    );

    fireEvent.press(screen.getByLabelText('Opções da foto'));
    await settle(() => fireEvent.press(screen.getByText('Remover foto')));

    expect(onChange).toHaveBeenLastCalledWith('A\n');
  });

  it('nao perde o texto pendente ao remover uma midia', async () => {
    const onChange = jest.fn();
    render(
      <NoteBody
        value={'A\n![foto](local:f.jpg){w=50}'}
        onChangeMarkdown={onChange}
        typography={typography}
      />,
    );

    fireEvent.changeText(screen.getAllByTestId('rich-editor')[0], '<p>A editado</p>');
    fireEvent.press(screen.getByLabelText('Opções da foto'));
    await settle(() => fireEvent.press(screen.getByText('Remover foto')));

    expect(onChange).toHaveBeenLastCalledWith('A editado\n');
  });

  it('mostra o progresso da transcricao abaixo do audio', () => {
    render(
      <NoteBody
        value={'A\n!audio[local:a.aac]{d=3}'}
        onChangeMarkdown={jest.fn()}
        ownAudioRefs={['local:a.aac']}
        transcribingPercent={83}
        typography={typography}
      />,
    );

    expect(screen.getByTestId('audio-transcribing')).toBeTruthy();
    expect(screen.getByText('Transcrevendo 83%')).toBeTruthy();
  });

  it('oferece transcrever o audio quando ha modelo e falta transcricao', () => {
    const onTranscribe = jest.fn();
    render(
      <NoteBody
        value={'A\n!audio[local:a.aac]{d=3}'}
        onChangeMarkdown={jest.fn()}
        ownAudioRefs={['local:a.aac']}
        canTranscribe
        onTranscribe={onTranscribe}
        typography={typography}
      />,
    );

    fireEvent.press(screen.getByLabelText('Transcrever áudio'));
    expect(onTranscribe).toHaveBeenCalledTimes(1);
  });

  it('para a transcricao pelo mesmo botao, mesmo em 0%', () => {
    const onStopTranscribe = jest.fn();
    render(
      <NoteBody
        value={'A\n!audio[local:a.aac]{d=3}'}
        onChangeMarkdown={jest.fn()}
        ownAudioRefs={['local:a.aac']}
        transcribingPercent={0}
        onStopTranscribe={onStopTranscribe}
        typography={typography}
      />,
    );

    expect(screen.getByText('Transcrevendo...')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Parar transcrição'));
    expect(onStopTranscribe).toHaveBeenCalledTimes(1);
  });

  it('nao mostra progresso quando nao ha transcricao rodando', () => {
    render(
      <NoteBody
        value={'A\n!audio[local:a.aac]{d=3}'}
        onChangeMarkdown={jest.fn()}
        typography={typography}
      />,
    );

    expect(screen.queryByTestId('audio-transcribing')).toBeNull();
  });

  it('remove o audio do documento depois da confirmacao', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onChange = jest.fn();
    render(
      <NoteBody
        value={'A\n!audio[local:a.aac]{d=3}'}
        onChangeMarkdown={onChange}
        typography={typography}
      />,
    );

    fireEvent.press(screen.getByLabelText('Remover áudio'));
    const remove = (alert.mock.calls[0]?.[2] as { style?: string; onPress?: () => void }[] | undefined)?.find(
      (button) => button.style === 'destructive',
    );
    await settle(() => remove?.onPress?.());

    expect(onChange).toHaveBeenLastCalledWith('A\n');
    alert.mockRestore();
  });

  it('informa a posicao do cursor para a gravacao entrar no lugar certo', async () => {
    const ref = createRef<NoteBodyHandle>();
    render(
      <NoteBody ref={ref} value="AB" onChangeMarkdown={jest.fn()} typography={typography} />,
    );

    await focusEditor();
    fireEvent(screen.getByTestId('rich-editor'), 'selectionChange', {
      nativeEvent: { start: 1, end: 1, text: '' },
    });

    expect(ref.current?.getInsertPosition()).toEqual({
      nodeId: 't0',
      offset: 1,
    });
  });

  it('aplica a formatacao no editor em foco', async () => {
    const ref = createRef<NoteBodyHandle>();
    render(
      <NoteBody
        ref={ref}
        value={'A\n![f](local:f.jpg)\nB'}
        onChangeMarkdown={jest.fn()}
        typography={typography}
      />,
    );

    await focusEditor(1);
    act(() => {
      ref.current?.format('bold');
      ref.current?.format('italic');
      ref.current?.format('strike');
      ref.current?.format('code');
      ref.current?.format('heading');
      ref.current?.format('list');
      ref.current?.format('ordered');
      ref.current?.format('quote');
    });

    expect(mockToggleBold).toHaveBeenCalled();
    expect(mockToggleItalic).toHaveBeenCalled();
    expect(mockToggleStrike).toHaveBeenCalled();
    expect(mockToggleCode).toHaveBeenCalled();
    expect(mockToggleH2).toHaveBeenCalled();
    expect(mockToggleList).toHaveBeenCalled();
    expect(mockToggleOrdered).toHaveBeenCalled();
    expect(mockToggleQuote).toHaveBeenCalled();
  });

  it('coloca o link no texto selecionado', async () => {
    const ref = createRef<NoteBodyHandle>();
    render(
      <NoteBody ref={ref} value="linha" onChangeMarkdown={jest.fn()} typography={typography} />,
    );

    await focusEditor();
    fireEvent(screen.getByTestId('rich-editor'), 'selectionChange', {
      nativeEvent: { start: 0, end: 5, text: 'linha' },
    });

    act(() => {
      ref.current?.insertLink('https://exemplo.test');
    });

    expect(mockSetLink).toHaveBeenCalledWith(0, 5, 'linha', 'https://exemplo.test');
  });

  it('reidrata quando o documento muda por fora', async () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <NoteBody value="A" onChangeMarkdown={onChange} typography={typography} />,
    );
    expect(screen.getAllByTestId('rich-editor')).toHaveLength(1);

    rerender(
      <NoteBody
        value={'A\n![foto](local:f.jpg){w=50}\nB\n!audio[local:a.aac]{d=3}\nC'}
        onChangeMarkdown={onChange}
        imageSources={{ 'local:f.jpg': 'file:///dados/f.jpg' }}
        typography={typography}
      />,
    );

    expect(screen.getAllByTestId('rich-editor')).toHaveLength(3);
    expect(screen.getByLabelText('foto')).toBeTruthy();
    expect(screen.getByLabelText('Tocar áudio')).toBeTruthy();
  });

  it('mostra a foto inline quando a fonte chega depois da abertura', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <NoteBody
        value="antes ![foto](local:a.jpg){w=50} depois"
        onChangeMarkdown={onChange}
        typography={typography}
      />,
    );

    expect(screen.getByTestId('rich-editor').props.value).not.toContain('file:///dados/a.jpg');

    rerender(
      <NoteBody
        value="antes ![foto](local:a.jpg){w=50} depois"
        onChangeMarkdown={onChange}
        imageSources={{ 'local:a.jpg': 'file:///dados/a.jpg' }}
        typography={typography}
      />,
    );

    expect(screen.getByTestId('rich-editor').props.value).toContain('file:///dados/a.jpg');
  });

  it('a linha em branco entre paragrafos fica dentro do mesmo editor', () => {
    render(
      <NoteBody
        value={'A\n\nB'}
        onChangeMarkdown={jest.fn()}
        typography={typography}
      />,
    );

    // O texto da nota e um editor so: a linha em branco e um paragrafo vazio
    // dentro dele (e nao um editor a parte).
    const editors = screen.getAllByTestId('rich-editor');
    expect(editors).toHaveLength(1);
    expect(editors[0].props.value).toBe('<html>\n<p>A</p>\n<br>\n<p>B</p>\n</html>');
  });

  it('preserva as linhas em branco no comeco e no fim do trecho', async () => {
    const onChange = jest.fn();
    render(
      <NoteBody value={'\nA\n'} onChangeMarkdown={onChange} typography={typography} />,
    );

    // O editor devolve o texto inteiro: as linhas em branco das pontas sao
    // quebras dentro dele.
    fireEvent.changeText(
      screen.getAllByTestId('rich-editor')[0],
      '<html>\n<br>\n<p>A novo</p>\n<br>\n</html>',
    );
    await flushDebounce();

    expect(onChange).toHaveBeenLastCalledWith('\nA novo\n');
  });

  it('nao remonta o trecho com o cursor ativo quando uma fonte chega', async () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <NoteBody
        value="antes ![foto](local:a.jpg){w=50} depois"
        onChangeMarkdown={onChange}
        typography={typography}
      />,
    );
    await focusEditor();
    const before = screen.getByTestId('rich-editor');
    rerender(
      <NoteBody
        value="antes ![foto](local:a.jpg){w=50} depois"
        onChangeMarkdown={onChange}
        imageSources={{ 'local:a.jpg': 'file:///dados/a.jpg' }}
        typography={typography}
      />,
    );

    expect(screen.getByTestId('rich-editor')).toBe(before);
  });

  it('o editor mostra o texto rico do trecho', () => {
    render(
      <NoteBody
        value={'**negrito** e *italico*'}
        onChangeMarkdown={jest.fn()}
        typography={typography}
      />,
    );

    const html = screen.getByTestId('rich-editor').props.value as string;
    expect(html).toContain('<b>negrito</b>');
    expect(html).toContain('<i>italico</i>');
  });

  it('foca o editor pedido pelo titulo', async () => {
    const ref = createRef<NoteBodyHandle>();
    render(
      <NoteBody ref={ref} value="linha" onChangeMarkdown={jest.fn()} typography={typography} />,
    );

    await act(async () => {
      ref.current?.focus();
      await Promise.resolve();
    });

    expect(mockFocus).toHaveBeenCalled();
  });

  it('preserva a foto inline antiga dentro do no de texto', () => {
    render(
      <NoteBody
        value="antes ![foto](local:a.jpg){w=50} depois"
        onChangeMarkdown={jest.fn()}
        imageSources={{ 'local:a.jpg': 'file:///dados/a.jpg' }}
        typography={typography}
      />,
    );

    const html = screen.getByTestId('rich-editor').props.value as string;
    expect(html).toContain('antes <img');
    expect(html).toContain('depois');
    expect(html.indexOf('antes')).toBeLessThan(html.indexOf('<img'));
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('depois'));
  });

  it('o texto da nota e um editor so (uma leitura por vez)', async () => {
    const onChange = jest.fn();
    render(
      <NoteBody
        value={'A\n\nB'}
        onChangeMarkdown={onChange}
        typography={typography}
      />,
    );

    // Um editor para o texto inteiro: o cursor sai do campo do Android e
    // ler o HTML duas vezes no mesmo editor quebra o campo.
    const editors = screen.getAllByTestId('rich-editor');
    expect(editors).toHaveLength(1);
    fireEvent.changeText(editors[0], '<html>\n<p>A novo</p>\n<br>\n<p>B novo</p>\n</html>');
    await flushDebounce();

    expect(onChange).toHaveBeenLastCalledWith('A novo\n\nB novo');
  });

  it('monta o documento inteiro na abertura, sem esqueleto', () => {
    // Paragrafo longo (cruza 60 linhas) seguido de 40 fotos: tudo entra no
    // primeiro frame. A nota nunca muda de aparencia depois de aberta.
    const intro = Array.from({ length: 70 }, (_, i) => `intro ${i}`).join('\n');
    const photos = Array.from({ length: 40 }, (_, i) => `![f](local:f${i}.jpg)`).join('\n');

    render(
      <NoteBody
        value={`${intro}\n${photos}`}
        onChangeMarkdown={jest.fn()}
        typography={typography}
      />,
    );

    // Cada midia divide o texto, entao sao 41 editores (o texto inicial e um
    // trecho vazio depois de cada foto): todos montam no primeiro frame.
    expect(screen.getAllByTestId('rich-editor')).toHaveLength(41);
    expect(screen.getAllByTestId('rich-editor')[0].props.value).toContain('intro 69');
    expect(screen.getAllByLabelText('Opções da foto')).toHaveLength(40);
    expect(screen.queryByTestId('note-body-skeleton')).toBeNull();
    expect(screen.queryByTestId('note-body-loading')).toBeNull();
  });
});
