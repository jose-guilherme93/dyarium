/**
 * Contagem e previa do texto da nota.
 *
 * O markdown e o formato salvo; o editor e um campo de texto nativo e a
 * formatacao vira marcador no markdown (o dashboard e a leitura do app
 * desenham isso rico). Aqui ficam as contas, a previa e a formatacao.
 */

/** Formatos que a barra de acoes aplica no texto selecionado. */
export type FormatType =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'heading'
  | 'list'
  | 'ordered'
  | 'quote';

export interface Selection {
  start: number;
  end: number;
}

export interface FormatResult {
  text: string;
  selection: Selection;
}

/** URLs das imagens referenciadas no markdown, na ordem em que aparecem. */
export function extractImageUrls(markdown: string): string[] {
  const out: string[] = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) out.push(match[1]);
  return out;
}

/** Texto puro (sem marcadores) para contagem e previa. */
export function markdownToPlain(markdown: string): string {
  return (
    markdown
      // Codigo, tabela e mencao a outra nota nao sao texto do usuario: nao contam
      // como palavras da nota. Antes de tirar os marcadores, senao o fence some
      // e o codigo volta a contar.
      .replace(/^```[\s\S]*?^```[^\n]*$/gm, '')
      .replace(/^\|.*\|$/gm, '')
      .replace(/\[([^\]]*)\]\(note:[^)\s]+\)/g, '')
      // Imagem e link nao sao texto da nota: a imagem vira bloco na previa e o
      // link conta pelo rotulo (antes a URL inteira entrava na contagem). O
      // sufixo `{w=50}` e da imagem, nao texto: sem ele o card mostrava
      // "`{w=50}`" depois do texto.
      .replace(/!\[[^\]]*\]\([^)]*\)(?:\{w=\d+\})?/g, '')
      // Marcador de audio do documento: o player nao e texto da nota.
      .replace(/!audio\[[^\]]*\](?:\{d=[^}]*\})?/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*/g, '')
      .replace(/~~/g, '')
      .replace(/[`_]/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^-\s+/gm, '')
  );
}

/**
 * Previa de uma linha para o card da lista. Corta o markdown antes de converter:
 * a lista re-renderiza varios cards e nao pode parsear a nota inteira so para
 * mostrar a primeira linha.
 */
export function markdownPreview(markdown: string | undefined, maxChars = 240): string {
  const text = (markdown ?? '').trim();
  if (!text) return '';
  const cut = text.length > maxChars ? text.slice(0, maxChars) : text;
  return markdownToPlain(cut).replace(/\s+/g, ' ').trim();
}

/** Numero de palavras do texto puro. */
export function countWords(markdown: string): number {
  const plain = markdownToPlain(markdown).trim();
  return plain ? plain.split(/\s+/).length : 0;
}

/** Numero de caracteres do texto puro (com espacos). */
export function countChars(markdown: string): number {
  return markdownToPlain(markdown).length;
}

/**
 * Quebra o texto em linhas a cada fim de frase (`.`, `!`, `?`, `...`), para a
 * transcricao ficar como legenda. So quebra quando existe espaco depois do
 * sinal, entao numeros como "3.5" e URLs nao sao afetados.
 */
export function breakSentences(text: string): string {
  return text.replace(/([.!?…]+)\s+/g, '$1\n').trim();
}

/**
 * Aplica formatacao a uma selecao. Negrito/italico/tachado/codigo envolvem a
 * selecao com marcadores; titulo/lista/citacao prefixam a linha. Devolve o
 * novo texto e a nova selecao.
 */
export function applyMarkdownFormat(
  text: string,
  selection: Selection,
  type: FormatType,
): FormatResult {
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));

  if (type === 'list' || type === 'ordered' || type === 'heading' || type === 'quote') {
    const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const prefix =
      type === 'list' ? '- ' : type === 'ordered' ? '1. ' : type === 'quote' ? '> ' : '## ';
    const next = `${text.slice(0, lineStart)}${prefix}${text.slice(lineStart)}`;
    const pos = end + prefix.length;
    return { text: next, selection: { start: pos, end: pos } };
  }

  const marker =
    type === 'bold' ? '**' : type === 'italic' ? '_' : type === 'strike' ? '~~' : '`';
  const selected = text.slice(start, end) || 'texto';
  const next = `${text.slice(0, start)}${marker}${selected}${marker}${text.slice(end)}`;
  return {
    text: next,
    selection: { start: start + marker.length, end: start + marker.length + selected.length },
  };
}

/**
 * Coloca um link no texto selecionado (ou insere a URL no cursor quando nao ha
 * selecao). O rotulo e o texto escolhido; sem selecao, a propria URL.
 */
export function applyMarkdownLink(text: string, selection: Selection, url: string): FormatResult {
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  const label = text.slice(start, end) || url;
  const link = `[${label}](${url})`;
  const next = `${text.slice(0, start)}${link}${text.slice(end)}`;
  return {
    text: next,
    selection: { start: start + 1, end: start + 1 + label.length },
  };
}
