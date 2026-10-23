import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  dismissActivity,
  finishActivity,
  getActivitiesSnapshot,
  startActivity,
} from '@/services/activity';
import { HomeActivityButton } from '../HomeActivityButton';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

afterEach(() => {
  for (const activity of getActivitiesSnapshot()) dismissActivity(activity.id);
});

describe('HomeActivityButton', () => {
  it('avisa o trabalho em andamento e abre o centro', () => {
    startActivity({
      id: 'transcricao:1',
      kind: 'transcription',
      title: 'Reunião',
      progress: 20,
    });
    const onPress = jest.fn();

    render(<HomeActivityButton onPress={onPress} />);

    fireEvent.press(screen.getByLabelText('Atividade. 1 em andamento'));
    expect(onPress).toHaveBeenCalled();
  });

  it('avisa quando uma tarefa terminou e ainda não foi vista', () => {
    startActivity({ id: 'analise:1', kind: 'analysis', title: 'Nota' });
    finishActivity('analise:1', 'Análise pronta');

    render(<HomeActivityButton onPress={jest.fn()} />);

    expect(screen.getByLabelText('Atividade. 1 novidade')).toBeTruthy();
  });
});
