/**
 * Markdown <-> HTML do editor rico da nota.
 *
 * O markdown continua sendo o formato canonico (servidor, dashboard, backup).
 * O editor nativo, porem, fala HTML: ele desenha negrito, italico, listas,
 * titulos e imagens no meio do texto. Este modulo faz a ponte, sem nada nativo.
 *
 * As imagens sao o ponto delicado: o editor recebe a URI que consegue exibir
 * (`file://` local ou URL do anexo) e devolve a mesma URI no HTML. Quem chama
 * passa um mapa de volta para a referencia salva (`local:...`, `attachment:...`
 * ou URL do servidor), de modo que o markdown nunca guarde caminho de aparelho.
 */

/** Imagem referenciada no markdown, com a largura em percentual da nota. */
export interface NoteImage {
  /** Referencia canonica salva no markdown. */
  ref: string;
  alt: string;
  /** Percentual da largura da nota (100 = largura total). */
  width: number;
}

export interface MarkdownToHtmlOptions {
  /** URI exibivel para uma referencia salva. Default: a propria referencia. */
  imageSrc?: (ref: string) => string;
  /** Proporcao largura/altura da imagem. Default: 4/3. */
  imageRatio?: (src: string) => number;
  /** Largura do editor em px, usada para transformar `{w=N}` em pixels. */
  width?: number;
}

export interface HtmlToMarkdownOptions {
  /** Referencia salva para a URI que veio do editor. */
  imageRef?: (src: string) => string | undefined;
  /** Texto alternativo para a URI que veio do editor. */
  imageAlt?: (src: string) => string | undefined;
  /** Largura do editor em px, usada para transformar pixels em `{w=N}`. */
  width?: number;
}

const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)(?:\{w=(\d+)\})?/g;

/** Imagens do markdown, na ordem em que aparecem. */
export function noteImages(markdown: string): NoteImage[] {
  const out: NoteImage[] = [];
  for (const match of markdown.matchAll(IMAGE)) {
    const width = match[3] ? Number(match[3]) : 100;
    out.push({
      ref: match[2],
      alt: match[1],
      width: Number.isFinite(width) ? Math.min(100, Math.max(1, width)) : 100,
    });
  }
  return out;
}

