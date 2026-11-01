import { strToU8, zipSync } from "fflate";
import { attachmentUrl } from "../../api";
import type { BookExportInput, ImageMode } from "./types";

/** Imagem ja decodificada, pronta para entrar no pacote. */
export interface DocxImage {
  src: string;
  data: Uint8Array;
  extension: "png" | "jpeg";
  widthInches: number;
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function run(text: string, bold = false, italic = false, strike = false): string {
  const props = [
    bold ? "<w:b/>" : "",
    italic ? "<w:i/>" : "",
    strike ? "<w:strike/>" : "",
  ].join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

/** Markdown inline -> runs OOXML (negrito, italico, tachado e codigo). */
function inlineRuns(value: string): string {
  const parts: string[] = [];
  const pattern = /(\*\*[^*]+\*\*|~~[^~]+~~|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(run(value.slice(last, index)));
    const token = match[0];
    if (token.startsWith("**")) parts.push(run(token.slice(2, -2), true));
    else if (token.startsWith("~~")) parts.push(run(token.slice(2, -2), false, false, true));
    else if (token.startsWith("`")) parts.push(run(token.slice(1, -1)));
    else parts.push(run(token.slice(1, -1), false, true));
    last = index + token.length;
  }
  if (last < value.length) parts.push(run(value.slice(last)));
  return parts.join("");
}

function paragraph(text: string, style = "Body", indent = true): string {
  const ppr = [
    style ? `<w:pStyle w:val="${style}"/>` : "",
    indent ? `<w:ind w:firstLine="720"/>` : "",
    `<w:jc w:val="both"/>`,
  ].join("");
  return `<w:p><w:pPr>${ppr}</w:pPr>${inlineRuns(text)}</w:p>`;
}

function heading(text: string, level: 1 | 2): string {
  return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>${run(text, false)}</w:p>`;
}

function pageBreak(): string {
  return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
}

function imageParagraph(image: DocxImage, relId: string, mode: ImageMode, color: boolean): string {
  const id = relId;
  const cx = Math.round(image.widthInches * 914400);
  const cy = Math.round(image.widthInches * 0.75 * 914400);
  const grayscale = mode === "bw" && !color;
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
  <wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Imagem"/>
  <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Imagem"/><pic:cNvPicPr/></pic:nvPicPr>
  <pic:blipFill><a:blip r:embed="rIdImage${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
  <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>
  </pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>${
    grayscale ? "" : ""
  }</w:p>`;
}

interface ImageScan {
  text: string;
  images: Array<{ alt: string; src: string; width: number; color: boolean }>;
}

function scanMarkdown(markdown: string): ImageScan {
  const images: ImageScan["images"] = [];
  const text = markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)(?:\{w=(\d{1,3})(?:,c=([01]))?\}|\{c=([01])\})?/g,
    (_match, alt: string, src: string, width?: string, color?: string, colorOnly?: string) => {
      images.push({
        alt,
        src,
        width: width ? Number(width) : 100,
        color: (color ?? colorOnly ?? "") === "1",
      });
      return `\n{{image:${images.length - 1}}}\n`;
    },
  );
  return { text, images };
}

