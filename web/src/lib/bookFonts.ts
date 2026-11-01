/** Fontes de corpo disponiveis no modo escritor. Todas ficam em
 *  public/fonts e sao carregadas localmente; o PDF usa o mesmo arquivo. */
export type BookFontId =
  | "newsreader"
  | "eb-garamond"
  | "libre-baskerville"
  | "libre-caslon-text"
  | "tinos"
  | "gelasio"
  | "literata"
  | "crimson-pro";

export interface BookFontFace {
  file: string;
  style: "normal" | "italic";
  weight: string;
}

export interface BookFont {
  id: BookFontId;
  /** Nome curto mostrado no seletor. */
  label: string;
  /** Nome usado no DOCX (pode existir na maquina do leitor). */
  google: string;
  era: string;
  css: string;
  faces: BookFontFace[];
}

export const BOOK_FONT_ORDER: BookFontId[] = [
  "newsreader",
  "eb-garamond",
  "libre-baskerville",
  "libre-caslon-text",
  "tinos",
  "gelasio",
  "literata",
  "crimson-pro",
];

export const BOOK_FONTS: Record<BookFontId, BookFont> = {
  "newsreader": { id: "newsreader", label: "Newsreader", google: "Newsreader", era: "jornal, contemporâneo", css: '"Newsreader", "Iowan Old Style", Georgia, serif', faces: [{ file: "newsreader-italic-400-700.woff2", style: "italic", weight: "400 700" }, { file: "newsreader-roman-400-700.woff2", style: "normal", weight: "400 700" }] },
  "eb-garamond": { id: "eb-garamond", label: "Garamond", google: "EB Garamond", era: "renascença", css: '"EB Garamond", "Iowan Old Style", Garamond, Georgia, serif', faces: [{ file: "eb-garamond-italic-400-800.woff2", style: "italic", weight: "400 800" }, { file: "eb-garamond-roman-400-800.woff2", style: "normal", weight: "400 800" }] },
  "libre-baskerville": { id: "libre-baskerville", label: "Baskerville", google: "Libre Baskerville", era: "transição", css: '"Libre Baskerville", Baskerville, Georgia, serif', faces: [{ file: "libre-baskerville-italic-400.woff2", style: "italic", weight: "400" }, { file: "libre-baskerville-roman-400.woff2", style: "normal", weight: "400" }, { file: "libre-baskerville-roman-700.woff2", style: "normal", weight: "700" }] },
  "libre-caslon-text": { id: "libre-caslon-text", label: "Caslon", google: "Libre Caslon Text", era: "clássico inglês", css: '"Libre Caslon Text", "Adobe Caslon Pro", Caslon, Georgia, serif', faces: [{ file: "libre-caslon-text-italic-400.woff2", style: "italic", weight: "400" }, { file: "libre-caslon-text-roman-400.woff2", style: "normal", weight: "400" }, { file: "libre-caslon-text-roman-700.woff2", style: "normal", weight: "700" }] },
  "tinos": { id: "tinos", label: "Times", google: "Tinos", era: "clássico, manuscrito", css: '"Tinos", "Times New Roman", Times, serif', faces: [{ file: "tinos-italic-400.woff2", style: "italic", weight: "400" }, { file: "tinos-roman-400.woff2", style: "normal", weight: "400" }, { file: "tinos-roman-700.woff2", style: "normal", weight: "700" }] },
  "gelasio": { id: "gelasio", label: "Georgia", google: "Gelasio", era: "tela, moderno", css: '"Gelasio", Georgia, "Times New Roman", serif', faces: [{ file: "gelasio-italic-400-700.woff2", style: "italic", weight: "400 700" }, { file: "gelasio-roman-400-700.woff2", style: "normal", weight: "400 700" }] },
  "literata": { id: "literata", label: "Literata", google: "Literata", era: "leitura digital", css: '"Literata", Georgia, "Times New Roman", serif', faces: [{ file: "literata-italic-400-700.woff2", style: "italic", weight: "400 700" }, { file: "literata-roman-400-700.woff2", style: "normal", weight: "400 700" }] },
  "crimson-pro": { id: "crimson-pro", label: "Crimson", google: "Crimson Pro", era: "contemporâneo", css: '"Crimson Pro", Georgia, "Times New Roman", serif', faces: [{ file: "crimson-pro-italic-400-700.woff2", style: "italic", weight: "400 700" }, { file: "crimson-pro-roman-400-700.woff2", style: "normal", weight: "400 700" }] },
};

export const DEFAULT_BOOK_FONT: BookFontId = "newsreader";

/** A fonte do livro, com a Newsreader como reserva segura. */
export function bookFont(id: string | undefined): BookFont {
  return BOOK_FONTS[(id ?? "") as BookFontId] ?? BOOK_FONTS[DEFAULT_BOOK_FONT];
}

/** @font-face da fonte escolhida, para o HTML da impressao. */
export function bookFontFaces(font: BookFont): string {
  return font.faces
    .map(
      (face) =>
        `@font-face { font-family: "${font.google}"; src: url("/fonts/${face.file}") format("woff2"); font-style: ${face.style}; font-weight: ${face.weight}; font-display: swap; }`,
    )
    .join("\n");
}
