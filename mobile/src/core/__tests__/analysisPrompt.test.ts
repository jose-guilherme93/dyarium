import {
  MAX_ANALYSIS_INPUT_CHARS,
  analysisContentHash,
  analysisNoteContent,
  buildAnalysisMessages,
  interpretationOrOriginal,
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
  it('nao mostra exemplo de JSON vazio para o modelo copiar', () => {
    const messages = buildAnalysisMessages({ title: 'Nota', text: 'texto' });
    expect(messages[0].content).not.toContain('"reading":""');
    expect(messages[0].content).toContain('Nunca devolva');
  });

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

describe('analysisContentHash', () => {
  it('muda quando o texto, o titulo ou a transcricao mudam', () => {
    const base = analysisContentHash({ title: 'Nota', text: 'texto', transcript: 'audio' });
    expect(analysisContentHash({ title: 'Nota', text: 'texto', transcript: 'audio' })).toBe(base);
    expect(analysisContentHash({ title: 'Outra', text: 'texto', transcript: 'audio' })).not.toBe(base);
    expect(analysisContentHash({ title: 'Nota', text: 'texto novo', transcript: 'audio' })).not.toBe(base);
    expect(analysisContentHash({ title: 'Nota', text: 'texto', transcript: 'outro' })).not.toBe(base);
  });

  it('ignora markdown e espacos redundantes', () => {
    expect(analysisContentHash({ title: 'Nota', text: '  um   **texto**  ' })).toBe(
      analysisContentHash({ title: 'Nota', text: 'um texto' }),
    );
  });
});

describe('interpretationOrOriginal', () => {
  const input = 'Hoje acordei cansado, fui caminhar no parque e voltei melhor.';
  const parsed = {
    sentiment: { score: 0.3, label: 'positivo' as const },
    emotions: [{ name: 'alivio', value: 0.7 }],
    themes: [{ name: 'caminhada', value: 0.8 }],
    people: [],
    places: [{ name: 'parque' }],
    events: [],
    reading: 'Um dia que comeca cansado e melhora com a caminhada.',
  };

  it('mantem uma leitura que interpreta a nota', () => {
    expect(interpretationOrOriginal(parsed, input).reading).toBe(parsed.reading);
  });

  it('troca a leitura quando ela repete o texto', () => {
    const copied = interpretationOrOriginal({ ...parsed, reading: input }, input);
    expect(copied.reading).not.toBe(input);
    expect(copied.reading).toContain('Tom positivo');
    expect(copied.reading).toContain('caminhada');
    expect(copied.reading).toContain('alivio');
  });
});

describe('parseAnalysisJson com resposta cortada', () => {
  it('fecha JSON interrompido no meio da string', () => {
    const raw =
      '{"sentiment":{"score":0.4,"label":"positivo"},"emotions":[{"name":"alegria","intensity":0.8}],"themes":[{"name":"familia","confidence":0.7}],"people":[],"places":[],"events":[],"reading":"Um dia';
    const parsed = parseAnalysisJson(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.sentiment.score).toBe(0.4);
    expect(parsed?.reading).toBe('Um dia');
    expect(parsed?.themes).toEqual([{ name: 'familia', value: 0.7 }]);
  });

  it('fecha a chave final que faltou', () => {
    const raw =
      '{"sentiment":{"score":-0.5,"label":"negativo"},"emotions":[],"themes":[],"people":[],"places":[],"events":[],"reading":"Triste"';
    const parsed = parseAnalysisJson(raw);
    expect(parsed?.sentiment.label).toBe('negativo');
    expect(parsed?.reading).toBe('Triste');
  });
});
