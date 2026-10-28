import { buildDraftNote, buildTextNote, isBlankDraft, noteHasContent } from '../note';
import { needsNoteSync } from '../types';

const NOW = new Date('2026-10-10T22:00:00.000Z');

describe('buildTextNote', () => {
  it('monta uma nota de texto na fila', () => {
    const note = buildTextNote({
      id: 'note_1',
      title: 'Minha nota',
      text: '  conteudo da nota  ',
      now: NOW,
    });
    expect(note.source).toBe('text');
    expect(note.status).toBe('queued');
    expect(note.text).toBe('conteudo da nota');
    expect(note.title).toBe('Minha nota');
    expect(note.filePath).toBeUndefined();
    expect(note.offset).toBe(0);
    // O texto e o proprio conteudo: nao ha transcricao a esperar.
    expect(note.transcript).toBe('conteudo da nota');
    expect(note.transcriptStatus).toBe('ready');
    expect(note.recordedAt).toBe(NOW.toISOString());
  });

  it('usa um titulo seguro quando vazio', () => {
    const note = buildTextNote({ id: 'note_2', title: '   ', text: 'x', now: NOW });
    expect(note.title).toBe('Nota');
  });

  it('preserva a data do evento quando informada', () => {
    const note = buildTextNote({
      id: 'note_3',
      title: 'Antiga',
      text: 'x',
      recordedAt: '2023-05-01T10:00:00.000Z',
      now: NOW,
    });
    expect(note.recordedAt).toBe('2023-05-01T10:00:00.000Z');
  });
});

describe('buildDraftNote', () => {
  it('cria um rascunho vazio que nao entra na fila', () => {
    const note = buildDraftNote({ id: 'note_d', now: NOW });
    expect(note.status).toBe('draft');
    expect(note.source).toBe('text');
    expect(note.text).toBe('');
    expect(note.filePath).toBeUndefined();
    // Nota nova abre com o titulo vazio, esperando o usuario escrever.
    expect(note.title).toBe('');
  });
});

describe('isBlankDraft', () => {
  it('esconde um rascunho sem titulo, texto e audio', () => {
    expect(isBlankDraft(buildDraftNote({ id: 'note_v', now: NOW }))).toBe(true);
  });

  it('mostra o rascunho assim que ganha titulo, texto ou audio', () => {
    const draft = buildDraftNote({ id: 'note_v', now: NOW });
    expect(isBlankDraft({ ...draft, title: 'Oi' })).toBe(false);
    expect(isBlankDraft({ ...draft, text: 'corpo' })).toBe(false);
    expect(isBlankDraft({ ...draft, filePath: '/audio.aac' })).toBe(false);
  });

  it('nunca esconde notas ja enviadas', () => {
    const draft = buildDraftNote({ id: 'note_v', now: NOW });
    expect(isBlankDraft({ ...draft, status: 'completed' })).toBe(false);
  });
});

describe('noteHasContent', () => {
  it('detecta texto ou audio', () => {
    expect(noteHasContent(buildDraftNote({ id: 'a', now: NOW }))).toBe(false);
    expect(noteHasContent({ ...buildDraftNote({ id: 'b', now: NOW }), text: 'oi' })).toBe(true);
    expect(noteHasContent({ ...buildDraftNote({ id: 'c', now: NOW }), filePath: 'x.aac' })).toBe(
      true,
    );
  });
});

describe('needsNoteSync', () => {
  const sent = {
    ...buildTextNote({ id: 'n', title: 't', text: 'x', now: NOW }),
    status: 'completed' as const,
    entryId: 'en_1',
  };

  it('pede sync quando a nota enviada foi editada', () => {
    expect(needsNoteSync({ ...sent, noteDirty: true })).toBe(true);
  });

  it('nao pede sync sem edicao, sem entrada ou fora de completed', () => {
    expect(needsNoteSync(sent)).toBe(false);
    expect(needsNoteSync({ ...sent, noteDirty: true, entryId: undefined })).toBe(false);
    expect(needsNoteSync({ ...buildDraftNote({ id: 'd', now: NOW }), noteDirty: true })).toBe(
      false,
    );
  });
});
