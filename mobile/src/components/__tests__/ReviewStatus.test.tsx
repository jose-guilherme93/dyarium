import { fireEvent, render, screen } from '@testing-library/react-native';

import { ReviewStatus } from '@/components/ReviewStatus';
import type { TranscriptReview, TranscriptSegment } from '@/core/types';

jest.mock('react-native-svg', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { __esModule: true, default: View, Circle: View };
});

const SEGMENTS: TranscriptSegment[] = [
  { start_ms: 0, end_ms: 1000, text: 'a sede do pt', revised: 'A sede do PT.' },
  { start_ms: 1000, end_ms: 2000, text: 'foram 3 pessoas' },
];

const review: TranscriptReview = {
  model: 'qwen3-1.7b',
  promptVersion: 1,
  literal: false,
  comprehension: 78,
  finishedAt: '2026-10-27T12:00:00.000Z',
  rejected: 0,
};

/**
 * A tela diz em icones e numeros o que aconteceu com a revisao. O ponto do
 * defeito anterior era nao conseguir distinguir "nao mudou nada" de "nao rodou".
 */
describe('estado da revisão na tela de transcrição', () => {
  it('mostra o numero de trechos alterados e a compreensao', () => {
    render(<ReviewStatus segments={SEGMENTS} review={review} />);
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('78')).toBeTruthy();
    expect(
      screen.getByLabelText('1 trecho alterado. Toque para ver o antes e o depois.'),
    ).toBeTruthy();
  });

  it('revisao sem mudanca mostra zero, nao um vazio', () => {
    render(<ReviewStatus segments={[SEGMENTS[1]]} review={review} />);
    expect(screen.getByText('0')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Revisão concluída sem alterações.'));
    expect(screen.getByText('Nada a corrigir neste texto.')).toBeTruthy();
  });

  it('sem revisao explica o motivo em uma linha, so ao tocar', () => {
    render(
      <ReviewStatus segments={SEGMENTS} reason="Revisão desligada nas configurações." />,
    );
    expect(screen.queryByText('Revisão desligada nas configurações.')).toBeNull();
    fireEvent.press(
      screen.getByLabelText('Transcrição não revisada. Toque para saber por quê.'),
    );
    expect(screen.getByText('Revisão desligada nas configurações.')).toBeTruthy();
  });

  it('passada interrompida mostra pausa e continuar de onde parou', () => {
    const onResume = jest.fn();
    const paused = { ...review, finishedAt: undefined, reviewedThrough: 1 };
    render(<ReviewStatus segments={SEGMENTS} review={paused} onResume={onResume} />);
    expect(screen.getByText('1 de 2')).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Revisão interrompida em 1 de 2 trechos. Toque para continuar.',
      ),
    ).toBeTruthy();
    fireEvent.press(
      screen.getByLabelText(
        'Revisão interrompida em 1 de 2 trechos. Toque para continuar.',
      ),
    );
    fireEvent.press(screen.getByLabelText('Continuar a revisão de onde parou'));
    expect(onResume).toHaveBeenCalled();
  });

  it('passada rodando mostra o progresso, sem botao de continuar', () => {
    const running = { ...review, finishedAt: undefined, reviewedThrough: 1 };
    render(<ReviewStatus segments={SEGMENTS} review={running} running />);
    expect(
      screen.getByLabelText('Revisando 1 de 2 trechos.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Continuar a revisão de onde parou')).toBeNull();
  });

  it('mostra o que ficou sem revisao e oferece repetir so isso', () => {
    const onRetryRejected = jest.fn();
    render(
      <ReviewStatus
        segments={SEGMENTS}
        review={{ ...review, rejected: 3, rejectedIdx: [1] }}
        onRetryRejected={onRetryRejected}
      />,
    );
    expect(screen.getByText('3')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('1 trecho alterado e 3 sem revisão.'));
    fireEvent.press(screen.getByLabelText('Revisar de novo os trechos sem revisão'));
    expect(onRetryRejected).toHaveBeenCalled();
  });
});
