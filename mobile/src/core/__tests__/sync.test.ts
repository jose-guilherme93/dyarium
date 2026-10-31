import type { SyncManifestEntry } from '../api';
import { planReconcile, type EntrySyncSnapshot, type LocalNote } from '../sync';

const NOW = '2026-10-30T12:00:00.000Z';
const LATER = '2026-10-30T13:00:00.000Z';

function remote(id: string, overrides: Partial<SyncManifestEntry> = {}): SyncManifestEntry {
  return {
    id,
    kind: 'entry',
    created_at: NOW,
    updated_at: NOW,
    body_hash: `hash-${id}`,
    versions: { title: `t-${id}`, recorded_at: `r-${id}`, body: `b-${id}` },
    ...overrides,
  };
}

function localNote(id: string, overrides: Partial<LocalNote> = {}): LocalNote {
  return {
    id,
    entryId: `e-${id}`,
    updatedAt: NOW,
    status: 'completed',
    dirty: false,
    ...overrides,
  };
}

function syncOf(overrides: Partial<EntrySyncSnapshot> = {}): EntrySyncSnapshot {
  return {
    remoteEntryId: 'e-note',
    bodyHash: 'hash-e-note',
    versions: { title: 't-e-note', recorded_at: 'r-e-note', body: 'b-e-note' },
    ...overrides,
  };
}

describe('planReconcile', () => {
  it('traz nota que so existe no ambiente', () => {
    const plan = planReconcile({
      remoteLive: [remote('e-note')],
      remoteDeleted: [],
      local: [],
      syncByRecording: new Map(),
    });
    expect(plan.pull).toEqual(['e-note']);
    expect(plan.push).toEqual([]);
  });

  it('envia nota que so existe no aparelho', () => {
    const note = localNote('note');
    const plan = planReconcile({
      remoteLive: [],
      remoteDeleted: [],
      local: [note],
      syncByRecording: new Map(),
    });
    expect(plan.push).toEqual(['note']);
    expect(plan.pull).toEqual([]);
  });

  it('baixa quando o ambiente mudou e envia quando o aparelho mudou', () => {
    const note = localNote('note');
    const plan = planReconcile({
      remoteLive: [remote('e-note', { body_hash: 'hash-novo', updated_at: LATER })],
      remoteDeleted: [],
      local: [note],
      syncByRecording: new Map([['note', syncOf()]]),
    });
    expect(plan.pull).toEqual(['e-note']);
    expect(plan.push).toEqual([]);

    const dirty = planReconcile({
      remoteLive: [remote('e-note')],
      remoteDeleted: [],
      local: [{ ...note, dirty: true }],
      syncByRecording: new Map([['note', syncOf()]]),
    });
    expect(dirty.pull).toEqual([]);
    expect(dirty.push).toEqual(['note']);
  });

  it('aplica tombstone remoto mais novo e preserva nota com edicao local mais nova', () => {
    const deleted = remote('e-note', { deleted_at: LATER, updated_at: LATER });
    const plan = planReconcile({
      remoteLive: [],
      remoteDeleted: [deleted],
      local: [localNote('note')],
      syncByRecording: new Map([['note', syncOf()]]),
    });
    expect(plan.tombstone).toEqual([{ recordingId: 'note', deletedAt: LATER }]);

    const localNewer = planReconcile({
      remoteLive: [],
      remoteDeleted: [deleted],
      local: [{ ...localNote('note'), updatedAt: '2026-10-30T14:00:00.000Z' }],
      syncByRecording: new Map([['note', syncOf()]]),
    });
    expect(localNewer.tombstone).toEqual([]);
    expect(localNewer.restore).toEqual([{ recordingId: 'note', remoteEntryId: 'e-note' }]);
  });

  it('envia a exclusao local quando ela e mais nova que a copia viva', () => {
    const plan = planReconcile({
      remoteLive: [remote('e-note')],
      remoteDeleted: [],
      local: [{ ...localNote('note'), deletedAt: LATER }],
      syncByRecording: new Map([['note', syncOf()]]),
    });
    expect(plan.pushDelete).toEqual([
      { recordingId: 'note', remoteEntryId: 'e-note', deletedAt: LATER },
    ]);
  });

  it('nao envia nota que ainda esta na fila', () => {
    const plan = planReconcile({
      remoteLive: [],
      remoteDeleted: [],
      local: [localNote('note', { status: 'queued' })],
      syncByRecording: new Map(),
    });
    expect(plan.push).toEqual([]);
  });

  it('nao repete ids quando o mesmo caminho aparece duas vezes', () => {
    const note = localNote('note');
    const plan = planReconcile({
      remoteLive: [remote('e-note')],
      remoteDeleted: [remote('e-note', { deleted_at: NOW })],
      local: [note],
      syncByRecording: new Map([['note', syncOf()]]),
    });
    expect(new Set(plan.pull).size).toBe(plan.pull.length);
    expect(new Set(plan.push).size).toBe(plan.push.length);
    expect(new Set(plan.tombstone.map((i) => i.recordingId)).size).toBe(plan.tombstone.length);
  });
});
