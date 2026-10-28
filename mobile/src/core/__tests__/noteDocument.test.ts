import { htmlToMarkdown } from '../noteHtml';
import {
  insertIntoNoteNodes,
  insertNoteNode,
  markdownIndexAtVisibleOffset,
  MAX_TEXT_CHARS,
  noteAudioNodes,
  noteImageNodes,
  parseNoteDocument,
  removeFromNoteNodes,
  removeNoteNode,
  replaceAudioRef,
  sameNoteContent,
  revealIndexForLines,
  serializeNoteDocument,
  setNoteNodeWidth,
  splitMarkdownAtCursor,
  type NoteTextNode,
} from '../noteDocument';

const image = {
  kind: 'image' as const,
  id: 'i1',
  ref: 'local:foto.jpg',
  alt: 'foto',
  width: 50,
};

const audio = {
  kind: 'audio' as const,
  id: 'a2',
  ref: 'local:audio.aac',
  durationMs: 12_500,
};

describe('parseNoteDocument', () => {
  it('le texto, imagem, texto, audio e texto na ordem', () => {
    const markdown = [
      'A',
      '![foto](local:foto.jpg){w=50}',
      'B',
      '!audio[local:audio.aac]{d=12.5}',
      'C',
    ].join('\n');

    const nodes = parseNoteDocument(markdown);

    expect(nodes.map((node) => node.kind)).toEqual(['text', 'image', 'text', 'audio', 'text']);
    // O texto de um no e o conteudo que o editor mostra; as quebras que
    // fecham a linha antes da midia ficam no separador do no.
    expect(nodes[0]).toMatchObject({ kind: 'text', markdown: 'A', breakAfter: '\n' });
    expect(nodes[1]).toMatchObject({ ...image, breakAfter: '\n' });
    expect(nodes[2]).toMatchObject({ kind: 'text', markdown: 'B', breakAfter: '\n' });
    expect(nodes[3]).toMatchObject({ ...audio, id: 'a3', breakAfter: '\n' });
    expect(nodes[4]).toMatchObject({ kind: 'text', markdown: 'C' });
  });

  it('preserva o markdown exatamente no ida e volta', () => {
    for (const markdown of [
      '',
      'A',
      'A\n\nB',
      '\n\nA',
      'A\n\n',
      'A\n![x](local:x.jpg){w=40}\n\nB\n!audio[attachment:at_1]\nC',
      '# Titulo\n\n- item\n- outro',
      'texto com ![inline](local:i.jpg) no meio',
    ]) {
      expect(serializeNoteDocument(parseNoteDocument(markdown))).toBe(markdown);
    }
  });

  it('o texto inteiro e um no so, sem perder linhas', () => {
    const markdown = Array.from({ length: 200 }, (_value, index) => `linha ${index + 1}`).join('\n');
    const nodes = parseNoteDocument(markdown);

    // Um editor so para o texto da nota: um por paragrafo fazia o campo ser
    // desmontado e remontado a cada troca de paragrafo.
    expect(nodes).toHaveLength(1);
    expect(nodes.every((node) => node.kind === 'text')).toBe(true);
    expect(serializeNoteDocument(nodes)).toBe(markdown);
  });

  it('lista audios e imagens na ordem', () => {
    const markdown = 'A\n![f](local:f.jpg)\nB\n!audio[attachment:a1]\nC\n!audio[local:b.aac]{d=3}';
    expect(noteAudioNodes(markdown)).toEqual([
      { kind: 'audio', id: 'a3', ref: 'attachment:a1', durationMs: 0, breakAfter: '\n' },
      { kind: 'audio', id: 'a5', ref: 'local:b.aac', durationMs: 3000, breakAfter: '' },
    ]);
    expect(noteImageNodes(markdown)).toEqual([
      { kind: 'image', id: 'i1', ref: 'local:f.jpg', alt: 'f', width: 100, breakAfter: '\n' },
    ]);
  });
});

describe('splitMarkdownAtCursor', () => {
  it('divide texto simples no cursor', () => {
    expect(splitMarkdownAtCursor('ABCDE', 2)).toEqual({ before: 'AB', after: 'CDE' });
  });

  it('fecha e reabre a enfase quando a divisao cai no meio', () => {
    expect(splitMarkdownAtCursor('**AB**', 1)).toEqual({ before: '**A**', after: '**B**' });
  });

  it('fecha e reabre codigo inline', () => {
    expect(splitMarkdownAtCursor('`abc`', 1)).toEqual({ before: '`a`', after: '`bc`' });
  });

  it('regete o prefixo de lista na segunda metade', () => {
    expect(splitMarkdownAtCursor('- item', 2)).toEqual({ before: '- it', after: '- em' });
  });

  it('divide antes do marcador quando o cursor esta no comeco da linha', () => {
    expect(splitMarkdownAtCursor('- item', 0)).toEqual({ before: '', after: '- item' });
  });

  it('conta apenas o texto visivel', () => {
    expect(markdownIndexAtVisibleOffset('**AB** CDE', 3)).toBe(7);
    expect(markdownIndexAtVisibleOffset('# Titulo', 2)).toBe(4);
    expect(markdownIndexAtVisibleOffset('![f](local:f.jpg) A', 1)).toBe(17);
  });
});

