import {
  attachmentKind,
  notebookFolders,
  parseVaultManifest,
  restoreAttachments,
  type VaultFileEntry,
} from '../vaultManifest';

function entry(overrides: Partial<VaultFileEntry> = {}): VaultFileEntry {
  return {
    path: 'notes/2026-11-21-conversa.md.enc',
    id: 'n1',
    kind: 'note',
    sha256: 'a'.repeat(64),
    size: 120,
    updated_at: '2026-11-21T14:20:00.000Z',
    ...overrides,
  };
}

function manifest(files: VaultFileEntry[], version = 4): string {
  return JSON.stringify({
    version,
    vault_id: 'abc123',
    updated_at: '2026-11-22T10:00:00.000Z',
    files,
  });
}

function attachment(overrides: Partial<VaultFileEntry> = {}): VaultFileEntry {
  return entry({
    path: 'attachments/att_1.aac.enc',
    id: 'att_1',
    kind: 'attachment',
    entry_id: 'n1',
    content_type: 'audio/aac',
    ...overrides,
  });
}

describe('manifest do cofre', () => {
  it('le v4 e v3', () => {
    expect(parseVaultManifest(manifest([entry()])).version).toBe(4);
    expect(parseVaultManifest(manifest([entry()], 3)).version).toBe(3);
  });

  it('recusa versao desconhecida, JSON invalido e arquivos que nao sao lista', () => {
    expect(() => parseVaultManifest(manifest([entry()], 2))).toThrow();
    expect(() => parseVaultManifest('{')).toThrow();
    expect(() => parseVaultManifest(JSON.stringify({ version: 4, files: {} }))).toThrow();
  });

  it('recusa caminho que sai da pasta ou tem segmento vazio', () => {
    for (const path of ['../fora.enc', '/etc/passwd', 'notes/../../x.enc', 'notes//x.enc', 'notes/a\\b.enc', '', `notes/${'a'.repeat(600)}.enc`]) {
      expect(() => parseVaultManifest(manifest([entry({ path })]))).toThrow();
    }
  });

  it('recusa id invalido, sha curto, tamanho negativo e entrada demais', () => {
    expect(() => parseVaultManifest(manifest([entry({ id: '' })]))).toThrow();
    expect(() => parseVaultManifest(manifest([entry({ sha256: 'abc' })]))).toThrow();
    expect(() => parseVaultManifest(manifest([entry({ size: -1 })]))).toThrow();
    expect(() => parseVaultManifest(manifest([entry({ size: 400 * 1024 * 1024 })]))).toThrow();
    expect(() => parseVaultManifest(manifest([attachment({ entry_id: '' })]))).toThrow();
    const many = Array.from({ length: 200_001 }, (_, index) =>
      entry({ id: `n${index}`, path: `notes/n${index}.md.enc` }),
    );
    expect(() => parseVaultManifest(manifest(many))).toThrow();
  });

  it('respeita o teto de bytes do manifest', () => {
    const huge = JSON.stringify({
      version: 4,
      files: [entry({ path: `notes/${'a'.repeat(17 * 1024 * 1024)}.enc` })],
    });
    expect(() => parseVaultManifest(huge)).toThrow();
  });

  it('so devolve anexos v4 com tipo conhecido e id do dono', () => {
    const parsed = parseVaultManifest(
      manifest([
        attachment(),
        attachment({ id: 'att_2', path: 'attachments/att_2.jpg.enc', content_type: 'image/jpeg' }),
        attachment({ id: 'att_2', path: 'attachments/att_2-b.jpg.enc' }),
        attachment({ id: 'att_3', path: 'attachments/att_3.pdf.enc', content_type: 'application/pdf' }),
        attachment({ id: 'att_5', path: 'attachments/att_5.aac.enc', size: 0 }),
        entry({ id: 'n2', path: 'notes/outra.md.enc' }),
      ]),
    );
    expect(restoreAttachments(parsed).map((item) => item.id)).toEqual(['att_1', 'att_2']);
  });

  it('v3 nao tem entry_id nem content_type e nao restaura anexo', () => {
    const parsed = parseVaultManifest(
      manifest([attachment({ entry_id: undefined, content_type: undefined })], 3),
    );
    expect(restoreAttachments(parsed)).toEqual([]);
  });

  it('classifica audio e imagem', () => {
    expect(attachmentKind('audio/mp4')).toBe('audio');
    expect(attachmentKind('image/png')).toBe('image');
    expect(attachmentKind('application/pdf')).toBe(null);
    expect(attachmentKind('AUDIO/AAC; charset=x')).toBe('audio');
  });

  it('descobre o caderno pelo caminho e pelo id da nota', () => {
    const parsed = parseVaultManifest(
      manifest([
        entry({ id: 'n2', kind: 'chapter', path: 'books/Ficcao Cientifica/001-capitulo.md.enc' }),
        entry({ id: 'n3', kind: 'chapter', path: 'books/Ficcao Cientifica/002-outro.md.enc' }),
        entry({ id: 'nb1', kind: 'cover', path: 'books/Ficcao Cientifica/capa.bin.enc' }),
        entry({ id: 'n4', kind: 'note', path: 'projects/Dyarium/001-sessao.md.enc' }),
        entry({ id: 'n5', kind: 'note', path: 'notes/solta.md.enc' }),
      ]),
    );
    const notes = new Map([
      ['n2', 'nb1'],
      ['n3', 'nb1'],
      ['n4', 'nb9'],
      ['n5', 'nb8'],
    ]);
    const folders = notebookFolders(parsed, notes);
    expect(folders.get('nb1')).toEqual({ name: 'Ficcao Cientifica', kind: 'book' });
    expect(folders.get('nb9')).toEqual({ name: 'Dyarium', kind: 'mcp' });
    expect(folders.has('nb8')).toBe(false);
  });

  it('em conflito de pasta para o mesmo caderno, fica a primeira', () => {
    const parsed = parseVaultManifest(
      manifest([
        entry({ id: 'n2', kind: 'chapter', path: 'books/Primeiro/001-a.md.enc' }),
        entry({ id: 'n3', kind: 'chapter', path: 'books/Segundo/001-b.md.enc' }),
      ]),
    );
    const folders = notebookFolders(parsed, new Map([['n2', 'nb1'], ['n3', 'nb1']]));
    expect(folders.get('nb1')?.name).toBe('Primeiro');
  });

  it('nao aceita caderno com nome vazio ou de controle', () => {
    const parsed = parseVaultManifest(
      manifest([entry({ id: 'n2', kind: 'chapter', path: 'books/   /001-a.md.enc' })]),
    );
    expect(notebookFolders(parsed, new Map([['n2', 'nb1']])).has('nb1')).toBe(false);
  });
});
