import { DEFAULT_NOTE_ORDER, normalizeNoteOrder, sortByCreation } from '../noteOrder';
import type { Recording } from '../types';

function note(id: string, createdAt: string): Recording {
  return {
    id,
    title: id,
    recordedAt: '2020-01-01T00:00:00.000Z',
    createdAt,
  } as Recording;
}

describe('ordem das notas', () => {
  const notes = [
    note('b', '2026-03-02T10:00:00.000Z'),
    note('a', '2026-03-01T10:00:00.000Z'),
    note('c', '2026-03-02T10:00:00.000Z'),
  ];

  it('usa a data de criacao, nao a ultima edicao', () => {
    expect(sortByCreation(notes, 'newest').map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('inverte para as mais antigas primeiro', () => {
    expect(sortByCreation(notes, 'oldest').map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('desempata pelo id para a lista nao pular entre renders', () => {
    const first = sortByCreation(notes, 'newest').map((item) => item.id);
    const second = sortByCreation([...notes].reverse(), 'newest').map((item) => item.id);
    expect(second).toEqual(first);
  });

  it('valor desconhecido cai no padrao mais recente', () => {
    expect(DEFAULT_NOTE_ORDER).toBe('newest');
    expect(normalizeNoteOrder(undefined)).toBe('newest');
    expect(normalizeNoteOrder('qualquer')).toBe('newest');
    expect(normalizeNoteOrder('oldest')).toBe('oldest');
  });
});
