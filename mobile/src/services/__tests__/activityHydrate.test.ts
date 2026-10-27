import { getActivitiesSnapshot, loadStoredActivities } from '../activity';

const rows = [
  {
    id: 'transcricao:1',
    kind: 'transcription',
    title: 'Reunião',
    detail: 'Trecho 2 de 5',
    status: 'running',
    progress: 40,
    startedAt: 1000,
    finishedAt: null,
    seen: 0,
  },
  {
    id: 'analise:1',
    kind: 'analysis',
    title: 'Nota analisada',
    detail: 'Análise pronta',
    status: 'done',
    progress: null,
    startedAt: 900,
    finishedAt: 950,
    seen: 0,
  },
  {
    id: 'lixo',
    kind: 'desconhecido',
    title: 'linha inválida',
    detail: null,
    status: 'done',
    progress: null,
    startedAt: 800,
    finishedAt: 820,
    seen: 0,
  },
];

jest.mock('../db', () => ({
  listActivityRows: async () => rows,
  saveActivityRow: jest.fn(async () => undefined),
  deleteActivityRow: jest.fn(async () => undefined),
  deleteFinishedActivityRows: jest.fn(async () => undefined),
  markActivityRowsSeen: jest.fn(async () => undefined),
  pruneActivityRows: jest.fn(async () => undefined),
}));

describe('histórico do centro de atividade', () => {
  it('carrega o que ficou salvo e trata o que morreu no meio como interrompido', async () => {
    await loadStoredActivities();

    const list = getActivitiesSnapshot();
    const done = list.find((item) => item.id === 'analise:1');
    expect(done?.status).toBe('done');
    expect(done?.detail).toBe('Análise pronta');

    // `running` no banco = o processo morreu no meio; nunca vira "concluída".
    const interrupted = list.find((item) => item.id === 'transcricao:1');
    expect(interrupted?.status).toBe('cancelled');
    expect(interrupted?.detail).toBe('Interrompida');
    expect(interrupted?.seen).toBe(false);
    expect(interrupted?.progress).toBe(40);

    // Linha com tipo desconhecido não quebra a lista.
    expect(list.some((item) => item.id === 'lixo')).toBe(false);
  });
});
