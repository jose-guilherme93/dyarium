import { fireEvent, render, screen } from '@testing-library/react-native';

import { NotebookForm } from '../NotebookForm';

describe('NotebookForm', () => {
  it('envia nome e cor ao salvar', () => {
    const onSave = jest.fn();
    render(
      <NotebookForm
        visible
        title="Novo caderno"
        initialName="Viagem"
        onClose={jest.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.press(screen.getByText('Salvar'));

    expect(onSave).toHaveBeenCalledWith({
      name: 'Viagem',
      color: '',
    });
  });
});