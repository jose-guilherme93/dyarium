import { entryToRecording, isBlankServerEntry } from '../pull';
import type { ServerEntry, ServerNote } from '../api';

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