describe('insertNoteNode', () => {
  it('coloca a foto no meio do texto', () => {
    const markdown = insertNoteNode('ABC', image, { nodeId: 't0', offset: 1 });
    expect(markdown).toBe('A\n![foto](local:foto.jpg){w=50}\nBC');
  });

  it('coloca o audio entre B e C', () => {
    const markdown = insertNoteNode('ABC', audio, { nodeId: 't0', offset: 2 });
    expect(markdown).toBe('AB\n!audio[local:audio.aac]{d=12.5}\nC');
  });

  it('deixa um trecho vazio para continuar digitando depois do no', () => {
    const markdown = insertNoteNode('A', image, { nodeId: 't0', offset: 1 });
    expect(markdown).toBe('A\n![foto](local:foto.jpg){w=50}\n');
    // O trecho vazio sobrevive ao parse: e ele que vira o editor abaixo da
    // foto. Sem ele, a nota nao tinha onde digitar depois da imagem.
    expect(parseNoteDocument(markdown).map((node) => node.kind)).toEqual([
      'text',
      'image',
      'text',
    ]);
  });

  it('a midia no fim do documento deixa um trecho para digitar embaixo', () => {
    const nodes = parseNoteDocument('A\n![foto](local:f.jpg)');
    expect(nodes.map((node) => node.kind)).toEqual(['text', 'image', 'text']);
    expect(serializeNoteDocument(nodes)).toBe('A\n![foto](local:f.jpg)');
  });

  it('texto digitado abaixo da foto entra na linha seguinte', () => {
    const nodes = parseNoteDocument('A\n![foto](local:f.jpg)');
    const tail = nodes[nodes.length - 1];
    expect(tail.kind).toBe('text');
    const next = nodes.map((node) =>
      node.id === tail.id && node.kind === 'text' ? { ...node, markdown: 'B' } : node,
    );

    expect(serializeNoteDocument(next)).toBe('A\n![foto](local:f.jpg)\nB');
    expect(parseNoteDocument(serializeNoteDocument(next)).map((node) => node.kind)).toEqual([
      'text',
      'image',
      'text',
    ]);
  });

  it('duas fotos seguidas mantem a ordem e o texto de cima', () => {
    const first = insertIntoNoteNodes(parseNoteDocument('A'), image, {
      nodeId: 't0',
      offset: 1,
    });
    const tail = first[first.length - 1];
    const second = insertIntoNoteNodes(
      first,
      { ...image, id: 'i2', ref: 'local:duas.jpg' },
      { nodeId: tail.id, offset: 0 },
    );

    expect(serializeNoteDocument(second)).toBe(
      'A\n![foto](local:foto.jpg){w=50}\n![foto](local:duas.jpg){w=50}\n',
    );
    // O texto que estava acima da primeira foto continua no comeco.
    expect((second[0] as NoteTextNode).markdown).toBe('A');
  });

  it('sem cursor valido, coloca no fim', () => {
    expect(insertNoteNode('A', audio)).toBe('A\n!audio[local:audio.aac]{d=12.5}\n');
    expect(insertNoteNode('', audio)).toBe('!audio[local:audio.aac]{d=12.5}\n');
  });
});

describe('removeNoteNode', () => {
  it('remove a foto e mantem o texto dos dois lados', () => {
    const markdown = 'A\n![foto](local:foto.jpg){w=50}\nB';
    expect(removeNoteNode(markdown, 'i1')).toBe('A\nB');
  });

  it('remove o audio e mantem a ordem restante', () => {
    const markdown = 'A\n!audio[local:a.aac]{d=3}\nB';
    expect(removeNoteNode(markdown, 'a1')).toBe('A\nB');
  });

  it('junta os dois trechos de texto que ficaram vizinhos', () => {
    const markdown = 'A\n![foto](local:foto.jpg)\nB\n!audio[local:a.aac]\nC';
    const withoutImage = removeNoteNode(markdown, 'i1');

    expect(withoutImage).toBe('A\nB\n!audio[local:a.aac]\nC');
    // O texto de cima e o de baixo viram um no so (o audio ainda os separa).
    expect(parseNoteDocument(withoutImage).filter((node) => node.kind === 'text')).toHaveLength(
      2,
    );
  });

  it('nao mexe quando o no nao existe', () => {
    expect(removeNoteNode('A\nB', 'i9')).toBe('A\nB');
  });

  it('remove na propria lista, sem recalcular ids', () => {
    const nodes = parseNoteDocument('A\n![foto](local:f.jpg)\nB');
    const imageNode = nodes.find((node) => node.kind === 'image');
    expect(imageNode).toBeDefined();
    const next = removeFromNoteNodes(nodes, imageNode!.id);

    expect(serializeNoteDocument(next)).toBe('A\nB');
    expect(next[0].id).toBe(nodes[0].id);
  });
});

