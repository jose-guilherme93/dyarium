import {
  mergeSnapshotNotes,
  parseVaultSnapshot,
  recordingFromSnapshotNote,
  shouldRestoreNote,
  snapshotFromRecordings,
  type VaultSnapshotNote,
} from '../vaultSnapshot';
import type { Recording } from '../types';

function recording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'n1',
    title: 'Conversa',
    recordedAt: '2026-11-21T14:20:00.000Z',
    dir: 'recordings/n1',
    segmentCount: 1,
    status: 'completed',
    source: 'text',
    offset: 0,
    attempts: 0,
    createdAt: '2026-11-21T14:20:00.000Z',
    updatedAt: '2026-11-21T14:20:00.000Z',
    text: 'corpo',
    ...overrides,
  };
}

function snapshotNote(overrides: Partial<VaultSnapshotNote> = {}): VaultSnapshotNote {
  return {
    id: 'n1',
    title: 'Conversa',
    recordedAt: '2026-11-21T14:20:00.000Z',
    updatedAt: '2026-11-21T14:20:00.000Z',
    text: 'corpo',
    ...overrides,
  };
}

function snapshot(notes: VaultSnapshotNote[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    vaultId: 'abc123',
    createdAt: '2026-11-22T10:00:00.000Z',
    notes,
    ...extra,
  });
}

describe('retrato do cofre (backup.enc)', () => {
  it('le o formato do web', () => {
    const parsed = parseVaultSnapshot(snapshot([snapshotNote()]));
    expect(parsed.version).toBe(1);
    expect(parsed.notes).toHaveLength(1);
    expect(parsed.notes[0]).toMatchObject({ id: 'n1', title: 'Conversa', text: 'corpo' });
  });

  it('recusa versao desconhecida, JSON invalido e lista que nao e lista', () => {
    expect(() => parseVaultSnapshot(snapshot([], { version: 2 }))).toThrow();
    expect(() => parseVaultSnapshot('{')).toThrow();
    expect(() => parseVaultSnapshot(JSON.stringify({ version: 1, notes: {} }))).toThrow();
  });

  it('recusa id invalido, texto gigante e notas demais', () => {
    expect(() => parseVaultSnapshot(snapshot([snapshotNote({ id: '' })]))).toThrow();
    expect(() => parseVaultSnapshot(snapshot([snapshotNote({ id: 'x'.repeat(200) })]))).toThrow();
    expect(() => parseVaultSnapshot(snapshot([snapshotNote({ text: 'x'.repeat(2_097_153) })]))).toThrow();
    const many = Array.from({ length: 50_001 }, (_, i) => snapshotNote({ id: `n${i}` }));
    expect(() => parseVaultSnapshot(snapshot(many))).toThrow();
  });

  it('recusa data invalida e tags fora do formato', () => {
    expect(() => parseVaultSnapshot(snapshot([snapshotNote({ updatedAt: 'ontem' })]))).toThrow();
    expect(() => parseVaultSnapshot(snapshot([snapshotNote({ tags: [1 as unknown as string] })]))).toThrow();
    expect(() => parseVaultSnapshot(snapshot([snapshotNote({ tags: ['x'.repeat(80)] })]))).toThrow();
  });

  it('respeita o teto de bytes do arquivo', () => {
    const huge = JSON.stringify({ version: 1, notes: [snapshotNote({ text: 'x'.repeat(70 * 1024 * 1024) })] });
    expect(() => parseVaultSnapshot(huge)).toThrow();
  });

  it('monta o retrato a partir das notas vivas', () => {
    const notes = snapshotFromRecordings([
      recording(),
      recording({ id: 'n2', archived: true, tags: ['ideia'], notebookId: 'book1', icon: '✦' }),
    ]);
    expect(notes.map((note) => note.id)).toEqual(['n1', 'n2']);
    expect(notes[1]).toMatchObject({ archived: true, tags: ['ideia'], notebookId: 'book1', icon: '✦' });
  });

  it('nao inclui nota apagada no retrato', () => {
    const notes = snapshotFromRecordings([recording({ deletedAt: '2026-11-22T00:00:00.000Z' })]);
    expect(notes).toHaveLength(0);
  });

  it('une os dois lados pelo id e deixa vencer o mais novo', () => {
    const merged = mergeSnapshotNotes(
      [snapshotNote({ text: 'local' }), snapshotNote({ id: 'n2', title: 'so local' })],
      [
        snapshotNote({ text: 'remoto', updatedAt: '2026-11-22T00:00:00.000Z' }),
        snapshotNote({ id: 'n3', title: 'so remoto' }),
      ],
    );
    expect(merged.find((note) => note.id === 'n1')?.text).toBe('remoto');
    expect(merged.map((note) => note.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('empate fica com o local e nao reescreve', () => {
    const merged = mergeSnapshotNotes([snapshotNote({ text: 'local' })], [snapshotNote({ text: 'remoto' })]);
    expect(merged[0].text).toBe('local');
  });

  it('nao restaura nota local mais nova nem nota apagada depois do retrato', () => {
    const old = snapshotNote({ updatedAt: '2026-11-21T00:00:00.000Z' });
    expect(
      shouldRestoreNote(recording({ updatedAt: '2026-11-22T00:00:00.000Z' }), old),
    ).toBe(false);
    expect(
      shouldRestoreNote(recording({ deletedAt: '2026-11-22T00:00:00.000Z' }), old),
    ).toBe(false);
    expect(
      shouldRestoreNote(recording({ updatedAt: '2026-11-20T00:00:00.000Z' }), old),
    ).toBe(true);
  });

  it('preserva audio, transcricao e diretorio locais ao aplicar o retrato', () => {
    const existing = recording({
      dir: 'recordings/n1',
      filePath: 'file:///recordings/n1/audio.aac',
      transcript: 'fala',
      hasTranscript: true,
      durationMs: 5000,
      updatedAt: '2026-11-20T00:00:00.000Z',
      status: 'completed',
    });
    const applied = recordingFromSnapshotNote(
      snapshotNote({ title: 'novo titulo', text: 'novo corpo', updatedAt: '2026-11-22T00:00:00.000Z' }),
      existing,
      'hlc-1',
    );
    expect(applied).toMatchObject({
      id: 'n1',
      title: 'novo titulo',
      text: 'novo corpo',
      updatedAt: '2026-11-22T00:00:00.000Z',
      filePath: 'file:///recordings/n1/audio.aac',
      transcript: 'fala',
      hasTranscript: true,
      durationMs: 5000,
      updatedHlc: 'hlc-1',
      status: 'completed',
    });
  });

  it('nota nova nasce concluida, sem arquivo nem transcricao', () => {
    const applied = recordingFromSnapshotNote(snapshotNote(), null, 'hlc-2');
    expect(applied).toMatchObject({
      id: 'n1',
      status: 'completed',
      source: 'text',
      dir: '',
      segmentCount: 0,
      notebookId: 'notas-ao-acaso',
    });
    expect(applied.filePath).toBeUndefined();
    expect(applied.transcript).toBeUndefined();
  });
});