/** Corpo do documento com paragrafos, titulos, quebras e imagens. */
function documentXml(
  input: BookExportInput,
  images: DocxImage[],
): string {
  const { book, options } = input;
  const chapters = input.chapters.filter(
    (chapter) => chapter.entry.chapter_kind === "part" || chapter.words > 0,
  );
  const manuscript = options.preset === "manuscript";
  const body: string[] = [];
  if (options.includeTitlePage) {
    body.push(`<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run(book.name)}</w:p>`);
    if (book.subtitle.trim()) {
      body.push(`<w:p><w:pPr><w:pStyle w:val="Subtitle"/></w:pPr>${run(book.subtitle)}</w:p>`);
    }
    if (book.author.trim()) body.push(paragraph(book.author, "Subtitle", false));
    body.push(pageBreak());
  }
  if (options.includeToc) {
    body.push(heading("Sumário", 1));
    for (const chapter of chapters) {
      body.push(paragraph(chapter.entry.title || "Sem título", "Body", false));
    }
    body.push(pageBreak());
  }
  for (const chapter of chapters) {
    const isPart = chapter.entry.chapter_kind === "part";
    if (!isPart && options.pageBreak) body.push(pageBreak());
    body.push(heading(chapter.entry.title || "Sem título", isPart ? 1 : 2));
    if (chapter.entry.chapter_synopsis?.trim()) {
      body.push(paragraph(chapter.entry.chapter_synopsis.trim(), "Quote", false));
    }
    const scanned = scanMarkdown(chapter.markdown);
    const lines = scanned.text.split("\n");
    let paragraphLines: string[] = [];
    let listKind: "ul" | "ol" | null = null;
    const imageByMarker = new Map<number, DocxImage>();
    for (let i = 0; i < scanned.images.length; i += 1) {
      const found = images.find((image) => image.src === scanned.images[i].src);
      if (found) imageByMarker.set(i, found);
    }
    const flush = () => {
      if (paragraphLines.length === 0) return;
      body.push(paragraph(paragraphLines.join(" ")));
      paragraphLines = [];
    };
    for (const line of lines) {
      const trimmed = line.trim();
      const marker = /^\{\{image:(\d+)\}\}$/.exec(trimmed);
      if (marker) {
        flush();
        const found = imageByMarker.get(Number(marker[1]));
        if (found) {
          const info = scanned.images[Number(marker[1])];
          const widthInches = manuscript ? 5.5 : 4.2;
          body.push(
            imageParagraph(
              { ...found, widthInches: Math.min(widthInches, 6.5 * (info.width / 100)) },
              String(images.indexOf(found) + 1),
              options.images,
              info.color,
            ),
          );
        }
        continue;
      }
      if (!trimmed) {
        flush();
        listKind = null;
        continue;
      }
      const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
      if (h) {
        flush();
        body.push(heading(h[2], h[1].length <= 2 ? 2 : 2));
        continue;
      }
      const bullet = /^\s*[-*+]\s+(.*)$/.exec(trimmed);
      const numbered = /^\s*\d+\.\s+(.*)$/.exec(trimmed);
      if (bullet || numbered) {
        flush();
        listKind = numbered ? "ol" : "ul";
        body.push(paragraph(`• ${(bullet ?? numbered)?.[1] ?? ""}`, "Body", false));
        continue;
      }
      if (listKind) {
        body.push(paragraph(trimmed, "Body", false));
        continue;
      }
      if (/^>\s?/.test(trimmed)) {
        flush();
        body.push(paragraph(trimmed.replace(/^>\s?/, ""), "Quote", false));
        continue;
      }
      paragraphLines.push(trimmed);
    }
    flush();
  }
  const page = manuscript
    ? `<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>`
    : `<w:pgSz w:w="8640" w:h="12960"/><w:pgMar w:top="1077" w:right="1077" w:bottom="1077" w:left="1077" w:header="708" w:footer="708" w:gutter="0"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<w:body>${body.join("")}<w:sectPr>${page}</w:sectPr></w:body></w:document>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Body"><w:name w:val="Body"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:rPr><w:i/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`;

/** Monta o .docx (zip OOXML) sem tocar na rede. */
export function buildDocx(input: BookExportInput, images: DocxImage[] = []): Uint8Array {
  const media: Record<string, Uint8Array> = {};
  const imageRels: string[] = [];
  images.forEach((image, index) => {
    const name = `image${index + 1}.${image.extension}`;
    media[`word/media/${name}`] = image.data;
    imageRels.push(
      `<Relationship Id="rIdImage${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`,
    );
  });
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${imageRels.join("")}
</Relationships>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(input.book.name)}</dc:title><dc:creator>${xml(input.book.author)}</dc:creator>
<dc:language>${xml(input.book.language || "pt-BR")}</dc:language>
</cp:coreProperties>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "word/document.xml": strToU8(documentXml(input, images)),
    "word/styles.xml": strToU8(STYLES),
    "word/_rels/document.xml.rels": strToU8(documentRels),
    "docProps/core.xml": strToU8(core),
    ...Object.fromEntries(Object.entries(media)),
  };
  return zipSync(files, { level: 6 });
}

async function imageBytes(src: string, color: boolean): Promise<DocxImage | null> {
  const url = attachmentUrl(src.replace(/^attachment:/, ""));
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!color) {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < data.data.length; i += 4) {
          const gray = data.data[i] * 0.299 + data.data[i + 1] * 0.587 + data.data[i + 2] * 0.114;
          data.data[i] = gray;
          data.data[i + 1] = gray;
          data.data[i + 2] = gray;
        }
        context.putImageData(data, 0, 0);
      }
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!png) return null;
      return { src, data: new Uint8Array(await png.arrayBuffer()), extension: "png", widthInches: 4.2 };
    }
    const extension = blob.type === "image/png" ? "png" : "jpeg";
    return { src, data: new Uint8Array(await blob.arrayBuffer()), extension, widthInches: 4.2 };
  } catch {
    return null;
  }
}

/** Exporta o livro com imagens; respeita o teto de 25 MB e avisa as ignoradas. */
export async function exportDocx(
  input: BookExportInput,
): Promise<{ data: Uint8Array; ignoredImages: number }> {
  const sources = new Set<string>();
  const colorSources = new Set<string>();
  for (const chapter of input.chapters) {
    for (const match of chapter.markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)(?:\{([^}]*)\})?/g)) {
      if (!match[1].startsWith("attachment:")) continue;
      sources.add(match[1]);
      if (/\bc=1\b/.test(match[2] ?? "")) colorSources.add(match[1]);
    }
  }
  const images: DocxImage[] = [];
  let bytes = 0;
  let ignored = 0;
  for (const src of sources) {
    if (bytes > 25 * 1024 * 1024) {
      ignored += 1;
      continue;
    }
    const color = input.options.images === "color" || colorSources.has(src);
    const image = await imageBytes(src, color);
    if (!image) {
      ignored += 1;
      continue;
    }
    bytes += image.data.byteLength;
    if (bytes > 25 * 1024 * 1024) {
      ignored += 1;
      continue;
    }
    images.push(image);
  }
  return { data: buildDocx(input, images), ignoredImages: ignored };
}
