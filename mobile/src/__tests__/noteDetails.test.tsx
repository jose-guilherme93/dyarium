import { fireEvent, render, screen } from '@testing-library/react-native';

import { NoteBody } from '@/components/NoteBody';

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

jest.mock('react-native-enriched-html', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text, TextInput } = require('react-native');
  return {
    EnrichedText: ({ children }: { children: string }) => React.createElement(Text, null, children),
    EnrichedTextInput: React.forwardRef(function FakeEditor(props: any, ref: any) {
      React.useImperativeHandle(ref, () => ({
        focus: jest.fn(),
        getHTML: async () => props.defaultValue ?? '',
        toggleBold: jest.fn(),
        toggleItalic: jest.fn(),
        toggleStrikeThrough: jest.fn(),
        toggleInlineCode: jest.fn(),
        toggleH2: jest.fn(),
        toggleUnorderedList: jest.fn(),
        toggleOrderedList: jest.fn(),
        toggleBlockQuote: jest.fn(),
        setLink: jest.fn(),
      }));
      return React.createElement(TextInput, {
        testID: 'rich-editor',
        defaultValue: props.defaultValue,
      });
    }),
  };
});

jest.mock('@/services/imageRatios', () => ({
  cachedImageRatio: () => undefined,
  imageRatio: () => 4 / 3,
  measureImageRatio: async () => 4 / 3,
  rememberImageRatio: jest.fn(),
}));

describe('NoteDetails render', () => {
  it('mostra o resumo e alterna o corpo ao tocar', () => {
    const value = ':::details Detalhes técnicos\n- item: detalhe\n:::';
    render(<NoteBody value={value} onChangeMarkdown={jest.fn()} />);

    expect(screen.getByTestId('note-details')).toBeTruthy();
    expect(screen.getByText('Detalhes técnicos')).toBeTruthy();
    expect(screen.queryByTestId('note-details-body')).toBeNull();

    fireEvent.press(screen.getByText('Detalhes técnicos'));
    expect(screen.getByTestId('note-details-body')).toBeTruthy();
    expect(screen.getByText('- item: detalhe')).toBeTruthy();
  });

  it('inicia aberto quando open', () => {
    const value = ':::details open Detalhes técnicos\n- item\n:::';
    render(<NoteBody value={value} onChangeMarkdown={jest.fn()} />);
    expect(screen.getByTestId('note-details-body')).toBeTruthy();
  });
});