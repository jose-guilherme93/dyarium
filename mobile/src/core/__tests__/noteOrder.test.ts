import { DEFAULT_NOTE_ORDER, normalizeNoteOrder, sortByNoteDate } from '../noteOrder';
import type { Recording } from '../types';

function note(id: string, recordedAt: string, createdAt = recordedAt): Recording {
  return {
    id,
    title: id,
    recordedAt,
    createdAt,
  } as Recording;
}

describe('ordem das notas', () => {
  const notes = [
    note('b', '2026-03-02T10:00:00.000Z'),
    note('a', '2026-03-01T10:00:00.000Z'),
    note('c', '2026-03-02T10:00:00.000Z'),
  ];

  it('usa a data da nota, nao a data de criacao no app', () => {
    // Nota importada: nasceu no app em outubro, mas o evento e de 2024.
    const importada = note('importada', '2024-03-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z');
    expect(
      sortByNoteDate([...notes, importada], 'newest').map((item) => item.id),
    ).toEqual(['c', 'b', 'a', 'importada']);
  });

  it('inverte para as mais antigas primeiro', () => {
    expect(sortByNoteDate(notes, 'oldest').map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('compara instantes, nao texto, entre datas com fusos diferentes', () => {
    // 23:00-03:00 e 02:00Z do dia seguinte: em texto o ISO do dia 1 viria antes.
    const antes = note('antes', '2026-03-02T01:00:00.000Z');
    const depois = note('depois', '2026-03-01T23:00:00.000-03:00');
    expect(sortByNoteDate([antes, depois], 'newest').map((item) => item.id)).toEqual([
      'depois',
      'antes',
    ]);
  });

  it('desempata pelo id para a lista nao pular entre renders', () => {
    const first = sortByNoteDate(notes, 'newest').map((item) => item.id);
    const second = sortByNoteDate([...notes].reverse(), 'newest').map((item) => item.id);
    expect(second).toEqual(first);
  });

  it('valor desconhecido cai no padrao mais recente', () => {
    expect(DEFAULT_NOTE_ORDER).toBe('newest');
    expect(normalizeNoteOrder(undefined)).toBe('newest');
    expect(normalizeNoteOrder('qualquer')).toBe('newest');
    expect(normalizeNoteOrder('oldest')).toBe('oldest');
  });
});
