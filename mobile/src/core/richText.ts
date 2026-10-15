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

function inlineToHtml(value: string, imageSources?: Record<string, string>): string {
  return escapeHtml(value)
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)\)(?:\{w=(\d+)\})?/g,
      (_match, alt: string, url: string, width?: string) => {
        const display = imageSources?.[url] ?? url;
        const w = width ? ` width="${width}%" data-width="${width}"` : '';
        return `<img src="${display}" data-src="${url}" alt="${alt}"${w} style="max-width:100%">`;
      },
    )
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/_([^_]+)_/g, '<i>$1</i>');
}

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{w=(\d+)\})?$/;

/** URLs das imagens referenciadas no markdown, na ordem em que aparecem. */
export function extractImageUrls(markdown: string): string[] {
  const out: string[] = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) out.push(match[1]);
  return out;
}

/** Converte markdown (negrito, italico, lista) em HTML para o editor. */
export function markdownToHtml(markdown: string, imageSources?: Record<string, string>): string {
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
      out.push(`<li>${inlineToHtml(line.slice(2), imageSources)}</li>`);
      continue;
    }
    closeList();
    const image = IMAGE_LINE.exec(line.trim());
    if (image) {
      const display = imageSources?.[image[2]] ?? image[2];
      const w = image[3] ? ` width="${image[3]}%" data-width="${image[3]}"` : '';
      out.push(
        `<div class="img-block" contenteditable="false"><img src="${escapeHtml(display)}" data-src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}"${w}></div>`,
      );
      continue;
    }
    out.push(
      line.trim() === '' ? '<div><br></div>' : `<div>${inlineToHtml(line, imageSources)}</div>`,
    );
  }
  closeList();
  // Sempre sobra um paragrafo depois da ultima imagem: da pra digitar embaixo.
  const last = out[out.length - 1];
  if (last && last.startsWith('<div class="img-block"')) {
    out.push('<div><br></div>');
  }
  return out.join('');
}

/** Converte o HTML produzido pelo editor de volta para markdown. */
export function htmlToMarkdown(html: string): string {
  let value = html;
  // Bloco de imagem vira uma linha propria: preserva a ordem e a largura, e
  // evita que a alca de redimensionar vire sujeira no markdown.
  value = value.replace(/<div class="img-block"[\s\S]*?<\/div>/gi, (block) => {
    const tag = /<img\b[^>]*>/i.exec(block)?.[0] ?? '';
    const persist = /data-src="([^"]*)"/i.exec(tag)?.[1];
    const src = persist ?? /src="([^"]*)"/i.exec(tag)?.[1] ?? '';
    const alt = /alt="([^"]*)"/i.exec(tag)?.[1] ?? '';
    const width = /data-width="(\d+)"/i.exec(tag)?.[1];
    return `![${alt}](${src})${width ? `{w=${width}}` : ''}\n`;
  });
  value = value.replace(/<br\s*\/?>/gi, '\n');
  value = value.replace(/<li[^>]*>/gi, '- ');
  value = value.replace(/<\/(div|p|li|ul)>/gi, '\n');
  value = value.replace(/<(b|strong)\b[^>]*>/gi, '**').replace(/<\/(b|strong)>/gi, '**');
  value = value.replace(/<(i|em)\b[^>]*>/gi, '_').replace(/<\/(i|em)>/gi, '_');
  // Imagem: prefere `data-src` (URL do servidor) ao `src` (previa local/data uri).
  value = value.replace(/<img\b[^>]*>/gi, (tag) => {
    const persist = /data-src="([^"]*)"/i.exec(tag)?.[1];
    const src = persist ?? /src="([^"]*)"/i.exec(tag)?.[1] ?? '';
    const alt = /alt="([^"]*)"/i.exec(tag)?.[1] ?? '';
    const width = /data-width="(\d+)"/i.exec(tag)?.[1];
    return `![${alt}](${src})${width ? `{w=${width}}` : ''}`;
  });
  // Link: <a href="url">texto</a> -> [texto](url).
  value = value.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
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
