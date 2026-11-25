import { groupNotesByDay, monthCells, notesInOtherYears } from '../calendar';

/** Data local, para o teste nao depender do fuso da maquina. */
function iso(year: number, month: number, day: number, hour = 9, minute = 0): string {
  return new Date(year, month, day, hour, minute).toISOString();
}

function note(localIso: string, title: string) {
  return { recordedAt: localIso, createdAt: localIso, title };
}

describe('calendario', () => {
  it('comeca a semana na segunda e fecha semanas inteiras', () => {
    // 1 de novembro de 2026 e domingo: a primeira semana traz outubro.
    const cells = monthCells(2026, 10);
    expect(cells).toHaveLength(42);
    expect(cells[0].key).toBe('2026-10-26');
    expect(cells[0].out).toBe(true);
    expect(cells[6].key).toBe('2026-11-01');
    expect(cells[6].day).toBe(1);
    expect(cells[6].out).toBe(false);
    expect(cells[6].weekend).toBe(true);
  });

  it('agrupa pelo dia do evento, nao pela data de criacao', () => {
    const map = groupNotesByDay([
      note(iso(2026, 10, 13, 8, 40), 'hoje'),
      {
        recordedAt: iso(2026, 10, 13, 9, 15),
        createdAt: iso(2026, 8, 1, 10, 0),
        title: 'antiga',
      },
    ]);
    expect(map.get('2026-11-13')).toHaveLength(2);
  });

  it('ignora nota sem data legivel', () => {
    const map = groupNotesByDay([{ recordedAt: 'nao e data', createdAt: '' }]);
    expect(map.size).toBe(0);
  });

  it('ordena as notas do dia pela hora', () => {
    const map = groupNotesByDay([
      note(iso(2026, 10, 13, 21, 0), 'noite'),
      note(iso(2026, 10, 13, 8, 0), 'manha'),
    ]);
    const list = [...map.values()][0];
    expect(list.map((item) => item.title)).toEqual(['manha', 'noite']);
  });

  it('junta o mesmo dia de cada ano anterior', () => {
    const groups = notesInOtherYears(
      [
        note(iso(2026, 10, 13, 10, 0), 'este ano'),
        note(iso(2025, 10, 13, 10, 0), 'ano passado'),
        note(iso(2024, 10, 13, 10, 0), 'dois anos'),
        note(iso(2025, 10, 14, 10, 0), 'outro dia'),
      ],
      '2026-11-13',
    );
    expect(groups.map((group) => group.year)).toEqual(['2025', '2024']);
    expect(groups[0].notes.map((item) => item.title)).toEqual(['ano passado']);
  });

});
