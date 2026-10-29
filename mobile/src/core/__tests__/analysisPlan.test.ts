import { planAnalysis } from '../analysisPlan';
import type { TranscriptSegment } from '../types';

const long = (word: string, count: number): string =>
  Array.from({ length: count }, () => word).join(' ');

function segment(start: number, end: number, text: string): TranscriptSegment {
  return { start_ms: start, end_ms: end, text };
}

describe('planAnalysis (texto escrito)', () => {
  it('leva ao modelo o texto puro, sem HTML nem codigo', () => {
    const plan = planAnalysis({
      text:
        '<div>Oi <b>Ana</b>, tudo bem?</div>\n\n```js\nconst lixo = 1;\n```\n\n' +
        'Depois fomos [ao parque](https://exemplo.com/x) e voltamos.',
      transcript: '',
    });
    const text = plan.blocks.map((block) => block.text).join('\n');
    expect(text).toContain('Oi Ana, tudo bem?');
    expect(text).toContain('Depois fomos ao parque e voltamos.');
    expect(text).not.toContain('<div>');
    expect(text).not.toContain('const lixo');
    expect(text).not.toContain('https://');
  });

  it('cada paragrafo com conteudo vira um bloco', () => {
    const plan = planAnalysis({
      text: `${long('trabalho', 30)}.\n\n${long('familia', 30)}.`,
      transcript: '',
    });
    expect(plan.blocks.map((block) => block.kind)).toEqual(['text', 'text']);
    expect(plan.blocks[0].text).toContain('trabalho');
    expect(plan.blocks[1].text).toContain('familia');
    expect(plan.blocks.map((block) => block.index)).toEqual([0, 1]);
  });

  it('funde paragrafo curto com o vizinho em vez de gastar uma chamada', () => {
    const plan = planAnalysis({
      text: `Bom dia.\n\n${long('trabalho', 30)}.`,
      transcript: '',
    });
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].text).toContain('Bom dia');
  });

  it('quebra paragrafo acima do teto em blocos de frase inteira', () => {
    const sentence = `${long('palavra', 20)}.`;
    const plan = planAnalysis({
      text: Array.from({ length: 6 }, () => sentence).join(' '),
      transcript: '',
    });
    expect(plan.blocks.length).toBeGreaterThan(1);
    for (const block of plan.blocks) {
      expect(block.chars).toBeLessThanOrEqual(900);
      expect(block.text.endsWith('.')).toBe(true);
    }
  });

  it('leva a ultima frase do bloco anterior como contexto', () => {
    const plan = planAnalysis({
      text: `${long('primeiro', 30)}. Fim do primeiro.\n\n${long('segundo', 30)}.`,
      transcript: '',
    });
    expect(plan.blocks[0].context).toBe('');
    expect(plan.blocks[1].context).toBe('Fim do primeiro.');
  });

  it('mantem o titulo markdown com o paragrafo, nao como bloco proprio', () => {
    const plan = planAnalysis({
      text: `# Trabalho\n\n${long('reuniao', 40)}.`,
      transcript: '',
    });
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].heading).toBe('Trabalho');
    expect(plan.blocks[0].text).toContain('reuniao');
  });
});

describe('planAnalysis (fala)', () => {
  it('agrupa trechos sem pausa e corta onde ha silencio', () => {
    const plan = planAnalysis({
      text: '',
      transcript: 'fala',
      transcriptSegments: [
        segment(0, 2000, 'primeira frase'),
        segment(2300, 4000, 'segunda frase'),
        segment(6500, 8000, 'outra conversa'),
      ],
    });
    expect(plan.blocks).toHaveLength(2);
    expect(plan.blocks[0].text).toBe('primeira frase segunda frase');
    expect(plan.blocks[0].startMs).toBe(0);
    expect(plan.blocks[0].endMs).toBe(4000);
    expect(plan.blocks[1].startMs).toBe(6500);
    expect(plan.blocks[1].kind).toBe('transcript');
  });

  it('usa o texto revisado quando existe', () => {
    const plan = planAnalysis({
      text: '',
      transcript: 'revisada',
      transcriptSegments: [
        { start_ms: 0, end_ms: 1000, text: 'texto cru', revised: 'texto revisado' },
      ],
    });
    expect(plan.blocks[0].text).toBe('texto revisado');
  });

  it('usa os segmentos quando a transcricao ainda nao foi juntada', () => {
    const plan = planAnalysis({
      text: '',
      transcript: '',
      transcriptSegments: [segment(0, 2000, 'fala que so existe no segmento')],
    });
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].kind).toBe('transcript');
    expect(plan.blocks[0].text).toBe('fala que so existe no segmento');
  });

  it('nao repete a transcricao quando ela ja e o corpo da nota', () => {
    const plan = planAnalysis({
      text: 'fui ao mercado',
      transcript: 'fui ao mercado',
    });
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].kind).toBe('text');
  });

  it('soma a duracao coberta pela transcricao', () => {
    const plan = planAnalysis({
      text: '',
      transcript: 'fala',
      transcriptSegments: [
        segment(0, 2000, 'um'),
        segment(9000, 12000, 'dois'),
      ],
    });
    expect(plan.audioMs).toBe(5000);
  });
});

describe('plano', () => {
  it('gera hash estavel e diferente quando o contexto muda', () => {
    const one = planAnalysis({ text: `${long('primeira', 20)}.\n\n${long('segunda', 20)}.`, transcript: '' });
    const two = planAnalysis({ text: `${long('primeira', 20)}.\n\n${long('segunda', 20)}.`, transcript: '' });
    expect(one.blocks.map((block) => block.hash)).toEqual(two.blocks.map((block) => block.hash));

    const changed = planAnalysis({ text: `${long('primeira', 20)}!\n\n${long('segunda', 20)}.`, transcript: '' });
    expect(changed.blocks[1].hash).not.toBe(two.blocks[1].hash);
  });

  it('nota vazia nao gera bloco', () => {
    expect(planAnalysis({ text: '   ', transcript: '' }).blocks).toEqual([]);
  });
});
