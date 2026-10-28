import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  dismissActivity,
  failActivity,
  finishActivity,
  getActivitiesSnapshot,
  startActivity,
} from '@/services/activity';
import { ActivityCenter } from '../ActivityCenter';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

afterEach(() => {
  for (const activity of getActivitiesSnapshot()) dismissActivity(activity.id);
});

describe('ActivityCenter', () => {
  it('mostra o que está sendo feito e separa as tarefas recentes', () => {
    startActivity({
      id: 'transcricao:1',
      kind: 'transcription',
      title: 'Reunião de segunda',
      detail: 'Transcrevendo trecho 2 de 5',
      progress: 42,
    });
    startActivity({
      id: 'backup',
      kind: 'backup',
      title: 'Backup local',
      detail: 'Copiando notas · 3 de 3',
      progress: 100,
    });
    finishActivity('backup', '3 notas, 12 arquivos');

    render(<ActivityCenter visible onClose={jest.fn()} />);

    expect(screen.getByText('Atividade')).toBeTruthy();
    expect(screen.getByText('1 em andamento')).toBeTruthy();
    expect(screen.getByText('Em andamento')).toBeTruthy();
    expect(screen.getByText('Reunião de segunda')).toBeTruthy();
    expect(screen.getByText('Transcrevendo trecho 2 de 5')).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('Recentes')).toBeTruthy();
    expect(screen.getByText('Backup local')).toBeTruthy();
    expect(screen.getByText('3 notas, 12 arquivos')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Limpar concluídas'));

    expect(screen.queryByText('Backup local')).toBeNull();
    expect(screen.getByText('Reunião de segunda')).toBeTruthy();
  });

  it('oferece parar para o que ainda está rodando', () => {
    const stop = jest.fn();
    startActivity({
      id: 'transcricao:2',
      kind: 'transcription',
      title: 'Aula de terça',
      stop: { label: 'Parar', run: stop },
    });

    render(<ActivityCenter visible onClose={jest.fn()} />);

    fireEvent.press(screen.getByLabelText('Parar: Aula de terça'));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('oferece a ação de recuperação quando algo falha', () => {
    const retry = jest.fn();
    startActivity({
      id: 'download:transcription:base',
      kind: 'download',
      title: 'Modelo Base',
      detail: 'Baixando modelo de transcrição',
      progress: 0,
      action: { label: 'Tentar de novo', run: retry },
    });
    failActivity('download:transcription:base', 'Não foi possível baixar o modelo');

    render(<ActivityCenter visible onClose={jest.fn()} />);

    expect(screen.getByText('Recentes')).toBeTruthy();
    expect(screen.getByText('Tentar de novo')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Tentar de novo: Modelo Base'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('marca como vista ao abrir e mostra o estado vazio', () => {
    startActivity({ id: 'analise:1', kind: 'analysis', title: 'Nota' });
    finishActivity('analise:1', 'Análise pronta');
    expect(getActivitiesSnapshot()[0].seen).toBe(false);

    const { unmount } = render(<ActivityCenter visible onClose={jest.fn()} />);

    expect(getActivitiesSnapshot()[0].seen).toBe(true);
    expect(screen.getByText('Tudo em dia')).toBeTruthy();
    unmount();

    for (const activity of getActivitiesSnapshot()) dismissActivity(activity.id);

    render(<ActivityCenter visible onClose={jest.fn()} />);
    expect(screen.getByText('Nada em andamento')).toBeTruthy();
    expect(
      screen.getByText('Transcrições, análises e backups aparecem aqui enquanto acontecem.'),
    ).toBeTruthy();
  });
});