/** Converte o markdown da nota no HTML inicial do editor rico. */
export function markdownToHtml(markdown: string, options: MarkdownToHtmlOptions = {}): string {
  const text = markdown.replace(/\r\n/g, '\n');
  if (!text.trim()) return '';

  const stash: string[] = [];
  const hold = (html: string): string => `\u0000${stash.push(html) - 1}\u0000`;
  const inline = (value: string): string => inlineToHtml(value, options, hold);
  const lines = text.split('\n');
  const out: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      out.push(`<codeblock><p>${code.map(escapeHtml).join('<br>')}</p></codeblock>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(inline(lines[index].replace(/^>\s?/, '')));
        index += 1;
      }
      index -= 1;
      out.push(`<blockquote>${quote.map((item) => `<p>${item}</p>`).join('')}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(inline(lines[index].replace(/^\s*[-*+]\s+/, '')));
        index += 1;
      }
      index -= 1;
      out.push(`<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(inline(lines[index].replace(/^\s*\d+\.\s+/, '')));
        index += 1;
      }
      index -= 1;
      out.push(`<ol>${items.map((item) => `<li>${item}</li>`).join('')}</ol>`);
      continue;
    }

    // A linha em branco e um <br> solto: e o formato que o editor
    // devolve. Um paragrafo vazio (<p><br></p>) seria lido como duas
    // quebras e a linha em branco do markdown cresceria a cada leitura.
    out.push(trimmed === '' ? '<br>' : `<p>${inline(line)}</p>`);
  }

  // Os blocos vao com uma quebra entre eles: e o formato interno do editor
  // (o nativo devolve o HTML assim). A volta para o markdown tira essa
  // quebra: ela e formatacao do HTML, nao texto do usuario.
  const body = out.join('\n').replace(/\u0000(\d+)\u0000/g, (_all, at: string) => stash[Number(at)] ?? '');

  // O editor rico trabalha com o formato interno dele: `<html>...</html>`.
  // Nesse formato a biblioteca nao roda o normalizador (um parse de HTML5
  // completo) nem no editor, nem a cada medicao das previas. O markdown volta
  // para o editor no mesmo formato (`htmlToMarkdown` tira a casca).
  return `<html>\n${body}\n</html>`;
}

/** Converte o HTML do editor rico de volta para markdown. */
export function htmlToMarkdown(html: string, options: HtmlToMarkdownOptions = {}): string {
  const stash: string[] = [];
  const hold = (markdown: string): string => `\u0001${stash.push(markdown) - 1}\u0001`;

  let value = html
    .replace(/<codeblock[^>]*>([\s\S]*?)<\/codeblock>/gi, (_all, inner: string) =>
      hold(fencedCode(inner)),
    )
    .replace(
      /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
      (_all, inner: string) => hold(fencedCode(inner)),
    )
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_all, inner: string) => hold(fencedCode(inner)))
    // O editor nativo devolve o HTML no formato interno da biblioteca: uma
    // quebra de linha depois de cada tag. Essa quebra e formatacao do HTML, nao
    // texto: sem tira-la, cada linha em branco do markdown voltaria dobrada (e o
    // texto da nota cresceria a cada gravacao).
    .replace(/>\s*\n\s*</g, '><')
    .replace(/<\/?(?:html|body)[^>]*>/gi, '');

  // Codigo inline sai antes do escape: o conteudo e literal e nao pode ganhar
  // barras invertidas (o usuario veria `a\*b` em vez de `a*b`).
  value = value.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_all, inner: string) =>
    hold(`\`${plain(inner)}\``),
  );

  // O texto do editor nao tem marcadores: se o usuario digita `*`, `#` ou `-`
  // no comeco da linha, isso precisa virar texto literal no markdown, nao
  // formatacao que reaparece na proxima abertura. Os marcadores gerados pelos
  // tags (abaixo) ficam de fora porque sao criados depois deste passo.
  value = escapeTextNodes(value);

  value = value.replace(/<img\b([^>]*)>/gi, (_all, attrs: string) => {
    const rawSrc = attr(attrs, 'src') ?? '';
    const src = unescapeHtml(rawSrc);
    const persisted = attr(attrs, 'data-ref');
    const ref = persisted ? unescapeHtml(persisted) : (options.imageRef?.(src) ?? src);
    const alt = options.imageAlt?.(src) ?? unescapeHtml(attr(attrs, 'alt') ?? '');
    const explicit = Number(attr(attrs, 'data-width') ?? 0);
    const pixels = Number(attr(attrs, 'width') ?? 0);
    const percent = explicit > 0
      ? Math.min(100, Math.max(1, Math.round(explicit)))
      : options.width && pixels > 0
        ? Math.min(100, Math.max(1, Math.round((pixels / options.width) * 100)))
        : 0;
    return hold(`![${alt}](${ref})${percent > 0 && percent < 100 ? `{w=${percent}}` : ''}`);
  });

  value = value
    .replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, (_all, _tag: string, inner: string) => `**${inner}**`)
    .replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, (_all, _tag: string, inner: string) => `_${inner}_`)
    .replace(/<(s|strike|del)[^>]*>([\s\S]*?)<\/\1>/gi, (_all, _tag: string, inner: string) => `~~${inner}~~`)
    .replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, (_all, inner: string) => inner)
    .replace(
      /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_all, href: string, label: string) =>
        hold(`[${plain(label)}](${unescapeHtml(href)})`),
    );

  value = value.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_all, level: string, inner: string) => {
    return `${'#'.repeat(Number(level))} ${plain(inner).trim()}\n`;
  });

  value = value.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_all, inner: string) => {
    const quote = blocksToLines(inner)
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => `> ${line}`)
      .join('\n');
    // A citacao fecha a linha; a linha em branco depois dela vem do
    // paragrafo vazio que o editor devolve.
    return `${quote}\n`;
  });

  value = value.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_all, tag: string, inner: string) => {
    const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => match[1]);
    const ordered = tag.toLowerCase() === 'ol';
    const lines = items.map((item, index) => {
      const text = plain(item).replace(/\s*\n\s*/g, ' ').trim();
      return `${ordered ? `${index + 1}. ` : '- '}${text}`;
    });
    // A lista fecha a linha; a linha em branco depois dela vem do paragrafo
    // vazio que o editor devolve.
    return `${lines.join('\n')}\n`;
  });

  value = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div)>/gi, '\n')
    .replace(/<(?:p|div)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '');

  value = unescapeHtml(value).replace(/[\u200B\uFFFC]/g, '');
  value = value.replace(/\u0001(\d+)\u0001/g, (_all, at: string) => stash[Number(at)] ?? '');
  // Cada paragrafo vazio (marcado acima) tem uma quebra a mais que a linha em
  // branco do markdown: a quebra que vem depois do marcador some, e a outra
  // vira a linha em branco. Cinco linhas em branco continuam sendo cinco.
  // A ultima quebra e a da tag que fecha o texto (o editor sempre fecha o
  // bloco com uma quebra). Sai **uma** quebra, e nao todas: as que sobram
  // sao as que o usuario digitou (as linhas em branco no fim do texto).
  value = value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n$/, '');
  return value;
}

