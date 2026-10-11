import { groupRecordingsByYear } from '../group';
import type { Recording } from '../types';

function rec(id: string, localDate: Date): Recording {
  const iso = localDate.toISOString();
  return {
    id,
    title: id,
    recordedAt: iso,
    dir: `sess/${id}`,
    segmentCount: 0,
    status: 'completed',
    offset: 0,
    attempts: 0,
    createdAt: iso,
    updatedAt: iso,
  };
}

describe('groupRecordingsByYear', () => {
  it('separa por ano, do mais novo para o mais antigo', () => {
    const recordings = [
      rec('a', new Date(2023, 5, 10, 12, 0)),
      rec('b', new Date(2026, 0, 2, 9, 0)),
      rec('c', new Date(2025, 10, 20, 18, 0)),
    ];
    const sections = groupRecordingsByYear(recordings);
    expect(sections.map((s) => s.year)).toEqual([2026, 2025, 2023]);
    expect(sections.map((s) => s.title)).toEqual(['2026', '2025', '2023']);
  });

  it('ordena as notas mais recentes no topo dentro do ano', () => {
    const recordings = [
      rec('antiga', new Date(2023, 1, 1, 8, 0)),
      rec('recente', new Date(2023, 8, 1, 8, 0)),
    ];
    const [section] = groupRecordingsByYear(recordings);
    expect(section.data.map((r) => r.id)).toEqual(['recente', 'antiga']);
  });

  it('usa o ano local do evento, nao a data de criacao', () => {
    const importada = rec('importada', new Date(2023, 11, 31, 23, 0));
    importada.createdAt = new Date(2026, 0, 1, 10, 0).toISOString();
    const [section] = groupRecordingsByYear([importada]);
    expect(section.year).toBe(2023);
  });

  it('devolve lista vazia sem gravacoes', () => {
    expect(groupRecordingsByYear([])).toEqual([]);
  });
});
