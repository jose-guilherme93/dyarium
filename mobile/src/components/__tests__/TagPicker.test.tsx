import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { TagPicker } from '../TagPicker';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('@/services/tagAdmin', () => ({
  listTagBank: jest.fn(async () => [{ name: 'Viagem' }, { name: 'Ideias' }]),
}));

describe('TagPicker', () => {
  it('mostra as tags conhecidas e cria uma tag nova pelo campo', async () => {
    const onSave = jest.fn();
    render(
      <TagPicker
        visible
        selected={[]}
        knownTags={['Viagem']}
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByText('Tags')).toBeTruthy();
    expect(screen.getByText('Viagem')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Ideias')).toBeTruthy());

    fireEvent.changeText(screen.getByPlaceholderText('Buscar ou criar tag'), 'Nova tag');
    fireEvent.press(screen.getByText('Criar “Nova tag”'));

    // A tag criada entra na selecao e o campo volta a ficar vazio.
    expect(screen.getByPlaceholderText('Buscar ou criar tag').props.value).toBe('');
    fireEvent.press(screen.getByLabelText('Concluir tags'));

    expect(onSave).toHaveBeenCalledWith(['Nova tag']);
  });

  it('carrega o banco de tags e alterna uma sugestao', async () => {
    const onSave = jest.fn();
    render(
      <TagPicker
        visible
        selected={[]}
        knownTags={[]}
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );

    await waitFor(() => expect(screen.getByText('Ideias')).toBeTruthy());
    fireEvent.press(screen.getByText('Ideias'));
    fireEvent.press(screen.getByLabelText('Concluir tags'));

    expect(onSave).toHaveBeenCalledWith(['Ideias']);
  });
});
