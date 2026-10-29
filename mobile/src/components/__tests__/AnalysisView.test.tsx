import { fireEvent, render, screen } from '@testing-library/react-native';

import type { NoteAnalysisView } from '@/core/analysis';
import { AnalysisView } from '../AnalysisView';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const analysis: NoteAnalysisView = {
  sentiment: 0.4,
  sentimentLabel: 'positivo',
  summary: 'Uma despedida anunciada, sobre Ana.',
  reading: '',
  sentenceSource: 'model',
  sections: [],
  themes: ['familia'],
  emotions: [{ name: 'saudade', intensity: 0.5 }],
  people: ['Ana'],
  peopleDetail: [{ name: 'Ana', count: 2 }],
  places: [],
  placesDetail: [],
  moments: [],
  questions: [],
  decisions: [],
  tasks: [],
  ideas: [],
  events: [],
  epiphanies: [],
  comprehension: null,
  comprehensionSource: '',
  stutterRate: 0,
  hesitationRate: 0,
  coverage: null,
  contractVersion: 2,
};

describe('AnalysisView', () => {
  it('mostra a analise e o botao unico de analisar', () => {
    render(
      <AnalysisView
        visible
        title="Despedida"
        analysis={analysis}
        analysisEnabled
        analysisReady
        analysisLowPower={false}
        analysisModelLabel="Qwen3 0.6B"
        onAnalyzeLocal={jest.fn()}
        onChangeAnalysisModel={jest.fn()}
        onOpenProcessing={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Análise')).toBeTruthy();
    expect(screen.getByText('positivo')).toBeTruthy();
    expect(screen.getByText('Ana 2')).toBeTruthy();
    expect(screen.getByText('Analisar nota')).toBeTruthy();
    expect(screen.queryByText('Analisar de novo')).toBeNull();
  });

  it('sem analise ainda oferece analisar e o processamento', () => {
    const onProcess = jest.fn();
    render(
      <AnalysisView
        visible
        title="Nota"
        analysis={null}
        analysisEnabled
        analysisReady
        onAnalyzeLocal={jest.fn()}
        onOpenProcessing={onProcess}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Sem análise para esta nota.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Abrir processamento da nota'));
    expect(onProcess).toHaveBeenCalledTimes(1);
  });

  it('avisa quando o modelo nao reconheceu nada', () => {
    render(
      <AnalysisView
        visible
        title="Nota"
        analysis={{
          ...analysis,
          themes: [],
          emotions: [],
          people: [],
          peopleDetail: [],
          placesDetail: [],
        }}
        analysisEnabled
        analysisReady
        onAnalyzeLocal={jest.fn()}
        onChangeAnalysisModel={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(
      screen.getByText('Nada reconhecido. Tente a versão de qualidade ou um modelo maior.'),
    ).toBeTruthy();
  });

  it('mostra a frase de andamento enquanto a passada roda', () => {
    render(
      <AnalysisView
        visible
        title="Nota"
        analysis={null}
        analysisEnabled
        analysisReady
        analysisBusy
        analysisStage="queued"
        analysisProgress={{ read: 0, total: 0 }}
        onAnalyzeLocal={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Na fila...')).toBeTruthy();
  });
});
