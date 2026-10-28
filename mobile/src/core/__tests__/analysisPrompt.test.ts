import {
  MAX_ANALYSIS_INPUT_CHARS,
  analysisContentHash,
  analysisNoteContent,
  analysisNoteSections,
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

  it('marca e corta notas acima do limite sem passar do orcamento', () => {
    const content = analysisNoteContent({ ...note, text: 'a'.repeat(MAX_ANALYSIS_INPUT_CHARS + 50) });
    expect(content.truncated).toBe(true);
    expect(content.text.length).toBeLessThanOrEqual(MAX_ANALYSIS_INPUT_CHARS);
  });

  it('divide o mesmo orcamento entre as secoes em vez de cortar o fim', () => {
    // Sem o fatiamento, as duas ultimas secoes nunca eram lidas.
    const text = [
      '# Trabalho',
      'x '.repeat(2000),
      '## Familia',
      'y '.repeat(2000),
      '## Saude',
      'z '.repeat(2000),
    ].join('\n\n');
    const content = analysisNoteContent({ title: 'Dia', text, transcript: '' });
    expect(content.truncated).toBe(true);
    expect(content.text.length).toBeLessThanOrEqual(MAX_ANALYSIS_INPUT_CHARS);
    expect(content.text).toContain('## Trabalho');
    expect(content.text).toContain('## Familia');
    expect(content.text).toContain('## Saude');
    // Cada secao contribui com texto, nao so com o titulo.
    expect(content.text).toMatch(/## Trabalho\nx/);
    expect(content.text).toMatch(/## Familia\ny/);
    expect(content.text).toMatch(/## Saude\nz/);
  });

  it('a transcricao longa divide o espaco com o corpo', () => {
    const content = analysisNoteContent({
      title: 'Dia',
      text: '# Nota\n' + 'a '.repeat(2500),
      transcript: 'fala '.repeat(1500),
    });
    expect(content.truncated).toBe(true);
    expect(content.text).toContain('## Transcrição');
    expect(content.text).toContain('## Nota');
    expect(content.text.length).toBeLessThanOrEqual(MAX_ANALYSIS_INPUT_CHARS);
  });

  it('nota que cabe vai inteira, sem titulos e sem custo novo', () => {
    const content = analysisNoteContent({
      title: 'Dia',
      text: '## Unica\nUm dia calmo.',
      transcript: '',
    });
    expect(content.truncated).toBe(false);
    expect(content.text).toBe('Unica\nUm dia calmo.');
  });
});

describe('analysisNoteSections', () => {
  it('quebra pelos titulos sem confundir # no meio da linha', () => {
    const sections = analysisNoteSections({
      text: 'linha # 1\n# Titulo\ncorpo',
      transcript: '',
    });
    expect(sections.map((section) => section.heading)).toEqual(['', 'Titulo']);
    expect(sections.map((section) => section.kind)).toEqual(['text', 'text']);
  });

  it('nao quebra dentro de bloco de codigo', () => {
    const sections = analysisNoteSections({
      text: 'antes\n```\n# nao e titulo\n```\ndepois',
      transcript: '',
    });
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('');
    expect(sections[0].text).toContain('depois');
  });

  it('poe a transcricao como secao propria quando difere do corpo', () => {
    const sections = analysisNoteSections({
      text: 'corpo escrito',
      transcript: 'fala transcrita',
    });
    expect(sections.map((section) => section.kind)).toEqual(['text', 'transcript']);
    expect(sections[1].text).toBe('fala transcrita');
  });
});

describe('buildAnalysisMessages', () => {
  it('nao mostra exemplo de JSON vazio para o modelo copiar', () => {
    const messages = buildAnalysisMessages({ title: 'Nota', text: 'texto' });
    expect(messages[0].content).not.toContain('"reading":""');
    expect(messages[0].content).toContain('Nunca devolva');
  });

  it('inclui a referencia do autor no prompt', () => {
    const messages = buildAnalysisMessages({
      title: 'Nota',
      text: 'texto',
      author: 'other',
      ownerName: 'Ana',
    });
    expect(messages[1].content).toContain('Autor do audio: outra pessoa');
    expect(messages[1].content).toContain('Ana');
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
    decisions: [],
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
