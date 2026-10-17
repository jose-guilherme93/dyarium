/**
 * Rich text simples baseado em markdown. O editor rico (WebView) fala HTML,
 * mas guardamos markdown no banco (compacto e renderizavel no dashboard). Este
 * modulo e puro e concentra as conversoes e a aplicacao de formatacao, para
 * testar de verdade.
 */

import { clampImageWidth } from './image';

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Marcador que segura a mencao a outra nota enquanto as outras regras rodam. */
const MENTION_SLOT = '\u0000';

function inlineToHtml(value: string, imageSources?: Record<string, string>): string {
  // A mencao a outra nota vira um marcador antes das outras regras: o markdown
  // que ela carrega em `data-md` tem os mesmos caracteres das regras de link, e
  // sem o marcador elas reescreveriam o proprio atributo (virando `<a href=`
  // dentro do `data-md`, que quebrava a volta).
  const mentions: { label: string; id: string }[] = [];
  let html = escapeHtml(value).replace(
    /\[([^\]]*)\]\(note:([^)\s]+)\)/g,
    (_match, label: string, id: string) => {
      mentions.push({ label, id });
      return `${MENTION_SLOT}${mentions.length - 1}${MENTION_SLOT}`;
    },
  );

  html = html
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

  // Inline e somente leitura: como link normal, o toque tentaria abrir
  // `note:<id>` no sistema e nao daria em nada.
  const slot = new RegExp(`${MENTION_SLOT}(\\d+)${MENTION_SLOT}`, "g");
  return html.replace(slot, (_match, index: string) => {
    const mention = mentions[Number(index)];
    if (!mention) return '';
    return (
      `<span class="opaque-inline" contenteditable="false" ` +
      `data-md="[${mention.label}](note:${mention.id})">${mention.label || 'nota'}</span>`
    );
  });
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

/**
 * Ajusta a largura de uma imagem no markdown. A largura e percentual da nota;
 * 100 remove o marcador `{w=}` (largura total).
 */
export function setImageWidthInMarkdown(markdown: string, ref: string, percent: number): string {
  const pct = clampImageWidth(percent);
  const suffix = pct >= 100 ? '' : `{w=${pct}}`;
  const re = new RegExp(`(!\\[[^\\]]*\\]\\()${escapeRegExp(ref)}(\\))(?:\\{w=\\d+\\})?`, 'g');
  return markdown.replace(re, (_match, pre: string, post: string) => `${pre}${ref}${post}${suffix}`);
}

/** Remove a imagem (a linha inteira, com o marcador) do markdown. */
export function removeImageFromMarkdown(markdown: string, ref: string): string {
  const re = new RegExp(
    `^!\\[[^\\]]*\\]\\(${escapeRegExp(ref)}\\)(?:\\{w=\\d+\\})?\\n?`,
    'gm',
  );
  return markdown.replace(re, '');
}

// --- Construcoes que o app nao edita -------------------------------------
//
// Tabela, linha divisoria e mencao a outra nota existem no markdown do
// dashboard, mas o editor do celular nao sabe edita-las. Em vez de fingir que
// nao existem (e perder o conteudo ao salvar), elas viram um **bloco opaco**:
// somente leitura, carregando o markdown original em `data-md`, que volta
// intacto na gravacao. O usuario pode apagar (com confirmacao), nunca mover.

