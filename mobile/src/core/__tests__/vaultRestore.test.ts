import {
  planVaultRestore,
  type VaultRestoreInput,
} from '../vaultRestore';
import { parseVaultManifest } from '../vaultManifest';
import type { VaultSnapshot } from '../vaultSnapshot';
import type { Recording } from '../types';

function recording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'n1',
    title: 'Conversa',
    recordedAt: '2026-11-21T14:20:00.000Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    source: 'text',
    offset: 0,
    attempts: 0,
    createdAt: '2026-11-21T14:20:00.000Z',
    updatedAt: '2026-11-21T14:20:00.000Z',
    ...overrides,
  };
}

function snapshot(): VaultSnapshot {
  return {
    version: 1,
    createdAt: '2026-11-22T00:00:00.000Z',
    notes: [
      {
        id: 'n1',
        title: 'Conversa',
        recordedAt: '2026-11-21T14:20:00.000Z',
        updatedAt: '2026-11-22T00:00:00.000Z',
        notebookId: 'nb1',
        text: 'corpo',
      },
      {
        id: 'n2',
        title: 'Capitulo',
        recordedAt: '2026-11-20T10:00:00.000Z',
        updatedAt: '2026-11-20T10:00:00.000Z',
        notebookId: 'nb2',
      },
      {
        id: 'n3',
        title: 'Solto',
        recordedAt: '2026-11-19T10:00:00.000Z',
        updatedAt: '2026-11-19T10:00:00.000Z',
      },
    ],
  };
}

function manifest() {
  const files = [
    {
      path: 'books/Livro/001-capitulo.md.enc',
      id: 'n2',
      kind: 'chapter',
      sha256: 'a'.repeat(64),
      size: 10,
      updated_at: '2026-11-20T10:00:00.000Z',
    },
    {
      path: 'attachments/att_audio.aac.enc',
      id: 'att_audio',
      kind: 'attachment',
      entry_id: 'n1',
      content_type: 'audio/aac',
      sha256: 'b'.repeat(64),
      size: 1000,
      updated_at: '2026-11-21T14:20:00.000Z',
    },
    {
      path: 'attachments/att_img.jpg.enc',
      id: 'att_img',
      kind: 'attachment',
      entry_id: 'n2',
      content_type: 'image/jpeg',
      sha256: 'c'.repeat(64),
      size: 2000,
      updated_at: '2026-11-20T10:00:00.000Z',
    },
    {
      path: 'attachments/att_velho.aac.enc',
      id: 'att_velho',
      kind: 'attachment',
      entry_id: 'n1',
      content_type: 'audio/aac',
      sha256: 'd'.repeat(64),
      size: 3000,
      updated_at: '2026-11-21T14:20:00.000Z',
    },
    {
      path: 'attachments/att_orfao.jpg.enc',
      id: 'att_orfao',
      kind: 'attachment',
      entry_id: 'n_inexistente',
      content_type: 'image/jpeg',
      sha256: 'e'.repeat(64),
      size: 4000,
      updated_at: '2026-11-20T10:00:00.000Z',
    },
  ];
  return parseVaultManifest(
    JSON.stringify({
      version: 4,
      updated_at: '2026-11-22T00:00:00.000Z',
      files,
    }),
  );
}

function input(overrides: Partial<VaultRestoreInput> = {}): VaultRestoreInput {
  return {
    snapshot: snapshot(),
    manifest: manifest(),
    localNotes: new Map(),
    knownNotebooks: new Set(),
    existingAttachmentIds: new Set(),
    ...overrides,
  };
}

describe('plano de restauracao do cofre', () => {
  it('aplica as notas novas e nao repete nota local mais nova', () => {
    const plan = planVaultRestore(
      input({
        localNotes: new Map([
          ['n1', recording({ updatedAt: '2026-11-23T00:00:00.000Z' })],
          ['n2', recording({ id: 'n2', updatedAt: '2026-11-19T00:00:00.000Z' })],
        ]),
      }),
    );
    expect(plan.notes.map((note) => note.id)).toEqual(['n2', 'n3']);
    expect(plan.skippedNotes).toBe(1);
  });

  it('nao ressuscita nota apagada depois do retrato', () => {
    const plan = planVaultRestore(
      input({
        localNotes: new Map([
          ['n3', recording({ id: 'n3', deletedAt: '2026-11-21T00:00:00.000Z', updatedAt: '2026-11-21T00:00:00.000Z' })],
        ]),
      }),
    );
    expect(plan.notes.map((note) => note.id)).not.toContain('n3');
  });

  it('cria caderno com o nome da pasta e placeholder para caderno sem pista', () => {
    const plan = planVaultRestore(
      input({
        localNotes: new Map([['n3', recording({ id: 'n3', notebookId: 'nb3' })]]),
      }),
    );
    expect(plan.notebooks).toEqual(
      expect.arrayContaining([
        { id: 'nb2', name: 'Livro', kind: 'book' },
        { id: 'nb1', name: 'Importado', kind: 'notes' },
      ]),
    );
    expect(plan.notebooks.find((item) => item.id === 'nb2')?.kind).toBe('book');
  });

  it('nao cria caderno que ja existe no aparelho', () => {
    const plan = planVaultRestore(
      input({ knownNotebooks: new Set(['nb1', 'nb2']) }),
    );
    expect(plan.notebooks).toEqual([]);
  });

  it('nao cria caderno para nota que nao vai ser aplicada', () => {
    const plan = planVaultRestore(
      input({
        localNotes: new Map([
          ['n1', recording({ updatedAt: '2026-11-23T00:00:00.000Z' })],
          ['n2', recording({ id: 'n2', updatedAt: '2026-11-23T00:00:00.000Z' })],
          ['n3', recording({ id: 'n3', updatedAt: '2026-11-23T00:00:00.000Z' })],
        ]),
      }),
    );
    expect(plan.notes).toEqual([]);
    expect(plan.notebooks).toEqual([]);
  });

  it('pula audio quando a nota ja tem audio e baixa a imagem', () => {
    const plan = planVaultRestore(
      input({
        localNotes: new Map([['n1', recording({ filePath: 'file:///audio.aac' })]]),
      }),
    );
    expect(plan.attachments.map((item) => item.id)).toEqual(['att_img']);
    expect(plan.counts.bytes).toBe(2000);
  });

  it('pula anexo que ja esta no cache e anexo de nota inexistente', () => {
    const plan = planVaultRestore(
      input({
        localNotes: new Map([['n1', recording()]]),
        existingAttachmentIds: new Set(['att_img']),
      }),
    );
    expect(plan.attachments.map((item) => item.id)).toEqual(['att_audio']);
  });

  it('sem manifest, restaura so as notas', () => {
    const plan = planVaultRestore(input({ manifest: null }));
    expect(plan.notes).toHaveLength(3);
    expect(plan.attachments).toEqual([]);
    expect(plan.notebooks).toEqual([{ id: 'nb1', name: 'Importado', kind: 'notes' }, { id: 'nb2', name: 'Importado', kind: 'notes' }]);
  });

  it('devolve contagens deterministas', () => {
    const plan = planVaultRestore(input());
    expect(plan.counts).toEqual({
      notes: 3,
      notebooks: 2,
      attachments: 2,
      bytes: 3000,
    });
  });
});
