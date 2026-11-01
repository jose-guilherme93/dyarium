/** Uma linha renderizada do texto, em coordenadas de tela. */
export interface LineBox {
  top: number;
  bottom: number;
}

/** Uma quebra de pagina: o numero da pagina que comeca e a linha onde comeca. */
export interface PageBreak {
  page: number;
  /** Altura da primeira linha da pagina, em coordenadas de tela. */
  top: number;
  /** Altura da primeira linha da pagina anterior, para a margem inferior. */
  pageStart: number;
}

/**
 * Junta os retangulos de texto em linhas. Um link ou uma palavra em italico
 * gera varios retangulos na mesma linha; eles se sobrepoem na vertical e viram
 * uma linha so. Linhas distintas se tocam, mas nao se sobrepoem.
 */
export function groupLineRects(rects: LineBox[]): LineBox[] {
  const lines: LineBox[] = [];
  for (const rect of rects) {
    const last = lines[lines.length - 1];
    if (last && rect.top < last.bottom - 1 && rect.bottom > last.top + 1) {
      last.top = Math.min(last.top, rect.top);
      last.bottom = Math.max(last.bottom, rect.bottom);
    } else {
      lines.push({ top: rect.top, bottom: rect.bottom });
    }
  }
  return lines;
}

/**
 * Onde cada pagina comeca, com a mesma conta da impressao: uma linha que nao
 * cabe inteira na altura util desce para a pagina seguinte, e a pagina seguinte
 * recomeca a contar a partir dela. A quebra e a altura da linha, nao o limite
 * teorico da pagina.
 */
export function paginate(lines: LineBox[], textHeight: number): PageBreak[] {
  if (lines.length === 0 || textHeight <= 0) return [];
  const breaks: PageBreak[] = [];
  let page = 1;
  let pageTop = lines[0].top;
  let pageBottom = pageTop + textHeight;
  for (const line of lines) {
    if (line.bottom <= pageBottom + 0.5) continue;
    page += 1;
    breaks.push({ page, top: line.top, pageStart: pageTop });
    pageTop = line.top;
    pageBottom = line.top + textHeight;
  }
  return breaks;
}
