import { activityMessage, doneMessage } from '../notifications';

/**
 * A notificacao segue a regra da interface: numero primeiro, nome da nota
 * depois, nenhuma frase. Duas linhas, e so.
 */
describe('texto da notificacao de atividade', () => {
  it('mostra a posicao no lote e a porcentagem', () => {
    expect(
      activityMessage({
        stage: 'transcribing',
        noteTitle: 'Oct 27, 9.03 AM',
        index: 3,
        total: 8,
        percent: 42,
      }),
    ).toEqual({ title: '3 de 8 · transcrevendo', body: 'Oct 27, 9.03 AM · 42%' });
  });

  it('sem lote, so a etapa e a nota', () => {
    expect(activityMessage({ stage: 'analyzing', noteTitle: 'destaque da semana' })).toEqual({
      title: 'analisando',
      body: 'destaque da semana',
    });
  });

  it('revisao usa trechos, sem porcentagem', () => {
    expect(
      activityMessage({
        stage: 'reviewing',
        noteTitle: 'trans audio new',
        index: 12,
        total: 34,
      }),
    ).toEqual({ title: '12 de 34 · revisando', body: 'trans audio new' });
  });
});

describe('resumo do fim do lote', () => {
  it('conta os concluidos e separa a falha', () => {
    expect(doneMessage(8, 8, 0)).toEqual({ title: '8 de 8 concluídos', body: 'Pronto' });
    expect(doneMessage(7, 8, 1)).toEqual({ title: '7 de 8 concluídos', body: '1 com erro' });
  });
});
