import {
  CAPTURE_NOTEBOOK,
  CAPTURE_OPTIONS,
  buildCapture,
  captureTitle,
  segmentText,
} from '../transcriptCapture';
import type { TranscriptSegment } from '../types';

const segment: TranscriptSegment = {
  start_ms: 83_000,
  end_ms: 90_000,
  text: 'preciso comprar  leite amanha cedo',
};

describe('captura de um trecho da transcricao', () => {
  it('usa a revisao quando existe e normaliza os espacos', () => {
    expect(segmentText({ ...segment, revised: 'Preciso comprar leite.' })).toBe(
      'Preciso comprar leite.',
    );
    expect(segmentText(segment)).toBe('preciso comprar leite amanha cedo');
  });

  it('corta o titulo em palavra inteira', () => {
    expect(captureTitle('curto')).toBe('curto');
    const long = captureTitle('palavra '.repeat(30));
    expect(long.endsWith('...')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(75);
    expect(long).not.toContain('  ');
  });

  it('monta a nota com o trecho entre aspas e a origem', () => {
    const draft = buildCapture('task', segment, {
      noteTitle: 'Nota de quinta',
      stamp: '01:23',
    });

    expect(draft.tag).toBe('tarefa');
    expect(draft.title).toBe('preciso comprar leite amanha cedo');
    expect(draft.text).toBe('“preciso comprar leite amanha cedo”\n\n— Nota de quinta, 01:23');
  });

  it('sem titulo da nota, a origem e so a minutagem', () => {
    const draft = buildCapture('idea', segment, { noteTitle: '  ', stamp: '01:23' });
    expect(draft.text.endsWith('— 01:23')).toBe(true);
    expect(draft.tag).toBe('ideia');
  });

  it('cada tipo tem sua tag e o caderno e unico', () => {
    expect(CAPTURE_OPTIONS.map((option) => option.tag)).toEqual(['tarefa', 'ideia', 'citação']);
    expect(CAPTURE_NOTEBOOK).toBe('Tarefas e ideias');
  });
});
