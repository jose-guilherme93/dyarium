/**
 * Texto puro para a analise.
 *
 * O modelo so deve ler prosa. Antes dele, tudo o que nao e fala ou escrita do
 * autor sai: tags e entidades HTML, cercas de codigo, tabelas, imagens, links,
 * URLs, marcadores de audio, carimbos de tempo, emojis, caracteres invisiveis e
 * linhas que so tem simbolo. Os paragrafos sobrevivem, porque sao a unidade do
 * plano de leitura.
 *
 * A regra e a mesma do servidor (`internal/analyze/clean.go`): o que o aparelho
 * manda e o que o servidor le sao o mesmo texto, so com o transporte no meio.
 * Puro e sem IO: testado isolado.
 */

/** Entidades nomeadas que aparecem em notas coladas de HTML. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '-',
  mdash: '-',
  hellip: '...',
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
  bull: ' ',
  middot: ' ',
  copy: '',
  reg: '',
  trade: '',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, body: string) => {
    const key = body.toLowerCase();
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : ' ';
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : ' ';
    }
    // Entidade desconhecida nao pode virar palavra: o modelo leria o nome dela.
    return NAMED_ENTITIES[key] ?? ' ';
  });
}

/** Simbolos pictograficos e de bandeira: nao acrescentam conteudo a leitura. */
const EMOJI =
  /[\u{1f000}-\u{1faff}\u{1f1e6}-\u{1f1ff}\u{2600}-\u{27bf}\u{2b00}-\u{2bff}\u{fe0e}\u{fe0f}\u{200d}\u{20e3}]/gu;
/** Zero-width, marcas bidirecionais e hifen suave. */
const INVISIBLE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
/** Controle que nao e quebra de linha nem tabulacao. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/** A linha tem alguma letra ou numero? Linha so de simbolo nao e prosa. */
const HAS_WORD = /[0-9a-z\u00c0-\u024f\u1e00-\u1eff]/i;

/**
 * Texto que o modelo deve ler. Idempotente: limpar de novo nao muda nada.
 *
 * Nao mexe no conteudo salvo nem na revisao: so na copia que entra no prompt.
 */
export function toAnalysisText(value: string): string {
  if (!value) return '';
  let text = value.replace(/\r\n?/g, '\n');

  // 1. Blocos que nunca sao prosa do autor.
  text = text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|svg|math|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|article|pre)\s*>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text);

  // 2. Marcadores de documento que nao sao texto: imagem, audio, link e URL.
  text = text
    .replace(/!\[[^\]]*\]\([^)]*\)(?:\{w=\d+\})?/g, ' ')
    .replace(/!audio\[[^\]]*\](?:\{d=[^}]*\})?/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>"']*[^\s<>"'.,;:!?)]/gi, ' ')
    // Um link que sobra como "rotulo ()" depois de tirar a URL nao acrescenta nada.
    .replace(/\(\s*\)/g, ' ');

  // 3. Codigo e marcas de formato do markdown.
  text = text
    // Cerca de codigo inteira: o conteudo dela nao e a nota.
    .replace(/(^|\n)[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?(?:\n[ \t]*(?:```|~~~)[^\n]*(?=\n|$)|$)/g, '\n')
    // Codigo inline curto normalmente e um termo da propria frase; fica sem as crases.
    .replace(/`{1,3}([^`\n]{0,120})`{1,3}/g, '$1')
    // Marcador de lista, citacao e titulo no comeco da linha.
    .replace(/(^|\n)[ \t]*(?:[-*+\u2022]|\d{1,3}[.)])[ \t]+/g, '$1')
    .replace(/(^|\n)[ \t]*>[ \t]?/g, '$1')
    .replace(/(^|\n)[ \t]*#{1,6}[ \t]+/g, '$1')
    // Enfase e riscado: a palavra fica, o marcador nao.
    .replace(/[*_~]{1,3}/g, '')
    // Carimbo de tempo nao e fala; o tempo real vem dos segmentos.
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, ' ');

  // 4. Invisiveis e simbolos.
  text = text.replace(EMOJI, ' ').replace(INVISIBLE, ' ').replace(CONTROL, ' ');

  // Tirar uma imagem ou um emoji deixa espaco antes da pontuacao da frase.
  text = text.replace(/[ \t]+([.,;:!?])/g, '$1');

  // 5. Espaco normal, paragrafos preservados.
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) paragraphs.push(current.join(' '));
    current = [];
  };
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/[ \t\f\v]+/g, ' ').trim();
    if (line === '') {
      flush();
      continue;
    }
    if (!HAS_WORD.test(line)) continue;
    current.push(line);
  }
  flush();
  return paragraphs.join('\n\n');
}
