import {
  MAX_ANALYSIS_INPUT_CHARS,
  analysisNoteContent,
  buildAnalysisMessages,
  parseAnalysisJson,
} from '../analysisPrompt';

const note = {
  title: 'Um dia',
  text: 'Fui ao **enterro** da Ana.\n\nVoltei para casa.',
  transcript: 'Fui ao enterro da Ana. Voltei para casa.',
  recordedAt: '2026-01-02T12:00:00.000Z',
  dir: '',
  id: 'n1',
  segmentCount: 0,
  status: 'completed' as const,
  offset: 0,
  attempts: 0,
  createdAt: '2026-01-02T12:00:00.000Z',
  updatedAt: '2026-01-02T12:00:00.000Z',
};

describe('analysisNoteContent', () => {
  it('junta corpo em texto puro e transcricao sem duplicar', () => {
    const content = analysisNoteContent(note);
    expect(content.title).toBe('Um dia');
    expect(content.text).toContain('Fui ao enterro da Ana.');
    expect(content.text).not.toContain('**');
    expect(content.text.match(/Voltei para casa/g)).toHaveLength(1);
  });

  it('marca e corta notas acima do limite', () => {
    const content = analysisNoteContent({ ...note, text: 'a'.repeat(MAX_ANALYSIS_INPUT_CHARS + 50) });
    expect(content.truncated).toBe(true);
    expect(content.text).toHaveLength(MAX_ANALYSIS_INPUT_CHARS);
  });
});

describe('buildAnalysisMessages', () => {
  it('inclui titulo, data e conteudo delimitado', () => {
    const messages = buildAnalysisMessages({
      title: 'Um dia',
      text: 'Fui ao enterro.',
      recordedAt: '2026-01-02',
    });
    expect(messages[0].role).toBe('system');
    expect(messages[1].content).toContain('Titulo: Um dia');
    expect(messages[1].content).toContain('Data: 2026-01-02');
    expect(messages[1].content).toContain('<nota>\nFui ao enterro.\n</nota>');
  });
});

describe('parseAnalysisJson', () => {
  it('aceita JSON cercado por markdown e normaliza os campos', () => {
    const parsed = parseAnalysisJson(`\`\`\`json
    {
      "sentiment": { "score": 2, "label": "positivo" },
      "emotions": [{ "name": "Tristeza", "intensity": 1.4 }, { "name": "tristeza", "intensity": 0.2 }],
      "themes": [{ "name": "Familia", "confidence": 0.8 }],
      "people": [{ "name": " Ana " }, { "name": "ana" }],
      "places": [{ "name": "Praia" }],
      "events": [{ "name": "Enterro", "confidence": 0.7 }],
      "reading": "  Nota sobre um enterro.  "
    }
    \`\`\``);
    expect(parsed).not.toBeNull();
    expect(parsed?.sentiment.score).toBe(1);
    expect(parsed?.sentiment.label).toBe('positivo');
    expect(parsed?.emotions).toEqual([{ name: 'tristeza', value: 1 }]);
    expect(parsed?.themes).toEqual([{ name: 'familia', value: 0.8 }]);
    expect(parsed?.people).toEqual([{ name: 'Ana' }]);
    expect(parsed?.places).toEqual([{ name: 'Praia' }]);
    expect(parsed?.events).toEqual([{ name: 'enterro', value: 0.7 }]);
    expect(parsed?.reading).toBe('Nota sobre um enterro.');
  });

  it('deduz o rotulo quando o modelo manda um invalido', () => {
    const parsed = parseAnalysisJson(
      '{"sentiment":{"score":-0.8,"label":"muito ruim"},"emotions":[],"themes":[],"people":[],"places":[],"events":[],"reading":""}',
    );
    expect(parsed?.sentiment.label).toBe('negativo');
  });

  it('devolve null sem JSON ou sem sentimento', () => {
    expect(parseAnalysisJson('nao sei')).toBeNull();
    expect(parseAnalysisJson('{"emotions":[]}')).toBeNull();
    expect(parseAnalysisJson('{"sentiment":{"score":"x"}}')).toBeNull();
  });
});
