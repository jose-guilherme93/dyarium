/**
 * Conversao entre o markdown da nota (formato canonico do app e do dashboard)
 * e o HTML que o editor TenTap/TipTap entende.
 *
 * O markdown continua sendo o que fica salvo. Este modulo isola as diferencas
 * do HTML do TipTap (paragrafos `<p>`, item de lista com `<p>` dentro, imagem
 * como no de bloco) e preserva o que o editor simples ainda nao representa
 * nativamente (codigo, tabela e divisoria viram texto; o conteudo nao se perde).
 */

import { htmlToMarkdown } from './richText';

const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)(?:\{w=(\d+)\})?\s*$/;
const FENCE = /^\s*```/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE = /^\s*\|.*\|\s*$/;
const DIVIDER = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

/** Caracteres que precisam virar entidade dentro de um texto HTML. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Atributo HTML (aspas e `&`). */
function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

/**
 * Marcador temporario para o codigo inline nao ser interpretado pelas regras
 * de negrito/italico (um `*` dentro de `` `x` `` precisa continuar literal).
 */
const SLOT = '\u0000';

function inlineToTentap(value: string, imageSources: Record<string, string>): string {
  const slots: string[] = [];
  const hold = (html: string) => `${SLOT}${slots.push(html) - 1}${SLOT}`;

  let html = escapeHtml(value);
  // Codigo inline primeiro: o conteudo dele nao participa das outras regras.
  html = html.replace(/`([^`\n]+)`/g, (_match, code: string) => hold(`<code>${code}</code>`));

  // Mencao a outra nota: o dashboard salva como link `note:<id>`, que o
  // TipTap aceita quando a extensao de link permite o protocolo.
  html = html.replace(
    /\[([^\]]*)\]\(note:([^)\s]+)\)/g,
    (_match, label: string, id: string) => `<a href="note:${id}">${label || id}</a>`,
  );

  // Imagem inline (o caso comum e uma linha propria; aqui fica o fallback).
  html = html.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)(?:\{w=(\d+)\})?/g,
    (_match, alt: string, url: string, width?: string) => {
      const display = imageSources[url] ?? url;
      const attr = width ? ` width="${width}%"` : '';
      return `<img src="${escapeAttr(display)}" alt="${escapeAttr(alt)}"${attr}>`;
    },
  );

  html = html
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>');

  return html.replace(new RegExp(`${SLOT}(\\d+)${SLOT}`, 'g'), (_match, index: string) => {
    return slots[Number(index)] ?? '';
  });
}
/** Markdown da nota -> HTML aceito pelo editor TenTap. */
export function markdownToTentapHtml(
  markdown: string,
  imageSources: Record<string, string> = {},
): string {
  if (!markdown.trim()) return '<p></p>';

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let quote: string[] = [];
  // Linhas de texto/tabela consecutivas viram um paragrafo com <br>: preserva
  // a quebra de linha do markdown sem transformar cada linha em paragrafo.
  let inline: string[] = [];
  let inlineKind: 'text' | 'table' | null = null;
  let lastWasImage = false;

  const flushList = () => {
    if (!list) return;
    out.push(`</${list}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    out.push(`<blockquote><p>${quote.join('<br>')}</p></blockquote>`);
    quote = [];
  };
  const flushInline = () => {
    if (inline.length === 0) return;
    out.push(`<p>${inline.join('<br>')}</p>`);
    inline = [];
    inlineKind = null;
  };
  const flush = () => {
    flushList();
    flushQuote();
    flushInline();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Bloco de codigo: o editor simples nao tem bloco de codigo nativo. Mantem
    // as cercas e o texto como um paragrafo com quebras de linha.
    if (FENCE.test(line)) {
      flush();
      const code: string[] = [line.trim()];
      i += 1;
      while (i < lines.length) {
        code.push(lines[i]);
        if (FENCE.test(lines[i])) break;
        i += 1;
      }
      out.push(`<p>${code.map(escapeHtml).join('<br>')}</p>`);
      lastWasImage = false;
      continue;
    }

    if (line.trim() === '') {
      flush();
      out.push('<p></p>');
      lastWasImage = false;
      continue;
    }

    const image = IMAGE_LINE.exec(line);
    if (image) {
      flush();
      const display = imageSources[image[2]] ?? image[2];
      const width = image[3] ? ` width="${image[3]}%"` : '';
      out.push(
        `<img src="${escapeAttr(display)}" alt="${escapeAttr(image[1])}"${width}>`,
      );
      lastWasImage = true;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineToTentap(heading[2], imageSources)}</h${level}>`);
      lastWasImage = false;
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushQuote();
      flushInline();
      if (list !== 'ul') {
        flushList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li><p>${inlineToTentap(bullet[1], imageSources)}</p></li>`);
      lastWasImage = false;
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      flushQuote();
      flushInline();
      if (list !== 'ol') {
        flushList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li><p>${inlineToTentap(ordered[1], imageSources)}</p></li>`);
      lastWasImage = false;
      continue;
    }

    const quoted = QUOTE.exec(line);
    if (quoted) {
      flushList();
      flushInline();
      quote.push(inlineToTentap(quoted[1], imageSources));
      lastWasImage = false;
      continue;
    }

    // Tabela e divisoria ainda nao tem no nativo: viram texto, sem perder os
    // caracteres que o dashboard usa para reconstruir o bloco.
    if (TABLE.test(line)) {
      if (list || quote.length > 0) flush();
      if (inlineKind !== 'table') flushInline();
      inlineKind = 'table';
      inline.push(escapeHtml(line.trim()));
      lastWasImage = false;
      continue;
    }

    if (DIVIDER.test(line)) {
      flush();
      out.push(`<p>${escapeHtml(line.trim())}</p>`);
      lastWasImage = false;
      continue;
    }

    if (list || quote.length > 0) flush();
    if (inlineKind !== 'text') flushInline();
    inlineKind = 'text';
    inline.push(inlineToTentap(line, imageSources));
    lastWasImage = false;
  }

  flush();
  // Imagem como ultimo bloco deixa o documento sem onde colocar o cursor.
  if (lastWasImage) out.push('<p></p>');
  return out.join('') || '<p></p>';
}

/**
 * HTML do editor -> markdown. Antes de converter, devolve as imagens locais
 * (`file://`) para a referencia persistida (`local:`/`attachment:`), que e o
 * que o dashboard e o sync conhecem.
 */
export function tentapHtmlToMarkdown(
  html: string,
  imageSources: Record<string, string> = {},
): string {
  const byDisplay = new Map<string, string>();
  for (const [persist, display] of Object.entries(imageSources)) {
    if (persist !== display) byDisplay.set(display, persist);
  }

  let restored = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /src="([^"]*)"/i.exec(tag)?.[1];
    const persist = src ? byDisplay.get(src) : undefined;
    if (!persist || /\bdata-src=/i.test(tag)) return tag;
    return tag.replace(/<img\b/i, `<img data-src="${escapeAttr(persist)}"`);
  });

  // TipTap coloca cada item de lista em um `<p>`; o conversor do app espera o
  // texto direto no `<li>` para gerar uma lista compacta.
  restored = restored.replace(
    /<li\b([^>]*)>\s*<p>([\s\S]*?)<\/p>\s*<\/li>/gi,
    '<li$1>$2</li>',
  );
  // Imagem de bloco precisa de quebra de linha na volta para markdown.
  restored = restored.replace(/<img\b[^>]*>/gi, (tag) => `\n${tag}\n`);

  // `{w=100}` e o mesmo que largura total: o dashboard nao guarda o marcador.
  return htmlToMarkdown(restored).replace(/\{w=100\}/g, '');
}
