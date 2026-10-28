import {
  appendAudioNodes,
  attachAudioToNote,
  audioNodesForNote,
  audioRefFromPath,
  canFreeLocalAudio,
  noteBodyWithAudio,
  withUploadedAudio,
  type AudioAttachment,
} from '../noteAudio';
import { noteAudioNodes } from '../noteDocument';
import type { Recording } from '../types';

const note = (over: Partial<Recording> = {}): Recording => ({
  id: 'note-1',
  title: 'Nota',
  text: 'AB',
  recordedAt: '2026-10-20T10:00:00Z',
  dir: 'file:///notas/note-1',
  segmentCount: 0,
  status: 'draft',
  offset: 0,
  attempts: 0,
  source: 'text',
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  ...over,
});

const audio = (over: Partial<AudioAttachment> = {}): AudioAttachment => ({
  ref: 'local:audio_1.aac',
  filePath: 'file:///notas/note-1/audio_1.aac',
  durationMs: 12_500,
  sizeBytes: 2048,
  ...over,
});

describe('audioRefFromPath', () => {
  it('vira uma referencia local com o nome do arquivo', () => {
    expect(audioRefFromPath('file:///notas/n1/audio_rec_1.aac')).toBe('local:audio_rec_1.aac');
  });

  it('devolve undefined sem caminho', () => {
    expect(audioRefFromPath(undefined)).toBeUndefined();
    expect(audioRefFromPath('')).toBeUndefined();
  });
});

describe('withUploadedAudio', () => {
  it('troca o marcador local pelo anexo e guarda o mapa do upload', () => {
    const updated = withUploadedAudio(
      note({
        text: 'A\n!audio[local:audio-1.aac]{d=5}\nB',
        filePath: 'file:///notas/note-1/audio-1.aac',
        status: 'completed',
      }),
      'at_audio_1',
    );

    expect(updated.text).toBe('A\n!audio[attachment:at_audio_1]{d=5}\nB');
    expect(updated.attachments).toEqual({ 'audio-1.aac': 'at_audio_1' });
  });

  it('sem audio local no documento nao inventa marcador', () => {
    const original = note({ text: 'so texto' });
    expect(withUploadedAudio(original, 'at_audio_1').text).toBe('so texto');
  });
});

