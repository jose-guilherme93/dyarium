import type { ServerEntry } from '../api';
import { chapterFieldsDiffer, entryToRecording } from '../pull';

const ENTRY: ServerEntry = {
  id: 'e1',
  title: 'Capítulo um',
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

describe('entryToRecording e o planejamento do capitulo', () => {
  it('copia os campos chapter_* do servidor', () => {
    const recording = entryToRecording({
      ...ENTRY,
      chapter_kind: 'chapter',
      chapter_position: 3,
      chapter_status: 'revising',
      chapter_goal_words: 1200,
      chapter_synopsis: 'O encontro',
      chapter_beats: 'chega\nencontra',
      chapter_notes: 'rever o dialogo',
    });

    expect(recording.chapterKind).toBe('chapter');
    expect(recording.chapterPosition).toBe(3);
    expect(recording.chapterStatus).toBe('revising');
    expect(recording.chapterGoalWords).toBe(1200);
    expect(recording.chapterSynopsis).toBe('O encontro');
    expect(recording.chapterBeats).toBe('chega\nencontra');
    expect(recording.chapterNotes).toBe('rever o dialogo');
  });

  it('nao inventa capitulo quando o servidor nao manda os campos', () => {
    const recording = entryToRecording(ENTRY);
    expect(recording.chapterKind).toBeUndefined();
    expect(recording.chapterPosition).toBeUndefined();
    expect(recording.chapterStatus).toBeUndefined();
    expect(recording.chapterGoalWords).toBeUndefined();
    expect(recording.chapterSynopsis).toBeUndefined();
    expect(recording.chapterBeats).toBeUndefined();
    expect(recording.chapterNotes).toBeUndefined();
  });

  it('preserva o vazio que o servidor mandar', () => {
    const recording = entryToRecording({
      ...ENTRY,
      chapter_kind: '',
      chapter_position: 0,
      chapter_status: '',
      chapter_goal_words: 0,
      chapter_synopsis: '',
      chapter_beats: '',
      chapter_notes: '',
    });
    expect(recording.chapterKind).toBe('');
    expect(recording.chapterPosition).toBe(0);
    expect(recording.chapterStatus).toBe('');
    expect(recording.chapterGoalWords).toBe(0);
    expect(recording.chapterSynopsis).toBe('');
    expect(recording.chapterBeats).toBe('');
    expect(recording.chapterNotes).toBe('');
  });
});

describe('chapterFieldsDiffer', () => {
  const local = {
    chapterKind: '',
    chapterPosition: 0,
    chapterStatus: '',
    chapterGoalWords: 0,
    chapterSynopsis: '',
    chapterBeats: '',
    chapterNotes: '',
  };

  it('detecta a instalacao antiga sem estrutura', () => {
    expect(
      chapterFieldsDiffer(local, {
        chapterKind: 'chapter',
        chapterPosition: 1024,
        chapterStatus: 'done',
        chapterGoalWords: 2000,
        chapterSynopsis: 'x',
        chapterBeats: '',
        chapterNotes: '',
      }),
    ).toBe(true);
  });

  it('trata ausencia e vazio como iguais numa nota comum', () => {
    expect(chapterFieldsDiffer({}, {})).toBe(false);
    expect(chapterFieldsDiffer(local, { chapterKind: '', chapterPosition: 0 })).toBe(false);
  });

  it('diferencia a posicao zero do undefined quando o servidor manda outro valor', () => {
    expect(chapterFieldsDiffer(local, { chapterPosition: 1024 })).toBe(true);
    expect(chapterFieldsDiffer({ chapterPosition: 1024 }, { chapterPosition: 1024 })).toBe(false);
  });
});