describe('replaceAudioRef', () => {
  it('troca local: pelo anexo do servidor sem tocar no resto', () => {
    const markdown = 'A\n!audio[local:audio.aac]{d=12.5}\nB';
    expect(replaceAudioRef(markdown, 'local:audio.aac', 'attachment:at_1')).toBe(
      'A\n!audio[attachment:at_1]{d=12.5}\nB',
    );
  });
});

describe('o texto da nota pelo editor', () => {
  it('nao cresce quando o editor devolve o texto de novo', () => {
    // O editor devolve o HTML no formato interno dele (uma quebra depois de
    // cada tag). Sem tirar essa quebra, cada linha em branco voltava dobrada
    // e o texto da nota crescia a cada gravacao.
    const markdown = 'A\n\nB\n\nC';
    const html = '<html>\n<p>A</p>\n<br>\n<p>B</p>\n<br>\n<p>C</p>\n</html>';

    const nodes = parseNoteDocument(markdown);
    const next = nodes.map((node) =>
      node.kind === 'text' ? { ...node, markdown: htmlToMarkdown(html) } : node,
    );

    expect(serializeNoteDocument(next)).toBe(markdown);
  });
});

describe('o texto da nota', () => {
  it('e um no so (todos os paragrafos juntos)', () => {
    // Um editor so para o texto inteiro: um editor por paragrafo fazia o
    // campo ser desmontado e remontado a cada troca de paragrafo.
    const paragraph = Array.from({ length: 20 }, (_value, index) => `linha ${index + 1}`).join('\n');
    const nodes = parseNoteDocument(paragraph);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: 'text' });
    expect((nodes[0] as NoteTextNode).markdown).toBe(paragraph);
    expect(serializeNoteDocument(nodes)).toBe(paragraph);
  });

  it('os paragrafos com linha em branco continuam no mesmo no', () => {
    const markdown = 'A\n\nB\n\nC';
    const nodes = parseNoteDocument(markdown);

    expect(nodes).toHaveLength(1);
    expect(serializeNoteDocument(nodes)).toBe(markdown);
  });

  it('corta uma linha longa em partes e devolve o texto exato', () => {
    // Um texto sem nenhuma quebra: o corte tem de ser no meio da linha, em
    // fronteira de palavra, e o texto do usuario volta igual.
    const paragraph = 'palavra '.repeat(2000).trim();
    const nodes = parseNoteDocument(paragraph);

    expect(nodes.length).toBeGreaterThan(1);
    expect(serializeNoteDocument(nodes)).toBe(paragraph);
    for (const node of nodes) {
      if (node.kind !== 'text') continue;
      expect(node.markdown.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    }
    // As partes voltam coladas: o markdown do usuario nao muda.
    expect(serializeNoteDocument(nodes)).toBe(paragraph);
  });

  it('remover um no entre partes coladas nao perde a quebra de linha', () => {
    // "abc def ghi" (uma linha so) e cortado em duas partes, e uma foto vem
    // depois. Tirar a foto nao pode colar o texto sem a quebra.
    const paragraph = `${'palavra '.repeat(60)}`.trim();
    const markdown = `${paragraph}\n![foto](local:f.jpg)\noutro`;
    const nodes = parseNoteDocument(markdown);
    const image = nodes.find((node) => node.kind === 'image');
    expect(image).toBeDefined();

    const without = removeNoteNode(markdown, image!.id);

    expect(without).toContain('\n');
    // A volta tem que devolver exatamente o que foi tirado.
    expect(serializeNoteDocument(parseNoteDocument(without))).toBe(without);
  });

  it('a midia separa o texto em dois nos', () => {
    const nodes = parseNoteDocument('A\n\n![foto](local:f.jpg)\n\nB');
    expect(nodes.map((node) => node.kind)).toEqual(['text', 'image', 'text']);
    expect(serializeNoteDocument(nodes)).toBe('A\n\n![foto](local:f.jpg)\n\nB');
  });
});

