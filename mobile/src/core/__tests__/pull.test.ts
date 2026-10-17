import { entryToRecording, isBlankServerEntry, recordingsDeletedOnServer } from '../pull';
import type { ServerEntry, ServerNote } from '../api';
import type { Recording } from '../types';

function recording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'r1',
    title: 'Nota',
    recordedAt: '2026-10-11T14:00:00Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    entryId: 'note_01J8Z',
    createdAt: '2026-10-11T14:00:00Z',
    updatedAt: '2026-10-11T14:00:00Z',
    ...overrides,
  };
}

const ENTRY: ServerEntry = {
  id: 'note_01J8Z',
  title: 'Minha nota',
  status: 'ready',
  source: 'text',
  original_filename: '',
  content_type: '',
  size_bytes: 0,
  duration_seconds: 0,
  recorded_at: null,
  created_at: '2026-10-11T14:00:00Z',
  updated_at: '2026-10-11T14:05:00Z',
};

describe('entryToRecording', () => {
  it('mapeia uma nota de texto como concluida e sem transcricao pendente', () => {
    const note: ServerNote = {
      id: 'n1',
      entry_id: ENTRY.id,
      title: 'Minha nota',
      document: [{ type: 'paragraph', content: [{ type: 'text', text: 'oi', styles: {} }] }],
      created_at: ENTRY.created_at,
      updated_at: ENTRY.updated_at,
    };
    const rec = entryToRecording(ENTRY, note);
    expect(rec.id).toBe('note_01J8Z');
    expect(rec.status).toBe('completed');
    expect(rec.entryId).toBe('note_01J8Z');
    expect(rec.noteId).toBe('n1');
    expect(rec.source).toBe('text');
    expect(rec.transcriptStatus).toBeUndefined();
    expect(rec.text).toBe('oi');
    expect(rec.recordedAt).toBe(ENTRY.created_at);
  });

  it('marca audio como microfone com transcricao pendente', () => {
    const rec = entryToRecording({ ...ENTRY, content_type: 'audio/aac' });
    expect(rec.source).toBe('microphone');
    expect(rec.contentType).toBe('audio/aac');
    expect(rec.transcriptStatus).toBe('pending');
    expect(rec.text).toBe('');
  });

  it('usa recorded_at quando presente', () => {
    const rec = entryToRecording({ ...ENTRY, recorded_at: '2026-10-10T09:00:00Z' });
    expect(rec.recordedAt).toBe('2026-10-10T09:00:00Z');
  });
});

describe('isBlankServerEntry', () => {
  const blank: ServerEntry = { ...ENTRY, title: '', content_type: '' };

  it('esconde entrada sem titulo, audio e corpo', () => {
    expect(isBlankServerEntry(blank)).toBe(true);
  });

  it('nao esconde quando ha titulo, audio ou corpo', () => {
    expect(isBlankServerEntry({ ...blank, title: 'Oi' })).toBe(false);
    expect(isBlankServerEntry({ ...blank, content_type: 'audio/aac' })).toBe(false);
    const note: ServerNote = {
      id: 'n1',
      entry_id: blank.id,
      title: '',
      document: [{ type: 'paragraph', content: [{ type: 'text', text: 'corpo', styles: {} }] }],
      created_at: blank.created_at,
      updated_at: blank.updated_at,
    };
    expect(isBlankServerEntry(blank, note)).toBe(false);
  });
});

describe('recordingsDeletedOnServer', () => {
  const deletedAfter = new Map([['en_b', '2026-10-12T10:00:00Z']]);

  it('devolve so as notas que o servidor confirma como apagadas', () => {
    const local = [
      recording({ id: 'a', entryId: 'en_a' }),
      recording({ id: 'b', entryId: 'en_b' }),
      recording({ id: 'c', entryId: 'en_c' }),
    ];
    expect(recordingsDeletedOnServer(local, deletedAfter).map((r) => r.id)).toEqual(['b']);
  });

  it('nao apaga por ausencia: a lista da lixeira manda', () => {
    const local = [recording({ id: 'a', entryId: 'en_a' })];
    // Servidor novo (ou banco restaurado): nada apagado conhecido, nada removido.
    expect(recordingsDeletedOnServer(local, new Map())).toEqual([]);
  });

  it('ignora notas que ainda nao subiram', () => {
    const local = [
      recording({ id: 'a', entryId: undefined, status: 'queued' }),
      recording({ id: 'b', entryId: undefined }),
    ];
    expect(recordingsDeletedOnServer(local, deletedAfter)).toEqual([]);
  });

  it('protege a nota restaurada de um backup de uma exclusao anterior', () => {
    // Restaurada agora; a exclusao no servidor e de ontem.
    const restored = recording({
      id: 'b',
      entryId: 'en_b',
      updatedAt: '2026-10-16T12:00:00Z',
    });
    expect(recordingsDeletedOnServer([restored], deletedAfter)).toEqual([]);
  });

  it('aceita a exclusao feita depois da restauracao', () => {
    const restored = recording({
      id: 'b',
      entryId: 'en_b',
      updatedAt: '2026-10-11T12:00:00Z',
    });
    expect(recordingsDeletedOnServer([restored], deletedAfter).map((r) => r.id)).toEqual(['b']);
  });
});