/** Tipos de bloco que o app mostra opacos. */
export const OPAQUE_BLOCK_KINDS = ['table', 'divider'] as const;

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|[\s:|-]+\|\s*$/;
const DIVIDER = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const CODE_FENCE = /^```\s*(\S*)\s*$/;

/** Uma construcao que o app nao edita, com o markdown exato que a representa. */
export interface OpaqueBlock {
  kind: (typeof OPAQUE_BLOCK_KINDS)[number];
  /** Markdown original: volta intacto quando a nota e salva. */
  markdown: string;
  /** Texto curto para o bloco mostrar na tela. */
  label: string;
}

/**
 * Encontra, no markdown, as linhas que formam um bloco opaco. Devolve os
 * intervalos (inicio e fim, exclusivo) e o bloco correspondente, na ordem do
 * texto: e o que permite trocar cada trecho pelo HTML somente leitura.
 */
export function findOpaqueBlocks(markdown: string): {
  start: number;
  end: number;
  block: OpaqueBlock;
}[] {
  const lines = markdown.split('\n');
  const out: { start: number; end: number; block: OpaqueBlock }[] = [];
  let offset = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const start = offset;
    offset += line.length + 1; // +1 do \n

    if (DIVIDER.test(line)) {
      out.push({
        start,
        end: offset,
        block: { kind: 'divider', markdown: line.trim(), label: 'divisoria' },
      });
      continue;
    }

    if (TABLE_ROW.test(line)) {
      const rows: string[] = [line];
      let j = i + 1;
      // A tabela vai ate a primeira linha que nao e linha de tabela. O
      // cabecalho (linha de `---`) e as separadoras entram no markdown junto.
      while (j < lines.length && TABLE_ROW.test(lines[j])) {
        rows.push(lines[j]);
        j += 1;
      }
      const text = rows.join('\n');
      const columns = countColumns(rows[0]);
      out.push({
        start,
        end: offset + rows.slice(1).reduce((sum, row) => sum + row.length + 1, 0),
        block: {
          kind: 'table',
          markdown: text,
          label: `tabela ${columns}x${rows.filter((row) => !TABLE_DIVIDER.test(row)).length}`,
        },
      });
      i = j - 1;
      offset = start + text.length + 1;
    }
  }
  return out;
}

function countColumns(row: string): number {
  return row.split('|').filter((cell) => cell.trim() !== '').length;
}

/** HTML do bloco opaco: somente leitura, com o markdown original carregado. */
export function opaqueBlockHtml(block: OpaqueBlock): string {
  const payload = escapeHtml(block.markdown);
  const label = escapeHtml(block.label);
  return (
    `<div class="opaque-block opaque-${block.kind}" contenteditable="false" ` +
    `data-md="${payload}" data-label="${label}">` +
    `<span class="opaque-kind">${label}</span>` +
    `<span class="opaque-preview">${previewOf(block)}</span>` +
    '</div>'
  );
}

/** Previa curta do bloco opaco (o markdown, em uma linha, cortada). */
function previewOf(block: OpaqueBlock): string {
  const flat = block.markdown.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

/** Converte markdown em HTML para o editor, com blocos opacos no lugar certo. */
export function markdownToHtml(markdown: string, imageSources?: Record<string, string>): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const found of findOpaqueBlocks(markdown)) {
    if (found.start > cursor) {
      parts.push(markdownToHtmlFragment(markdown.slice(cursor, found.start), imageSources));
    }
    parts.push(opaqueBlockHtml(found.block));
    cursor = found.end;
  }
  parts.push(markdownToHtmlFragment(markdown.slice(cursor), imageSources));
  const html = parts.join('');
  // Sempre sobra um paragrafo depois de bloco atomico (imagem, bloco opaco,
  // codigo), para digitar abaixo. Antes nao: a nota comecava com uma linha vazia
  // (que aparecia como uma tarja do fundo) quando o primeiro bloco era imagem.
  const atomic = /^<(div class="img-block"|div class="opaque-block"|pre class="code-block")/;
  if (atomic.test(html)) return `${html}<div><br></div>`;
  return html;
}

/** Markdown -> HTML, linha a linha (sem blocks opacos: so texto e imagem). */
function markdownToHtmlFragment(markdown: string, imageSources?: Record<string, string>): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Bloco de codigo: fences de tres crases. Fica somente leitura (o editor
    // nao formata dentro de codigo) e volta identico.
    const fence = CODE_FENCE.exec(line.trim());
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !CODE_FENCE.test(lines[i].trim())) {
        body.push(lines[i]);
        i += 1;
      }
      const lang = fence[1] ? ` data-lang="${escapeHtml(fence[1])}"` : '';
      out.push(
        `<pre class="code-block" contenteditable="false"${lang}><code>${escapeHtml(body.join('\n'))}</code></pre>`,
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inlineToHtml(heading[2], imageSources)}</h${level}>`);
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      out.push(`<blockquote><div>${inlineToHtml(quote[1], imageSources)}</div></blockquote>`);
      continue;
    }

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
  return out.join('');
}

/** Converte o HTML produzido pelo editor de volta para markdown. */
export function htmlToMarkdown(html: string): string {
  let value = html;

  // Bloco opaco: volta o markdown original, byte a byte. E o que garante que
  // tabela e divisoria continuem iguais depois de salvar no celular.
  value = value.replace(
    /<div class="opaque-block[\s\S]*?<\/div>/gi,
    (block) => {
      const markdown = /data-md="([^"]*)"/i.exec(block)?.[1] ?? '';
      return `\n${unescapeHtml(markdown)}\n`;
    },
  );

  // Mencao a outra nota, no meio da frase: mesma ideia, inline.
  value = value.replace(
    /<span class="opaque-inline"[^>]*data-md="([^"]*)"[^>]*>[\s\S]*?<\/span>/gi,
    (_all, markdown: string) => unescapeHtml(markdown),
  );

  // Bloco de codigo: fences, com o texto intacto (inclusive a indentacao).
  value = value.replace(
    /<pre[^>]*class="code-block"[^>]*>\s*<code>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (block, code: string) => {
      const lang = /data-lang="([^"]*)"/i.exec(block)?.[1] ?? '';
      return `\n\`\`\`${lang}\n${unescapeHtml(code)}\n\`\`\`\n`;
    },
  );

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
  // Citacao: o prefixo vai no conteudo interno, que ainda pode ter <b>/<a>.
  value = value.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_all, inner: string) => {
    return `\n> ${inner.trim()}\n`;
  });
  value = value.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_all, level: string, inner: string) => {
    return `\n${'#'.repeat(Number(level))} ${inner}\n`;
  });
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
  return value.replace(/^\n+/, '').replace(/\n+$/, '');
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
      .replace(/\*\*/g, '')
      .replace(/[`_]/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/^-\s+/gm, '')
  );
}

/** Numero de palavras do texto puro. */
export function countWords(markdown: string): number {
  const plain = markdownToPlain(markdown).trim();
  return plain ? plain.split(/\s+/).length : 0;
}

/** Numero de caracteres do texto puro (com espacos), como no dashboard. */
export function countChars(markdown: string): number {
  return markdownToPlain(markdown).length;
}

/**
 * Quebra o texto em linhas a cada fim de frase (`.`, `!`, `?`, `…`), para a
 * transcricao ficar como legenda. So quebra quando ha espaco depois do sinal,
 * entao numeros como "3.5" e URLs nao sao afetados.
 */
export function breakSentences(text: string): string {
  return text.replace(/([.!?…]+)\s+/g, '$1\n').trim();
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
