import { resolveLocalAttachmentRefs, resolveLocalAudioRefs } from '../attachments';
import {
  MAX_TEXT_CHARS,
  insertNoteNode,
  parseNoteDocument,
  removeNoteNode,
  serializeNoteDocument,
  type NoteAudioNode,
  type NoteImageNode,
  type NoteTextNode,
} from '../noteDocument';
import { syncNoteWith, type NoteSyncApi } from '../noteSync';
import type { Recording } from '../types';

const image: NoteImageNode = {
  kind: 'image',
  id: 'insert',
  ref: 'local:foto.jpg',
  alt: 'foto',
  width: 50,
};

const audio: NoteAudioNode = {
  kind: 'audio',
  id: 'insert',
  ref: 'local:audio.aac',
  durationMs: 12_500,
};

/** Servidor falso: guarda o markdown do corpo e devolve versao nova. */
class FakeServer implements NoteSyncApi {
  body = '';
  bodyVersion = 'v1';

  updateEntry = jest.fn(async () => ({
    title: 'titulo',
    recorded_at: '2026-10-20T10:00:00Z',
  }));

  setEntryTags = jest.fn(async () => undefined);

  listNotes = jest.fn(async () => [
    { id: 'note-1', body_version: this.bodyVersion, content_markdown: this.body },
  ]);

  createNote = jest.fn(async (_entryId: string, _title: string, markdown: string) => {
    this.body = markdown;
    return { id: 'note-1', body_version: 'v1' };
  });

  updateNote = jest.fn(async (_id: string, markdown: string) => {
    this.body = markdown;
    this.bodyVersion = 'v2';
    return this.bodyVersion;
  });
}

const note = (text: string): Recording => ({
  id: 'local-1',
  title: 'titulo',
  text,
  recordedAt: '2026-10-20T10:00:00Z',
  dir: 'file:///notas/local-1',
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

describe('nota com texto, foto e audio', () => {
  it('salva, reabre e sincroniza mantendo ordem, formatacao e tres elementos', async () => {
    // Digitacao: A, foto no meio, B, audio entre B e C.
    let markdown = 'ABC';
    markdown = insertNoteNode(markdown, image, { nodeId: 't0', offset: 1 });
    markdown = insertNoteNode(markdown, audio, { nodeId: 't2', offset: 1 });

    // Fechar e reabrir: o parser devolve os mesmos nos na mesma ordem.
    const reopened = parseNoteDocument(markdown);
    expect(reopened.map((node) => node.kind)).toEqual([
      'text',
      'image',
      'text',
      'audio',
      'text',
    ]);
    expect((reopened[0] as NoteTextNode).markdown).toBe('A');
    expect((reopened[1] as NoteImageNode).ref).toBe('local:foto.jpg');
    expect((reopened[2] as NoteTextNode).markdown).toBe('B');
    expect((reopened[3] as NoteAudioNode).ref).toBe('local:audio.aac');
    expect((reopened[4] as NoteTextNode).markdown).toBe('C');
    expect(serializeNoteDocument(reopened)).toBe(markdown);

    // Sincronizacao: sobe os anexos locais e guarda o markdown canonico.
    const server = new FakeServer();
    const resolve = async (value: Recording) => {
      const images = await resolveLocalAttachmentRefs(
        value.text ?? '',
        {},
        async () => 'at_image_1',
      );
      const audios = await resolveLocalAudioRefs(
        images.markdown,
        images.attachments,
        async () => 'at_audio_1',
      );
      return {
        markdown: audios.markdown,
        attachments: audios.attachments,
        pending: [...images.pending, ...audios.pending],
      };
    };

    await syncNoteWith(server, note(markdown), resolve);

    expect(server.body).toContain('![foto](attachment:at_image_1){w=50}');
    expect(server.body).toContain('!audio[attachment:at_audio_1]{d=12.5}');

    // Reabrir do servidor: mesmos tres elementos, mesma ordem.
    const fromServer = parseNoteDocument(server.body);
    expect(fromServer.map((node) => node.kind)).toEqual([
      'text',
      'image',
      'text',
      'audio',
      'text',
    ]);
    expect((fromServer[1] as NoteImageNode).ref).toBe('attachment:at_image_1');
    expect((fromServer[3] as NoteAudioNode).ref).toBe('attachment:at_audio_1');
    expect((fromServer[4] as NoteTextNode).markdown).toBe('C');
  });

  it('remove a foto e leva ao servidor o corpo sem ela', async () => {
    const markdown = 'A\n![foto](attachment:at_image){w=50}\nB\n!audio[attachment:at_audio]{d=3}\nC';
    const withoutImage = removeNoteNode(markdown, 'i1');

    const server = new FakeServer();
    await syncNoteWith(server, note(withoutImage), async (value) => ({
      markdown: value.text ?? '',
      attachments: {},
      pending: [],
    }));

    expect(server.body).toBe('A\nB\n!audio[attachment:at_audio]{d=3}\nC');
    expect(parseNoteDocument(server.body).map((node) => node.kind)).toEqual([
      'text',
      'audio',
      'text',
    ]);
  });

  it('preserva a formatacao do trecho que fica entre foto e audio', () => {
    const markdown = 'A\n![foto](local:foto.jpg){w=50}\n**B**\n!audio[local:audio.aac]{d=1}\nC';
    const nodes = parseNoteDocument(markdown);

    expect((nodes[2] as NoteTextNode).markdown).toBe('**B**');
    expect(serializeNoteDocument(nodes)).toBe(markdown);
  });

  it('nota longa e um no so (um editor so), sem perder texto', () => {
    const markdown = Array.from({ length: 80 }, (_value, index) => `paragrafo ${index + 1}`).join(
      '\n\n',
    );
    const nodes = parseNoteDocument(markdown);

    // O texto inteiro e um no: e o que mantem um editor so na nota.
    expect(nodes).toHaveLength(1);
    const texts = nodes.filter((node): node is NoteTextNode => node.kind === 'text');
    expect(texts).toHaveLength(nodes.length);
    for (const node of texts) {
      expect(node.markdown.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    }
    expect(serializeNoteDocument(nodes)).toBe(markdown);
  });
});
