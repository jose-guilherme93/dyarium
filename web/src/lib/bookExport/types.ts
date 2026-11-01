import type { Entry, Notebook } from "../../types";

export type ExportPreset = "manuscript" | "book";
export type ExportFormat = "docx" | "pdf" | "markdown";
export type ImageMode = "bw" | "color";

export interface ExportChapter {
  entry: Entry;
  markdown: string;
  words: number;
}

export interface ExportOptions {
  preset: ExportPreset;
  format: ExportFormat;
  images: ImageMode;
  includeTitlePage: boolean;
  includeToc: boolean;
  pageBreak: boolean;
  onlyDone: boolean;
}

export interface BookExportInput {
  book: Notebook;
  chapters: ExportChapter[];
  options: ExportOptions;
  /** Capa recortada, ja em data URL, para a previa e a impressao. */
  coverDataUrl?: string;
}

export interface ExportSummary {
  chapters: number;
  words: number;
  pages: number;
  empty: number;
  ignoredImages: number;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  preset: "book",
  format: "docx",
  images: "bw",
  includeTitlePage: true,
  includeToc: true,
  pageBreak: true,
  onlyDone: false,
};
