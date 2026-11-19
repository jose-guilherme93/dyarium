import type { SyncManifestEntry } from '@/core/api';
import type { Recording } from '@/core/types';

import { planChapterUpdates } from '../sync/chapters';

function remote(over: Partial<SyncManifestEntry> = {}): SyncManifestEntry {
  return {
    id: 'e1',
    kind: 'entry',
    created_at: '2026-10-11T14:00:00Z',
    updated_at: '2026-10-11T14:05:00Z',
    ...over,
  };
}

function local(over: Partial<Recording> = {}): Recording {
  return {
    id: 'rec_1',
    title: 'Capítulo um',
    recordedAt: '2026-10-11T14:00:00Z',
    dir: '',
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    entryId: 'e1',
    createdAt: '2026-10-11T14:00:00Z',
    updatedAt: '2026-10-11T14:05:00Z',
    chapterKind: '',
    chapterPosition: 0,
    chapterStatus: '',
    chapterGoalWords: 0,
    chapterSynopsis: '',
    chapterBeats: '',
    chapterNotes: '',
    ...over,
  };
}

describe('planChapterUpdates', () => {
  it('planeja a estrutura de um livro antigo direto do manifesto', () => {
    const updates = planChapterUpdates(
      [
        remote({
          chapter_kind: 'chapter',
          chapter_position: 1024,
          chapter_status: 'done',
          chapter_goal_words: 2000,
          chapter_synopsis: 'x',
          chapter_beats: '',
          chapter_notes: '',
        }),
      ],
      [local()],
      () => 'e1',
    );

    expect(updates).toEqual([
      {
        recordingId: 'rec_1',
        fields: {
          chapterKind: 'chapter',
          chapterPosition: 1024,
          chapterStatus: 'done',
          chapterGoalWords: 2000,
          chapterSynopsis: 'x',
          chapterBeats: '',
          chapterNotes: '',
        },
      },
    ]);
  });

  it('nao planeja nada quando o planejamento ja esta igual', () => {
    const updates = planChapterUpdates(
      [remote({ chapter_kind: 'chapter', chapter_position: 1024, chapter_status: 'done' })],
      [
        local({
          chapterKind: 'chapter',
          chapterPosition: 1024,
          chapterStatus: 'done',
        }),
      ],
      () => 'e1',
    );

    expect(updates).toEqual([]);
  });

  it('nao mexe em nota comum sem capitulo', () => {
    expect(planChapterUpdates([remote()], [local()], () => 'e1')).toEqual([]);
  });

  it('acha a nota local pelo id remoto da linha de sync', () => {
    const updates = planChapterUpdates(
      [remote({ id: 'remote_1', chapter_kind: 'chapter' })],
      [local({ id: 'rec_1', entryId: 'outro' })],
      () => 'remote_1',
    );

    expect(updates.map((item) => item.recordingId)).toEqual(['rec_1']);
  });
});
