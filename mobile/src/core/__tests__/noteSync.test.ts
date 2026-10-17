import { ApiError, ConflictError } from '../api';
import {
  applySyncConflict,
  applySyncResult,
  clearNoteConflict,
  conflictFields,
  fetchServerNote,
  isNoteConflict,
  keepMine,
  syncNoteWith,
} from '../noteSync';
import type { NoteSyncApi } from '../noteSync';
import { needsNoteSync, type Recording } from '../types';

/**
 * Falso do cliente: registra o que foi enviado e deixa o teste decidir o que o
 * servidor responde (inclusive 409).
 */
class FakeApi implements NoteSyncApi {
  patched: {
    title?: string;
    recorded_at?: string;
    archived?: boolean;
    versions?: Record<string, string>;
  }[] = [];
  bodies: { markdown: string; baseVersion?: string }[] = [];
  created: { entryId: string; title: string; markdown: string }[] = [];
  conflictOn: 'title' | 'body' | null = null;
  entryVersions = { title: 'v1-titulo', recorded_at: 'v1-data' };
  notes: { id: string; body_version?: string; content_markdown?: string }[] = [
    { id: 'n1', body_version: 'v1-corpo', content_markdown: 'antigo' },
  ];
  entry: {
    title: string;
    recorded_at: string | null;
    created_at: string;
    versions?: { title?: string; recorded_at?: string; body?: string };
  } = {
    title: 'titulo do servidor',
    recorded_at: '2026-10-10T09:00:00Z',
    created_at: 'x',
  };

  updateEntry = jest.fn(async (_id: string, body: Parameters<NoteSyncApi['updateEntry']>[1]) => {
    this.patched.push(body);
    if (this.conflictOn === 'title') {
      throw new ConflictError(409, 'conflict', 'a nota mudou no outro lugar', ['title']);
    }
    return this.entryVersions;
  });

  listNotes = jest.fn(async () => this.notes);

  createNote = jest.fn(async (entryId: string, title: string, markdown: string) => {
    this.created.push({ entryId, title, markdown });
    return { id: 'n_criada', body_version: 'v_criada' };
  });

  updateNote = jest.fn(async (_id: string, markdown: string, baseVersion?: string) => {
    this.bodies.push({ markdown, baseVersion });
    if (this.conflictOn === 'body') {
      throw new ConflictError(409, 'conflict', 'a nota mudou no outro lugar', ['body']);
    }
    return 'v2-corpo';
  });

  getEntry = jest.fn(async () => this.entry);
}

const nota = (over: Partial<Recording> = {}): Recording => ({
  id: 'r1',
  title: 'meu titulo',
  recordedAt: '2026-10-16T12:00:00Z',
  dir: '',
  segmentCount: 0,
  status: 'completed',
  offset: 0,
  attempts: 0,
  entryId: 'en1',
  noteId: 'n1',
  source: 'text',
  titleVersion: 'v1-titulo',
  recordedAtVersion: 'v1-data',
  bodyVersion: 'v1-corpo',
  createdAt: '2026-10-16T12:00:00Z',
  updatedAt: '2026-10-16T12:00:00Z',
  ...over,
});

/** Nao ha imagem local: o markdown entra como esta. */
const semImagens = async (n: Recording) => ({ markdown: n.text ?? '', attachments: {} });

