import { describe, expect, it } from "vitest";
import { groupLineRects, paginate } from "./pagination";

function lines(count: number, start = 100, height = 20, gap = 8) {
  return Array.from({ length: count }, (_, index) => ({
    top: start + index * (height + gap),
    bottom: start + index * (height + gap) + height,
  }));
}

describe("quebra de pagina do editor", () => {
  it("junta os pedacos de uma linha e separa as linhas", () => {
    expect(
      groupLineRects([
        { top: 10, bottom: 30 },
        { top: 12, bottom: 28 },
        { top: 38, bottom: 58 },
        { top: 60, bottom: 80 },
      ]),
    ).toEqual([
      { top: 10, bottom: 30 },
      { top: 38, bottom: 58 },
      { top: 60, bottom: 80 },
    ]);
  });

  it("quebra na linha que nao cabe inteira, como a impressao", () => {
    // Pagina util de 100px: a linha que termina em 204 nao cabe na primeira
    // pagina (limite 200) e comeca a segunda.
    const breaks = paginate(lines(12), 100);
    expect(breaks.map((mark) => mark.page)).toEqual([2, 3, 4]);
    expect(breaks.map((mark) => mark.top)).toEqual([184, 268, 352]);
    expect(breaks.map((mark) => mark.pageStart)).toEqual([100, 184, 268]);
  });

  it("nao cria pagina quando o texto cabe", () => {
    expect(paginate(lines(3), 720)).toEqual([]);
  });

  it("ignora altura invalida", () => {
    expect(paginate(lines(3), 0)).toEqual([]);
  });
});
