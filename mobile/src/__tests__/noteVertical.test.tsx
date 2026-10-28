import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';

import { NoteBody, type NoteBodyHandle } from '@/components/NoteBody';
import { resolveLocalAttachmentRefs, resolveLocalAudioRefs } from '@/core/attachments';
import { parseNoteDocument, type NoteAudioNode, type NoteImageNode } from '@/core/noteDocument';
import { syncNoteWith, type NoteSyncApi } from '@/core/noteSync';
import type { Recording } from '@/core/types';

const typography = { family: 'system', size: 17, weight: 'regular' } as const;

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
      const [value, setValue] = React.useState(props.defaultValue ?? '');
      const html = React.useRef(props.defaultValue ?? '');
      React.useImperativeHandle(ref, () => ({
        focus: jest.fn(),
        getHTML: async () => html.current,
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
        value,
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
        placeholder: props.placeholder,
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

const settle = async (task: () => void) => {
  await act(async () => {
    task();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const entry = (text: string): Recording => ({
  id: 'nota-local',
  title: 'Diario',
  text,
  recordedAt: '2026-10-20T10:00:00Z',
  dir: 'file:///notas/nota-local',
  segmentCount: 0,
  status: 'completed',
  offset: 0,
  attempts: 0,
  entryId: 'entry-1',
  noteId: 'note-1',
  bodyVersion: 'v1',
  source: 'text',
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
});

class Server implements NoteSyncApi {
  body = '';
  updateEntry = jest.fn(async () => ({ title: 'Diario', recorded_at: '2026-10-20T10:00:00Z' }));
  setEntryTags = jest.fn(async () => undefined);
  listNotes = jest.fn(async () => [
    { id: 'note-1', body_version: 'v1', content_markdown: this.body },
  ]);
  createNote = jest.fn(async (_entryId: string, _title: string, markdown: string) => {
    this.body = markdown;
    return { id: 'note-1', body_version: 'v1' };
  });
  updateNote = jest.fn(async (_id: string, markdown: string) => {
    this.body = markdown;
    return 'v2';
  });
}

describe('fluxo vertical da nota', () => {
  it('texto, foto e audio intercalados sobrevivem a reabertura e ao servidor', async () => {
    let saved = 'ABC';
    const ref = createRef<NoteBodyHandle>();

    const first = render(
      <NoteBody
        ref={ref}
        value={saved}
        onChangeMarkdown={(markdown) => {
          saved = markdown;
        }}
        typography={typography}
      />,
    );

    // Foto no meio de "ABC": A | foto | BC.
    fireEvent(screen.getByTestId('rich-editor'), 'focus');
    fireEvent(screen.getByTestId('rich-editor'), 'selectionChange', {
      nativeEvent: { start: 1, end: 1, text: '' },
    });
    await settle(() =>
      ref.current?.insertImage('file:///foto.jpg', 'local:foto.jpg', 'foto', 50),
    );
    expect(saved).toBe('A\n![foto](local:foto.jpg){w=50}\nBC');

    // Audio entre B e C: o trecho "BC" e o segundo editor.
    fireEvent(screen.getAllByTestId('rich-editor')[1], 'focus');
    fireEvent(screen.getAllByTestId('rich-editor')[1], 'selectionChange', {
      nativeEvent: { start: 1, end: 1, text: '' },
    });
    await settle(() => ref.current?.insertAudio('local:audio.aac', 12_500));
    expect(saved).toBe(
      'A\n![foto](local:foto.jpg){w=50}\nB\n!audio[local:audio.aac]{d=12.5}\nC',
    );

    // Fechar e reabrir: os tres elementos continuam na mesma ordem.
    first.unmount();
    render(
      <NoteBody
        value={saved}
        onChangeMarkdown={jest.fn()}
        imageSources={{ 'local:foto.jpg': 'file:///foto.jpg' }}
        typography={typography}
      />,
    );
    // Reaberta, os trechos voltam a ser editores, na mesma ordem.
    expect(screen.getAllByTestId('rich-editor').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('foto')).toBeTruthy();
    expect(screen.getByLabelText('Tocar áudio')).toBeTruthy();

    // Sincronizar: os anexos locais viram referencias do servidor.
    const server = new Server();
    await syncNoteWith(server, entry(saved), async (note) => {
      const images = await resolveLocalAttachmentRefs(
        note.text ?? '',
        {},
        async () => 'at_foto',
      );
      const audios = await resolveLocalAudioRefs(
        images.markdown,
        images.attachments,
        async () => 'at_audio',
      );
      return {
        markdown: audios.markdown,
        attachments: audios.attachments,
        pending: [...images.pending, ...audios.pending],
      };
    });

    expect(server.body).toBe(
      'A\n![foto](attachment:at_foto){w=50}\nB\n!audio[attachment:at_audio]{d=12.5}\nC',
    );

    // Reabrir do servidor: mesmos tres elementos.
    const fromServer = parseNoteDocument(server.body);
    expect(fromServer.map((node) => node.kind)).toEqual([
      'text',
      'image',
      'text',
      'audio',
      'text',
    ]);
    expect((fromServer[1] as NoteImageNode).ref).toBe('attachment:at_foto');
    expect((fromServer[3] as NoteAudioNode).ref).toBe('attachment:at_audio');

    // Nota longa: o texto e um editor so. Um editor por paragrafo fazia o
    // campo ser desmontado e remontado a cada troca de paragrafo (e o
    // corpo inteiro pagar o preco do layout a cada tecla).
    const long = Array.from({ length: 200 }, (_value, index) => `paragrafo ${index + 1}`).join(
      '\n\n',
    );
    render(<NoteBody value={long} onChangeMarkdown={jest.fn()} typography={typography} />);
    expect(screen.getAllByTestId('rich-editor').length).toBe(1);
  });
});
