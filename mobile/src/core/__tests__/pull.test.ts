import { entryToRecording, isBlankServerEntry, mergeServerNote, recordingsDeletedOnServer } from '../pull';
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
      content_markdown: 'oi',
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

  it('traz duracao e tamanho do servidor, para a nota nao abrir como 0:00', () => {
    const rec = entryToRecording({
      ...ENTRY,
      content_type: 'audio/aac',
      duration_seconds: 12.5,
      size_bytes: 20480,
    });
    expect(rec.durationMs).toBe(12500);
    expect(rec.sizeBytes).toBe(20480);
  });

  it('nota de texto nao ganha duracao nem tamanho inventados', () => {
    const rec = entryToRecording({ ...ENTRY, duration_seconds: 0, size_bytes: 0 });
    expect(rec.durationMs).toBeUndefined();
    expect(rec.sizeBytes).toBeUndefined();
  });

  it('traz o arquivamento do servidor', () => {
    expect(entryToRecording({ ...ENTRY, archived: true }).archived).toBe(true);
    expect(entryToRecording({ ...ENTRY, archived: false }).archived).toBe(false);
  });

  it('usa recorded_at quando presente', () => {
    const rec = entryToRecording({ ...ENTRY, recorded_at: '2026-10-10T09:00:00Z' });
    expect(rec.recordedAt).toBe('2026-10-10T09:00:00Z');
  });

  it('traz o markdown do servidor sem converter nada', () => {
    const markdown = '## Secao\n\nparagrafo\n\n- item\n\n![foto](attachment:at_1){w=50}\n';
    const note: ServerNote = {
      id: 'n1',
      entry_id: ENTRY.id,
      title: '',
      content_markdown: markdown,
      created_at: ENTRY.created_at,
      updated_at: ENTRY.updated_at,
    };
    expect(entryToRecording(ENTRY, note).text).toBe(markdown);
  });

  it('guarda a versao de cada campo, para o servidor detectar conflito', () => {
    const note: ServerNote = {
      id: 'n1',
      entry_id: ENTRY.id,
      title: '',
      content_markdown: 'oi',
      body_version: '2026-10-16T10:00:00.5Z',
      created_at: ENTRY.created_at,
      updated_at: ENTRY.updated_at,
    };
    const entry: ServerEntry = {
      ...ENTRY,
      versions: { title: 'v-titulo', recorded_at: 'v-data' },
    };
    const rec = entryToRecording(entry, note);
    expect(rec.titleVersion).toBe('v-titulo');
    expect(rec.recordedAtVersion).toBe('v-data');
    expect(rec.bodyVersion).toBe('2026-10-16T10:00:00.5Z');
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
      content_markdown: 'corpo',
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

describe('mergeServerNote', () => {
  const serverEntry = (over: Partial<ServerEntry> = {}): ServerEntry => ({
    ...ENTRY,
    archived: false,
    versions: { title: 't1', recorded_at: 'r1', body: 'b1' },
    ...over,
  });

  const serverNote = (over: Partial<ServerNote> = {}): ServerNote => ({
    id: 'n1',
    entry_id: ENTRY.id,
    title: '',
    content_markdown: 'texto do servidor',
    body_version: 'b1',
    created_at: '2026-10-11T14:00:00Z',
    updated_at: '2026-10-11T14:05:00Z',
    ...over,
  });

  const clean = (over: Partial<Recording> = {}): Recording =>
    recording({
      title: 'titulo local',
      text: 'texto local',
      titleVersion: 't1',
      recordedAtVersion: 'r1',
      bodyVersion: 'b1',
      ...over,
    });

  it('aplica a edicao do dashboard no corpo', () => {
    const local = clean();
    const merged = mergeServerNote(
      local,
      serverEntry({ versions: { title: 't1', recorded_at: 'r1', body: 'b2' } }),
      serverNote({ body_version: 'b2', content_markdown: 'texto novo' }),
    );
    expect(merged?.text).toBe('texto novo');
    expect(merged?.bodyVersion).toBe('b2');
    expect(merged?.title).toBe('titulo local');
  });

  it('aplica titulo, data e arquivamento sem tocar no corpo', () => {
    const local = clean();
    const merged = mergeServerNote(
      local,
      serverEntry({
        title: 'titulo do dashboard',
        recorded_at: '2026-10-12T10:00:00Z',
        archived: true,
        versions: { title: 't2', recorded_at: 'r2', body: 'b1' },
      }),
      undefined,
    );
    expect(merged?.title).toBe('titulo do dashboard');
    expect(merged?.recordedAt).toBe('2026-10-12T10:00:00Z');
    expect(merged?.archived).toBe(true);
    expect(merged?.text).toBe('texto local');
  });

  it('nota com edicao pendente so perde para o servidor se ele gravou depois', () => {
    const local = clean({ noteDirty: true, updatedAt: '2026-10-11T14:00:00Z' });

    // Servidor gravou antes da edicao local: o celular manda.
    const older = mergeServerNote(
      local,
      serverEntry({ versions: { title: 't1', recorded_at: 'r1', body: '2026-10-11T13:00:00Z' } }),
      serverNote({ body_version: '2026-10-11T13:00:00Z', content_markdown: 'servidor antigo' }),
    );
    expect(older).toBeNull();

    // Servidor gravou depois: a ultima edicao vence e a pendencia local acaba.
    const newer = mergeServerNote(
      local,
      serverEntry({ versions: { title: 't1', recorded_at: 'r1', body: '2026-10-11T15:00:00Z' } }),
      serverNote({ body_version: '2026-10-11T15:00:00Z', content_markdown: 'servidor novo' }),
    );
    expect(newer?.text).toBe('servidor novo');
    expect(newer?.noteDirty).toBeUndefined();
  });

  it('nota suja com o mesmo texto do servidor limpa a pendencia sem enviar nada', () => {
    const local = clean({
      noteDirty: true,
      text: 'mesmo texto',
      updatedAt: '2026-10-11T16:20:00Z',
    });
    const merged = mergeServerNote(
      local,
      serverEntry({ versions: { title: 't1', recorded_at: 'r1', body: '2026-10-11T16:10:00Z' } }),
      serverNote({ body_version: '2026-10-11T16:10:00Z', content_markdown: 'mesmo texto\n' }),
    );
    expect(merged?.noteDirty).toBeUndefined();
    expect(merged?.bodyVersion).toBe('2026-10-11T16:10:00Z');
  });

  it('conflito aberto e resolvido pelo servidor quando ele gravou depois', () => {
    const local = clean({
      syncConflict: ['body'],
      noteDirty: true,
      updatedAt: '2026-10-11T14:00:00Z',
    });
    const merged = mergeServerNote(
      local,
      serverEntry({ versions: { title: 't1', recorded_at: 'r1', body: '2026-10-11T15:00:00Z' } }),
      serverNote({ body_version: '2026-10-11T15:00:00Z', content_markdown: 'servidor novo' }),
    );
    expect(merged?.text).toBe('servidor novo');
    expect(merged?.syncConflict).toBeUndefined();
  });

  it('nao aplica versao de corpo sem o texto (espera o proximo pull)', () => {
    const merged = mergeServerNote(clean(), serverEntry({ versions: { body: 'b2' } }), undefined);
    expect(merged).toBeNull();
  });

  it('sem nada novo, nao devolve mudanca', () => {
    expect(mergeServerNote(clean(), serverEntry(), serverNote())).toBeNull();
  });
});
