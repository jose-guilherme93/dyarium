/**
 * Rich text simples baseado em markdown. O editor rico (WebView) fala HTML,
 * mas guardamos markdown no banco (compacto e renderizavel no dashboard). Este
 * modulo e puro e concentra as conversoes e a aplicacao de formatacao, para
 * testar de verdade.
 */

export type FormatType = 'bold' | 'italic' | 'list';

export interface Selection {
  start: number;
  end: number;
}

export interface FormatResult {
  text: string;
  selection: Selection;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function inlineToHtml(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/_([^_]+)_/g, '<i>$1</i>');
}

/** Converte markdown (negrito, italico, lista) em HTML para o editor. */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const line of lines) {
    if (/^- /.test(line)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineToHtml(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    out.push(line.trim() === '' ? '<div><br></div>' : `<div>${inlineToHtml(line)}</div>`);
  }
  closeList();
  return out.join('');
}

/** Converte o HTML produzido pelo editor de volta para markdown. */
export function htmlToMarkdown(html: string): string {
  let value = html;
  value = value.replace(/<br\s*\/?>/gi, '\n');
  value = value.replace(/<li[^>]*>/gi, '- ');
  value = value.replace(/<\/(div|p|li|ul)>/gi, '\n');
  value = value.replace(/<(b|strong)[^>]*>/gi, '**').replace(/<\/(b|strong)>/gi, '**');
  value = value.replace(/<(i|em)[^>]*>/gi, '_').replace(/<\/(i|em)>/gi, '_');
  value = value.replace(/<[^>]+>/g, '');
  value = unescapeHtml(value);
  value = value.replace(/[ \t]+\n/g, '\n');
  value = value.replace(/\n{3,}/g, '\n\n');
  return value.replace(/\n+$/, '');
}

/** Texto puro (sem marcadores) para contagem e previa. */
export function markdownToPlain(markdown: string): string {
  return markdown.replace(/\*\*/g, '').replace(/_/g, '').replace(/^-\s+/gm, '');
}

/** Numero de palavras do texto puro. */
export function countWords(markdown: string): number {
  const plain = markdownToPlain(markdown).trim();
  return plain ? plain.split(/\s+/).length : 0;
}

/**
 * Aplica formatacao a uma selecao. Negrito/italico envolvem a selecao com
 * marcadores; lista prefixa a linha. Devolve o novo texto e a nova selecao.
 */
export function applyMarkdownFormat(
  text: string,
  selection: Selection,
  type: FormatType,
): FormatResult {
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));

  if (type === 'list') {
    const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const next = `${text.slice(0, lineStart)}- ${text.slice(lineStart)}`;
    const pos = end + 2;
    return { text: next, selection: { start: pos, end: pos } };
  }

  const marker = type === 'bold' ? '**' : '_';
  const selected = text.slice(start, end) || 'texto';
  const next = `${text.slice(0, start)}${marker}${selected}${marker}${text.slice(end)}`;
  return {
    text: next,
    selection: { start: start + marker.length, end: start + marker.length + selected.length },
  };
}