describe('setNoteNodeWidth', () => {
  it('muda a largura da foto e mantem o resto do documento', () => {
    const markdown = 'A\n![foto](local:foto.jpg){w=30}\nB';
    expect(setNoteNodeWidth(markdown, 'i1', 100)).toBe('A\n![foto](local:foto.jpg)\nB');
  });

  it('guarda a largura no markdown, que e o que viaja com a nota', () => {
    const markdown = '![foto](local:foto.jpg){w=100}\nB';
    expect(setNoteNodeWidth(markdown, 'i0', 50)).toBe('![foto](local:foto.jpg){w=50}\nB');
  });

  it('mantem a largura dentro da faixa segura', () => {
    expect(setNoteNodeWidth('![foto](local:foto.jpg)', 'i0', 5)).toBe(
      '![foto](local:foto.jpg){w=15}',
    );
    expect(setNoteNodeWidth('![foto](local:foto.jpg)', 'i0', 400)).toBe(
      '![foto](local:foto.jpg)',
    );
  });

  it('nao mexe quando o no nao existe ou a largura ja e a mesma', () => {
    expect(setNoteNodeWidth('A\nB', 'i9', 50)).toBe('A\nB');
    expect(setNoteNodeWidth('![foto](local:foto.jpg){w=50}', 'i0', 50)).toBe(
      '![foto](local:foto.jpg){w=50}',
    );
  });
});

describe('sameNoteContent', () => {
  it('ignora normalizacao de espacos e de marcadores', () => {
    expect(sameNoteContent('A  \nB\n', 'A\nB')).toBe(true);
    expect(sameNoteContent('![](local:f.jpg)', '![](local:f.jpg){w=100}')).toBe(true);
    expect(sameNoteContent('!audio[local:a.aac]{d=5.0}', '!audio[local:a.aac]{d=5}')).toBe(true);
  });

  it('detecta texto editado', () => {
    expect(sameNoteContent('A\nB', 'A\nC')).toBe(false);
    expect(sameNoteContent('foto ![x](local:f.jpg)', 'foto')).toBe(false);
  });
});

describe('revealIndexForLines', () => {
  it('revela o documento inteiro quando cabe no limite de linhas', () => {
    const nodes = parseNoteDocument('A\nB\nC');
    expect(revealIndexForLines(nodes, 60)).toBe(nodes.length);
  });

  it('revela o documento inteiro de uma nota so de texto', () => {
    const long = Array.from({ length: 40 }, (_, i) => `paragrafo ${i}`).join('\n');
    const nodes = parseNoteDocument(long);
    // Um unico no de texto grande demais pra 60 linhas: vem inteiro.
    expect(nodes).toHaveLength(1);
    expect(revealIndexForLines(nodes, 60)).toBe(1);
  });

  it('para no no que cruza o limite de linhas, sem cortar o texto', () => {
    // 55 linhas de texto + uma foto: o texto vem inteiro, a foto tambem.
    const body = Array.from({ length: 55 }, (_, i) => `linha ${i}`).join('\n');
    const nodes = parseNoteDocument(`${body}\n![foto](local:foto.jpg)`);
    expect(revealIndexForLines(nodes, 60)).toBe(nodes.length);
  });

  it('esconde o que passa do limite num documento com midias intercaladas', () => {
    // Um paragrafo longo (70 linhas, cruza o limite) seguido de 40 fotos: o
    // texto vem inteiro de imediato e as fotos sao reveladas depois.
    const intro = Array.from({ length: 70 }, (_, i) => `intro ${i}`).join('\n');
    const photos = Array.from({ length: 40 }, (_, i) => `![f](local:f${i}.jpg)`).join('\n');
    const nodes = parseNoteDocument(`${intro}\n${photos}`);
    // O parser coloca um no de texto vazio entre fotos consecutivas, entao
    // sao 40 fotos + 39 vazios + 1 vazio no fim, mais o texto inicial.
    expect(nodes.length).toBe(81);
    expect(revealIndexForLines(nodes, 60)).toBe(1);
  });

  it('conta as linhas so dos nos de texto (ignora vazios e midias)', () => {
    // Dezenas de fotos antes do paragrafo longo: os nos vazios entre elas nao
    // contam linha, e o texto so aparece no fim, cruzando 60 linhas.
    const photos = Array.from({ length: 30 }, (_, i) => `![f](local:f${i}.jpg)`).join('\n');
    const body = Array.from({ length: 70 }, (_, i) => `linha ${i}`).join('\n');
    const nodes = parseNoteDocument(`${photos}\n${body}`);
    // 30 fotos + 29 vazios entre elas (o parser nao repete no fim porque o
    // texto final vem depois) + 1 texto = 60 nos.
    expect(nodes.length).toBe(60);
    // O texto so no fim cruza 60 linhas: revela o documento inteiro.
    expect(revealIndexForLines(nodes, 60)).toBe(60);
  });
});
