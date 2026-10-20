import { fireEvent, render, screen } from '@testing-library/react-native';

import { NoteMetaRow } from '../NoteMetaRow';
import type { Recording } from '@/core/types';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const note: Recording = {
  id: 'n1',
  title: 'nota',
  recordedAt: '2026-10-19T10:00:00Z',
  dir: '',
  segmentCount: 0,
  status: 'completed',
  offset: 0,
  attempts: 0,
  entryId: 'n1',
  notebookId: 'nb_trabalho',
  tags: ['viagem', 'familia'],
  createdAt: '2026-10-19T10:00:00Z',
  updatedAt: '2026-10-19T10:00:00Z',
};

describe('NoteMetaRow', () => {
  it('mostra as tags e permite adicionar/remover', () => {
    const onAddTag = jest.fn();
    const onRemoveTag = jest.fn();
    render(
      <NoteMetaRow
        note={note}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
      />,
    );

    expect(screen.queryByText('Tag')).toBeNull();
    expect(screen.getByText('viagem')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Adicionar tag'));
    expect(onAddTag).toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('Remover tag viagem'));
    expect(onRemoveTag).toHaveBeenCalledWith('viagem');
  });
});