describe('audioNodesForNote', () => {
  it('migra o audio local antigo para um no do documento', () => {
    expect(
      audioNodesForNote(
        note({
          filePath: 'file:///notas/note-1/recording.aac',
          durationMs: 5000,
        }),
      ),
    ).toEqual([{ ref: 'local:recording.aac', durationMs: 5000 }]);
  });

  it('mantem o arquivo local como fonte mesmo com anexo no servidor', () => {
    expect(
      audioNodesForNote(
        note({
          filePath: 'file:///notas/note-1/recording.aac',
          durationMs: 5000,
          serverAttachmentId: 'at_1',
        }),
      ),
    ).toEqual([{ ref: 'local:recording.aac', durationMs: 5000 }]);
  });

  it('nao mexe na pilha somente do servidor (dashboard continua dono dela)', () => {
    expect(
      audioNodesForNote(
        note({
          serverAudios: [
            { id: 'at_1', content_type: 'audio/aac', size_bytes: 1, duration_seconds: 3, created_at: '' },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('nao inventa no para nota sem audio', () => {
    expect(audioNodesForNote(note())).toEqual([]);
  });
});

describe('appendAudioNodes', () => {
  it('acrescenta os audios no fim, na ordem', () => {
    const markdown = appendAudioNodes('texto', [
      { ref: 'local:a.aac', durationMs: 3000 },
      { ref: 'attachment:at_2', durationMs: 4000 },
    ]);

    expect(markdown).toBe(
      'texto\n!audio[local:a.aac]{d=3}\n!audio[attachment:at_2]{d=4}\n',
    );
    expect(noteAudioNodes(markdown).map((node) => node.ref)).toEqual([
      'local:a.aac',
      'attachment:at_2',
    ]);
  });
});

describe('noteBodyWithAudio', () => {
  it('migra o audio legado para o fim do corpo', () => {
    const legacy = note({
      filePath: 'file:///notas/note-1/recording.aac',
      durationMs: 5000,
    });

    expect(noteBodyWithAudio(legacy)).toBe('AB\n!audio[local:recording.aac]{d=5}\n');
  });

  it('nao duplica o marcador quando o documento ja tem audio', () => {
    const stored = 'A\n!audio[local:a.aac]{d=3}\nB';
    const migrated = note({
      text: stored,
      filePath: 'file:///notas/note-1/a.aac',
      durationMs: 3000,
    });

    expect(noteBodyWithAudio(migrated)).toBe(stored);
  });

  it('devolve o mesmo corpo nas duas chamadas e acompanha a nova identidade', () => {
    const legacy = note({
      filePath: 'file:///notas/note-1/recording.aac',
      durationMs: 5000,
    });
    expect(noteBodyWithAudio(legacy)).toBe(noteBodyWithAudio(legacy));

    const edited = { ...legacy, text: 'novo' };
    expect(noteBodyWithAudio(edited)).toBe('novo\n!audio[local:recording.aac]{d=5}\n');
  });

  it('recalcula quando o mesmo objeto e editado no lugar', () => {
    const legacy = note({
      filePath: 'file:///notas/note-1/a.aac',
      durationMs: 3000,
    });
    expect(noteBodyWithAudio(legacy)).toBe('AB\n!audio[local:a.aac]{d=3}\n');

    legacy.text = 'CD';
    expect(noteBodyWithAudio(legacy)).toBe('CD\n!audio[local:a.aac]{d=3}\n');
  });

  it('sem audio legado devolve o texto salvo intacto', () => {
    expect(noteBodyWithAudio(note({ text: 'so texto' }))).toBe('so texto');
  });
});

describe('canFreeLocalAudio', () => {
  it('libera quando todos os audios do corpo ja estao no servidor', () => {
    expect(
      canFreeLocalAudio(
        note({
          status: 'completed',
          entryId: 'entry-1',
          text: 'A\n!audio[attachment:at_1]{d=3}\nB',
        }),
      ),
    ).toBe(true);
  });

  it('nao libera audio local que ainda nao subiu', () => {
    expect(
      canFreeLocalAudio(
        note({
          status: 'completed',
          entryId: 'entry-1',
          text: 'A\n!audio[local:a.aac]{d=3}\nB',
        }),
      ),
    ).toBe(false);
  });

  it('nao libera enquanto a nota tem edicao pendente', () => {
    expect(
      canFreeLocalAudio(
        note({
          status: 'completed',
          entryId: 'entry-1',
          noteDirty: true,
          text: 'A\n!audio[attachment:at_1]{d=3}\nB',
        }),
      ),
    ).toBe(false);
  });
});

describe('attachAudioToNote', () => {
  it('insere o audio como no do documento na posicao do cursor', () => {
    const updated = attachAudioToNote(note(), audio(), { nodeId: 't0', offset: 1 });

    expect(updated.text).toBe('A\n!audio[local:audio_1.aac]{d=12.5}\nB');
  });

  it('sem posicao, acrescenta o audio no fim da nota', () => {
    const updated = attachAudioToNote(note(), audio());
    expect(updated.text).toBe('AB\n!audio[local:audio_1.aac]{d=12.5}\n');
  });

  it('na nota nova guarda o arquivo para o envio criar a entrada', () => {
    const updated = attachAudioToNote(note(), audio());

    expect(updated.filePath).toBe('file:///notas/note-1/audio_1.aac');
    expect(updated.sizeBytes).toBe(2048);
    expect(updated.durationMs).toBe(12_500);
    expect(updated.source).toBe('microphone');
    expect(updated.status).toBe('draft');
  });

  it('na nota ja sincronizada mantem o audio original e marca o corpo sujo', () => {
    const updated = attachAudioToNote(
      note({
        status: 'completed',
        entryId: 'entry-1',
        filePath: 'file:///notas/note-1/audio_0.aac',
        sizeBytes: 999,
        durationMs: 5_000,
        noteDirty: undefined,
      }),
      audio(),
    );

    expect(updated.filePath).toBe('file:///notas/note-1/audio_0.aac');
    expect(updated.sizeBytes).toBe(999);
    expect(updated.durationMs).toBe(5_000);
    expect(updated.noteDirty).toBe(true);
    expect(updated.text).toContain('!audio[local:audio_1.aac]{d=12.5}');
  });

  it('preserva a transcricao ja existente da nota', () => {
    const updated = attachAudioToNote(
      note({ transcript: 'fala anterior', transcriptStatus: 'ready', hasTranscript: true }),
      audio(),
    );

    expect(updated.transcript).toBe('fala anterior');
    expect(updated.transcriptStatus).toBe('ready');
    expect(updated.hasTranscript).toBe(true);
  });

  it('atualiza updatedAt para a fila reconhecer a edicao', () => {
    const updated = attachAudioToNote(note(), audio());
    expect(updated.updatedAt).not.toBe('2026-10-20T10:00:00Z');
  });
});
