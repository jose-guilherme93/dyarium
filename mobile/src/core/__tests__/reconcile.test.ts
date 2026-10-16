import { planReconciliation, type RemoteNote } from '../reconcile';
import type { Recording } from '../types';

function rec(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 'r1',
    title: 'Nota',
    recordedAt: '2026-10-11T00:00:00.000Z',
    dir: 'sess/r1',
    segmentCount: 1,
    status: 'completed',
    offset: 0,
    attempts: 0,
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    ...overrides,
  };
}

function note(overrides: Partial<RemoteNote> = {}): RemoteNote {
  return { id: 'en1', title: 'Nota', status: 'ready', ...overrides };
}

describe('planReconciliation', () => {
  it('insere as notas que so existem no servidor', () => {
    const plan = planReconciliation([], [note({ id: 'en1' }), note({ id: 'en2' })]);
    expect(plan.insert.map((n) => n.id)).toEqual(['en1', 'en2']);
    expect(plan.remove).toEqual([]);
    expect(plan.reupload).toEqual([]);
  });

  it('nao mexe na gravacao que ja esta no servidor', () => {
    const plan = planReconciliation([rec({ entryId: 'en1' })], [note({ id: 'en1' })]);
    expect(plan).toEqual({ insert: [], reupload: [], remove: [] });
  });

  it('reenvia a gravacao cuja nota sumiu do servidor', () => {
    const plan = planReconciliation([rec({ entryId: 'en1' })], []);
    expect(plan.reupload).toEqual(['r1']);
    expect(plan.insert).toEqual([]);
  });

  it('remove a linha remota que nao existe mais no servidor', () => {
    const plan = planReconciliation([rec({ id: 'remote_en1', status: 'remote', entryId: 'en1' })], []);
    expect(plan.remove).toEqual(['remote_en1']);
    expect(plan.insert).toEqual([]);
  });

  it('casa pelo conteudo quando falta o entryId', () => {
    const plan = planReconciliation(
      [rec({ originKey: 'sha256:abc' })],
      [note({ id: 'en1', originKey: 'sha256:abc' })],
    );
    expect(plan).toEqual({ insert: [], reupload: [], remove: [] });
  });
});
