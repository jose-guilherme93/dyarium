import {
  cancelActivity,
  clearFinishedActivities,
  dismissActivity,
  failActivity,
  finishActivity,
  getActivitiesSnapshot,
  markActivitiesSeen,
  startActivity,
  subscribeActivities,
  updateActivity,
} from '../activity';

// O historico vai para o SQLite; aqui so a memoria importa.
jest.mock('../db', () => ({
  saveActivityRow: jest.fn(async () => undefined),
  listActivityRows: jest.fn(async () => []),
  deleteActivityRow: jest.fn(async () => undefined),
  deleteFinishedActivityRows: jest.fn(async () => undefined),
  markActivityRowsSeen: jest.fn(async () => undefined),
  pruneActivityRows: jest.fn(async () => undefined),
}));

afterEach(() => {
  for (const activity of getActivitiesSnapshot()) dismissActivity(activity.id);
});

describe('atividades do aparelho', () => {
  it('acompanha o progresso e vira novidade ao concluir', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeActivities(listener);

    startActivity({
      id: 'transcricao:1',
      kind: 'transcription',
      title: 'Reunião de segunda',
      detail: 'Preparando áudio',
      progress: 0,
    });

    expect(getActivitiesSnapshot()).toEqual([
      expect.objectContaining({
        id: 'transcricao:1',
        title: 'Reunião de segunda',
        status: 'running',
        progress: 0,
        seen: true,
      }),
    ]);

    updateActivity('transcricao:1', {
      detail: 'Transcrevendo trecho 2 de 5',
      progress: 42,
    });

    expect(getActivitiesSnapshot()[0]).toEqual(
      expect.objectContaining({
        detail: 'Transcrevendo trecho 2 de 5',
        progress: 42,
        status: 'running',
      }),
    );

    finishActivity('transcricao:1', 'Transcrição pronta');

    expect(getActivitiesSnapshot()[0]).toEqual(
      expect.objectContaining({
        status: 'done',
        detail: 'Transcrição pronta',
        seen: false,
        finishedAt: expect.any(Number),
      }),
    );

    markActivitiesSeen();
    expect(getActivitiesSnapshot()[0].seen).toBe(true);
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
  });

  it('recomeça a mesma atividade sem empilhar duas linhas', () => {
    startActivity({
      id: 'analise:1',
      kind: 'analysis',
      title: 'Nota',
      detail: 'Primeira tentativa',
    });
    finishActivity('analise:1', 'Análise pronta');

    startActivity({
      id: 'analise:1',
      kind: 'analysis',
      title: 'Nota',
      detail: 'Segunda tentativa',
    });

    expect(getActivitiesSnapshot()).toHaveLength(1);
    expect(getActivitiesSnapshot()[0]).toEqual(
      expect.objectContaining({
        status: 'running',
        detail: 'Segunda tentativa',
        seen: true,
      }),
    );
  });

  it('distingue falha de interrupção e limpa só o que terminou', () => {
    startActivity({ id: 'backup', kind: 'backup', title: 'Backup local' });
    failActivity('backup', 'Backup incompleto');

    startActivity({ id: 'transcricao:2', kind: 'transcription', title: 'Áudio' });
    cancelActivity('transcricao:2', 'Transcrição interrompida');

    startActivity({ id: 'download', kind: 'download', title: 'Modelo Base' });

    expect(getActivitiesSnapshot().map((item) => item.status)).toEqual(
      expect.arrayContaining(['running', 'error', 'cancelled']),
    );

    markActivitiesSeen();
    expect(getActivitiesSnapshot().every((item) => item.seen)).toBe(true);

    clearFinishedActivities();
    expect(getActivitiesSnapshot()).toEqual([
      expect.objectContaining({ id: 'download', status: 'running' }),
    ]);
  });
});