/** Markdown de uma linha: texto e imagens no lugar, links, enfase e codigo. */
function inlineToHtml(
  value: string,
  options: MarkdownToHtmlOptions,
  hold: (html: string) => string,
): string {
  let html = escapeHtml(value);

  // Escapes do markdown (`\*`, `\#`, `\-`...) viram o caractere literal antes
  // das regras de formatacao, e ficam guardados para nao serem reinterpretados.
  html = html.replace(/\\([\\`*_{}\[\]()#+\-.!|~>])/g, (_all, char: string) => hold(escapeHtml(char)));

  html = html.replace(/`([^`]+)`/g, (_all, code: string) => hold(`<code>${code}</code>`));

  html = html.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)(?:\{w=(\d+)\})?/g,
    (_all, alt: string, ref: string, widthText?: string) => {
      const percent = widthText ? Number(widthText) : 100;
      const clamped = Number.isFinite(percent) ? Math.min(100, Math.max(1, percent)) : 100;
      const src = options.imageSrc?.(ref) ?? ref;
      const available = options.width && options.width > 0 ? options.width : 320;
      const pixels = Math.max(1, Math.round((available * clamped) / 100));
      const ratio = options.imageRatio?.(src) ?? 4 / 3;
      const height = Math.max(1, Math.round(pixels / (ratio > 0 ? ratio : 4 / 3)));
      return hold(
        `<img src="${escapeHtml(src)}" data-ref="${escapeHtml(ref)}" data-width="${clamped}" alt="${escapeHtml(alt)}" width="${pixels}" height="${height}">`,
      );
    },
  );

  html = html.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_all, label: string, url: string) => hold(`<a href="${escapeHtml(url)}">${label}</a>`),
  );

  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, '$1<i>$2</i>')
    .replace(/(^|[^\w])\*([^*]+)\*(?=[^\w]|$)/g, '$1<i>$2</i>');

  return html;
}

/** Conteudo de um bloco de codigo, sem tags, como texto puro. */
function fencedCode(inner: string): string {
  const code = plain(inner).replace(/\n+$/, '');
  return `\`\`\`\n${code}\n\`\`\`\n`;
}

/** Texto de um trecho de HTML, preservando as quebras de linha. */
function plain(inner: string): string {
  return unescapeHtml(
    inner
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

/** Quebra o HTML interno de um bloco em linhas de texto. */
function blocksToLines(inner: string): string[] {
  return plain(inner).split('\n');
}

/** Marca de texto entre tags que precisa sobreviver como texto, nao como markdown. */
function escapeTextNodes(html: string): string {
  return html.replace(/>([^<]+)</g, (_all, text: string) => `>${escapeMarkdownText(text)}<`);
}

/** Escapa o que, no markdown, viraria formatacao sem o usuario ter pedido. */
export function escapeMarkdownText(text: string): string {
  let out = text.replace(/\\/g, '\\\\').replace(/([*_`~[\]|])/g, '\\$1');
  out = out.replace(/(^|\n)([ \t]*)([#>\-+])(?=\s|$)/g, (_all, lead: string, spaces: string, marker: string) => {
    return `${lead}${spaces}\\${marker}`;
  });
  out = out.replace(/(^|\n)([ \t]*)(\d+)\.(?=\s)/g, '$1$2$3\\.');
  return out;
}

/** Atributo de uma tag HTML simples (o editor sempre usa aspas duplas). */
function attr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
  return match?.[1];
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function unescapeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(/&#(\d+);/g, (_all, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