describe('syncNoteWith', () => {
  it('manda o corpo em markdown, sem passar por JSON de blocos', async () => {
    const api = new FakeApi();
    const markdown = '## Secao\n\nparagrafo\n\n- item\n\n![foto](attachment:at_1){w=50}\n';

    await syncNoteWith(api, nota({ text: markdown }), semImagens);

    expect(api.bodies).toHaveLength(1);
    expect(api.bodies[0].markdown).toBe(markdown);
  });

  it('manda a versao lida de cada campo, para o servidor poder recusar', async () => {
    const api = new FakeApi();
    await syncNoteWith(api, nota(), semImagens);

    expect(api.patched[0].versions).toEqual({ title: 'v1-titulo', recorded_at: 'v1-data' });
    expect(api.bodies[0].baseVersion).toBe('v1-corpo');
  });

  it('devolve as versoes gravadas, para a proxima gravacao comecar de la', async () => {
    const api = new FakeApi();
    const result = await syncNoteWith(api, nota(), semImagens);
    expect(result?.versions).toEqual({
      title: 'v1-titulo',
      recordedAt: 'v1-data',
      body: 'v2-corpo',
    });
  });

  it('leva o arquivamento junto, e sem versao', async () => {
    const api = new FakeApi();
    await syncNoteWith(api, nota({ archived: true }), semImagens);

    expect(api.patched[0].archived).toBe(true);
    expect(api.patched[0].versions).toEqual({ title: 'v1-titulo', recorded_at: 'v1-data' });
  });

  it('desarquivar tambem viaja (false explicito, nao ausencia)', async () => {
    const api = new FakeApi();
    await syncNoteWith(api, nota({ text: 'x' }), semImagens);
    expect(api.patched[0].archived).toBe(false);
  });

  it('cria a nota quando a entrada ainda nao tem corpo', async () => {
    const api = new FakeApi();
    api.notes = [];
    const result = await syncNoteWith(api, nota({ text: 'primeiro texto', noteId: undefined }), semImagens);

    expect(api.created).toEqual([{ entryId: 'en1', title: 'meu titulo', markdown: 'primeiro texto' }]);
    expect(result?.noteId).toBe('n_criada');
  });

  it('recria a nota quando o servidor devolve 404 (id local velho)', async () => {
    const api = new FakeApi();
    api.updateNote = jest.fn(async (_id: string, _markdown: string) => {
      throw new ApiError(404, 'not_found', 'nota inexistente');
    });
    const result = await syncNoteWith(api, nota({ text: 'texto preso no aparelho' }), semImagens);

    expect(api.created).toHaveLength(1);
    expect(result?.noteId).toBe('n_criada');
  });

  it('nao come o 409 como se fosse 404', async () => {
    const api = new FakeApi();
    api.conflictOn = 'body';
    await expect(syncNoteWith(api, nota(), semImagens)).rejects.toThrow(ConflictError);
    expect(api.created).toHaveLength(0);
  });

  it('nao sincroniza nota que ainda nao tem entrada no servidor', async () => {
    const api = new FakeApi();
    const result = await syncNoteWith(api, nota({ entryId: undefined }), semImagens);
    expect(result).toBeUndefined();
    expect(api.patched).toHaveLength(0);
  });
});

describe('conflito', () => {
  it('propaga o 409 do corpo com o campo que brigou', async () => {
    const api = new FakeApi();
    api.conflictOn = 'body';
    await expect(syncNoteWith(api, nota(), semImagens)).rejects.toThrow(ConflictError);
    expect(conflictFields(await syncNoteWith(api, nota(), semImagens).catch((e) => e))).toEqual([
      'body',
    ]);
  });

  it('propaga o 409 do titulo', async () => {
    const api = new FakeApi();
    api.conflictOn = 'title';
    const error = await syncNoteWith(api, nota(), semImagens).catch((e) => e);
    expect(isNoteConflict(error)).toBe(true);
    expect(conflictFields(error)).toEqual(['title']);
    // O corpo nem foi tentado: o servidor recusou antes.
    expect(api.bodies).toHaveLength(0);
  });

  it('reenviar sem versao mantem o texto do app (a escolha do usuario)', async () => {
    const api = new FakeApi();
    const result = await syncNoteWith(api, nota({ text: 'meu texto' }), semImagens, { force: true });

    expect(api.patched[0].versions).toEqual({ title: '', recorded_at: '' });
    expect(api.bodies[0]).toEqual({ markdown: 'meu texto', baseVersion: undefined });
    expect(result?.versions.body).toBe('v2-corpo');
  });

  it('erro de rede nao e confundido com conflito', () => {
    expect(isNoteConflict(new Error('sem rede'))).toBe(false);
    expect(conflictFields(new Error('sem rede'))).toEqual([]);
  });
});

describe('o que a nota guarda depois do envio', () => {
  it('guarda as versoes novas e limpa o sujo', () => {
    const sent = nota({ updatedAt: '2026-10-16T12:00:00Z' });
    const fresh = { ...sent };
    const updated = applySyncResult(
      fresh,
      sent,
      {
        noteId: 'n1',
        attachments: { 'attachment:at_1': 'at_1' },
        versions: { title: 'v2-titulo', recordedAt: 'v2-data', body: 'v2-corpo' },
      },
    );

    expect(updated.titleVersion).toBe('v2-titulo');
    expect(updated.bodyVersion).toBe('v2-corpo');
    expect(updated.noteDirty).toBeUndefined();
    expect(updated.syncConflict).toBeUndefined();
    expect(updated.attachments?.['attachment:at_1']).toBe('at_1');
  });

  it('mantem o sujo se o usuario editou durante o envio', () => {
    const sent = nota({ updatedAt: '2026-10-16T12:00:00Z' });
    const fresh = { ...sent, updatedAt: '2026-10-16T12:00:09Z', text: 'typed while syncing' };
    const updated = applySyncResult(fresh, sent, {
      noteId: 'n1',
      attachments: {},
      versions: { body: 'v2-corpo' },
    });

    expect(updated.noteDirty).toBe(true);
  });

  it('conflito: a nota continua suja e sai da fila, esperando o usuario', () => {
    const conflicted = applySyncConflict(nota(), ['body']);

    expect(conflicted.syncConflict).toEqual(['body']);
    expect(conflicted.noteDirty).toBe(true);
    expect(needsNoteSync(conflicted)).toBe(false);
  });

  it('conflito resolvido devolve a nota para a fila', () => {
    const resolved = clearNoteConflict(applySyncConflict(nota(), ['title']));
    expect(resolved.syncConflict).toBeUndefined();
  });
});

describe('manter o meu', () => {
  it('guarda as versoes que o servidor devolveu, para o conflito nao voltar', async () => {
    const sent = nota({ syncConflict: ['body'], noteDirty: true, updatedAt: '2026-10-16T12:00:00Z' });
    const forced = jest.fn(async () => ({
      noteId: 'n1',
      attachments: {},
      versions: { title: 'v2-titulo', recordedAt: 'v2-data', body: 'v2-corpo' },
    }));

    const saved = await keepMine(sent, async () => sent, forced);

    expect(forced).toHaveBeenCalledWith(sent);
    expect(saved?.titleVersion).toBe('v2-titulo');
    expect(saved?.recordedAtVersion).toBe('v2-data');
    expect(saved?.bodyVersion).toBe('v2-corpo');
    expect(saved?.syncConflict).toBeUndefined();
    expect(saved?.noteDirty).toBeUndefined();
  });

  it('sem servidor configurado nao inventa estado: devolve undefined', async () => {
    const saved = await keepMine(nota(), async () => nota(), async () => undefined);
    expect(saved).toBeUndefined();
  });
});

describe('fetchServerNote', () => {
  it('traz titulo, data, corpo e as versoes que estao no servidor', async () => {
    const api = new FakeApi();
    const theirs = await fetchServerNote(api, 'en1');
    expect(theirs).toMatchObject({
      title: 'titulo do servidor',
      recordedAt: '2026-10-10T09:00:00Z',
      markdown: 'antigo',
      // As versoes vem junto: sem elas, o "ficar com o de la" deixaria a nota com
      // a versao velha e a proxima gravacao brigaria de novo.
      bodyVersion: 'v1-corpo',
    });
  });

  it('as versoes do detalhe da entrada entram quando a nota nao devolve a sua', async () => {
    const api = new FakeApi();
    api.notes = [{ id: 'n1', content_markdown: 'antigo' }];
    api.entry = {
      title: 't',
      recorded_at: null,
      created_at: '2026-01-01T00:00:00Z',
      versions: { title: 'v1', recorded_at: 'v2', body: 'v3' },
    };
    const theirs = await fetchServerNote(api, 'en1');
    expect(theirs.titleVersion).toBe('v1');
    expect(theirs.bodyVersion).toBe('v3');
  });

  it('usa created_at quando a entrada nao tem data de evento', async () => {
    const api = new FakeApi();
    api.entry = { title: 't', recorded_at: null, created_at: '2026-01-01T00:00:00Z' };
    const theirs = await fetchServerNote(api, 'en1');
    expect(theirs.recordedAt).toBe('2026-01-01T00:00:00Z');
  });
});