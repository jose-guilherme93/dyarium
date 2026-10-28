/**
 * Importacao de um export HTML do Notion.
 *
 * Le o zip/pasta no navegador, monta a nota em markdown e usa os endpoints que
 * ja existem: entrada (`POST /entries` com id deterministico), anexos
 * (`POST /entries/{id}/attachments`), tags (`PUT /entries/{id}/tags`) e nota
 * (`POST /entries/{id}/notes`).
 *
 * O id da entrada e o id da pagina do Notion. Reimportar o mesmo export nao
 * duplica nada e os links entre paginas continuam apontando para a nota certa.
 */

import { api, uploadAttachment } from "../api";
import type { Attachment, Entry, Note, Notebook } from "../types";
import { parseNotionPage, type NotionBlock, type NotionPage } from "./notionHtml";
import { exportYear, toRecordedAt } from "./notionDates";
import { unzipSync } from "fflate";

export class NotionImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotionImportError";
  }
}

export interface NotionSourceFile {
  path: string;
  file: File;
}

export interface NotionSource {
  files: Map<string, NotionSourceFile>;
  html: NotionSourceFile[];
  fallbackYear: number;
  rootName: string;
  warnings: string[];
}

export interface NotionDateOption {
  name: string;
  type: string;
  raw: string;
  sampleDate: string | null;
}

export interface NotionInspectionPage {
  fileName: string;
  notionId: string;
  title: string;
  recordedAt: string | null;
  dateProperty: string | null;
  imageCount: number;
  commentCount: number;
  skippedProperties: string[];
  isDatabaseIndex: boolean;
  warnings: string[];
  /** So a primeira pagina importavel guarda os blocos, para a previa. */
  preview?: NotionBlock[];
}

export interface NotionInspection {
  pages: NotionInspectionPage[];
  importable: NotionInspectionPage[];
  dateOptions: NotionDateOption[];
  counts: {
    pages: number;
    importable: number;
    images: number;
    comments: number;
    withoutDate: number;
    databaseIndexes: number;
    datesWithoutYear: number;
  };
  skippedProperties: string[];
  warnings: string[];
}

export interface NotionImportProgress {
  stage: "notebook" | "page";
  done: number;
  total: number;
  title?: string;
}

export interface NotionImportOptions {
  dateProperty?: string;
  fallbackYear: number;
  /** Acrescenta comentarios novos a notas ja existentes. Padrao: sim. */
  updateExistingComments?: boolean;
  notebook:
    | { kind: "existing"; id: string; name?: string }
    | { kind: "notion" };
  onProgress?: (progress: NotionImportProgress) => void;
  isCancelled?: () => boolean;
  client?: NotionApi;
}

export interface NotionImportFailure {
  title: string;
  message: string;
}

export interface NotionImportResult {
  imported: number;
  existing: number;
  failed: number;
  moved: number;
  images: number;
  tags: number;
  comments: number;
  updated: number;
  withoutDate: number;
  total: number;
  cancelled: boolean;
  notebookId: string;
  notebookName: string;
  notebookCreated: boolean;
  notebookRemoved: boolean;
  firstEntryId?: string;
  failures: NotionImportFailure[];
  warnings: string[];
}

/** O subconjunto da API que o import usa; os testes passam um duble. */
export interface NotionApi {
  listNotebooks: () => Promise<{ notebooks: Notebook[] }>;
  createNotebook: (input: { name: string; color: string }) => Promise<Notebook>;
  deleteNotebook: (id: string) => Promise<void>;
  createImportEntry: (input: {
    id: string;
    title: string;
    notebookId?: string;
    recordedAt?: string;
  }) => Promise<{ entry: Entry; created: boolean }>;
  listNotes: (entryId: string) => Promise<{ notes: Note[] }>;
  uploadAttachment: (entryId: string, file: File) => Promise<Attachment>;
  deleteAttachment: (id: string) => Promise<void>;
  createNote: (entryId: string, title: string, markdown: string) => Promise<Note>;
  setEntryTags: (entryId: string, tags: string[]) => Promise<{ status: string }>;
  patchEntry: (id: string, patch: { notebook_id?: string }) => Promise<{ status: string }>;
  updateNote: (
    noteId: string,
    markdown: string,
    baseVersion?: string,
  ) => Promise<{ status: string; versions: { body?: string } }>;
}

const defaultClient: NotionApi = { ...api, uploadAttachment };

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

function dirName(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

function mimeForName(name: string): string {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  return IMAGE_TYPES[extension] ?? "application/octet-stream";
}

function sourceFromEntries(entries: Map<string, File>, fallbackYear: number, warnings: string[]): NotionSource {
  const files = new Map<string, NotionSourceFile>();
  for (const [path, file] of entries) {
    files.set(path, { path, file });
  }
  const html = [...files.values()]
    .filter((entry) => /\.html?$/i.test(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (html.length === 0) {
    throw new NotionImportError("Nenhuma página HTML encontrada. Escolha o export HTML do Notion.");
  }
  const first = html[0]!.path.split("/")[0] ?? "";
  const rootName = first && !first.toLowerCase().endsWith(".html") ? first : "";
  return { files, html, fallbackYear, rootName, warnings };
}

/** Le um .zip do Notion, inclusive o zip que as vezes vem dentro do zip. */
export async function readNotionZip(file: File): Promise<NotionSource> {
  const warnings: string[] = [];
  const entries = new Map<string, File>();
  const addZip = (bytes: Uint8Array, prefix: string, depth: number) => {
    let unzipped: Record<string, Uint8Array>;
    try {
      unzipped = unzipSync(bytes);
    } catch {
      throw new NotionImportError("Não foi possível ler o zip. Baixe o export HTML do Notion de novo.");
    }
    for (const [rawPath, data] of Object.entries(unzipped)) {
      if (!rawPath || rawPath.endsWith("/")) continue;
      if (rawPath.includes("__MACOSX/") || baseName(rawPath) === ".DS_Store") continue;
      const path = normalizePath(prefix ? `${prefix}/${rawPath}` : rawPath);
      if (!path) continue;
      if (/\.zip$/i.test(path)) {
        if (depth >= 3) {
          warnings.push("zip aninhado ignorado");
          continue;
        }
        const innerPrefix = dirName(path);
        addZip(data, innerPrefix, depth + 1);
        continue;
      }
      const name = baseName(path);
      const type = mimeForName(name);
      entries.set(path, new File([new Uint8Array(data).buffer], name, { type }));
    }
  };
  const bytes = new Uint8Array(await file.arrayBuffer());
  addZip(bytes, "", 0);
  return sourceFromEntries(entries, exportYear(new Date(file.lastModified)), warnings);
}

/** Le a pasta descompactada selecionada no navegador. */
export function readNotionFolder(files: FileList | File[]): NotionSource {
  const entries = new Map<string, File>();
  for (const file of Array.from(files)) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const path = normalizePath(relative);
    if (!path) continue;
    entries.set(path, file);
  }
  return sourceFromEntries(entries, exportYear(new Date()), []);
}

/** Le a entrada escolhida na tela: zip ou pasta. */
export async function readNotionSource(input: { zip?: File; files?: FileList | File[] }): Promise<NotionSource> {
  if (input.zip) return readNotionZip(input.zip);
  if (input.files) return readNotionFolder(input.files);
  throw new NotionImportError("Escolha um zip ou uma pasta do Notion.");
}

function countImages(page: NotionPage): number {
  return page.blocks.filter((block) => block.kind === "image").length;
}

/** Primeira leitura: conta paginas, imagens, datas e propriedades. */
export async function inspectNotionSource(
  source: NotionSource,
  options: { fallbackYear?: number; dateProperty?: string } = {},
): Promise<NotionInspection> {
  const fallbackYear = options.fallbackYear ?? source.fallbackYear;
  const pages: NotionInspectionPage[] = [];
  const dateOptions = new Map<string, NotionDateOption>();
  const warnings = new Set<string>(source.warnings);
  const skipped = new Set<string>();
  let preview: NotionInspectionPage | undefined;
  let datesWithoutYear = 0;

  for (const entry of source.html) {
    let html: string;
    try {
      html = await entry.file.text();
    } catch {
      warnings.add(`não foi possível ler ${entry.path}`);
      continue;
    }
    let page: NotionPage;
    try {
      page = parseNotionPage(html, {
        fileName: entry.path,
        fallbackYear,
        dateProperty: options.dateProperty,
      });
    } catch {
      warnings.add(`não foi possível ler ${entry.path}`);
      continue;
    }
    if (!page.notionId) {
      warnings.add(`HTML ignorado (sem id de página): ${baseName(entry.path)}`);
      continue;
    }
    for (const warning of page.warnings) warnings.add(warning);
    for (const property of page.properties) {
      if (property.use === "skipped" && property.rawValue) skipped.add(property.name);
    }
    for (const candidate of page.dateCandidates) {
      if (!dateOptions.has(candidate.name)) {
        dateOptions.set(candidate.name, {
          name: candidate.name,
          type: candidate.type,
          raw: candidate.raw,
          sampleDate: candidate.date ? candidate.date.toISOString() : null,
        });
      }
      if (candidate.date && !candidate.hadYear) datesWithoutYear += 1;
    }
    const info: NotionInspectionPage = {
      fileName: entry.path,
      notionId: page.notionId,
      title: page.title,
      recordedAt: page.recordedAt ? page.recordedAt.toISOString() : null,
      dateProperty: page.dateProperty,
      imageCount: countImages(page),
      commentCount: page.blocks.filter((block) => block.kind === "comment").length,
      skippedProperties: page.properties
        .filter((property) => property.use === "skipped" && property.rawValue)
        .map((property) => property.name),
      isDatabaseIndex: page.isDatabaseIndex,
      warnings: page.warnings,
    };
    if (!page.isDatabaseIndex && !preview) {
      info.preview = page.blocks;
      preview = info;
    }
    pages.push(info);
  }

  const importable = pages.filter((page) => !page.isDatabaseIndex);
  return {
    pages,
    importable,
    dateOptions: [...dateOptions.values()],
    counts: {
      pages: pages.length,
      importable: importable.length,
      images: importable.reduce((sum, page) => sum + page.imageCount, 0),
      comments: importable.reduce((sum, page) => sum + page.commentCount, 0),
      withoutDate: importable.filter((page) => !page.recordedAt).length,
      databaseIndexes: pages.length - importable.length,
      datesWithoutYear,
    },
    skippedProperties: [...skipped].sort((a, b) => a.localeCompare(b)),
    warnings: [...warnings],
  };
}

interface ResolvedImage {
  key: string;
  file: File;
}

function findSourceFile(source: NotionSource, target: string): NotionSourceFile | null {
  const exact = source.files.get(target);
  if (exact) return exact;
  const lower = target.toLowerCase();
  for (const [path, file] of source.files) {
    if (path.toLowerCase() === lower) return file;
  }
  const wanted = baseName(target).toLowerCase();
  const matches = [...source.files.values()].filter((file) => baseName(file.path).toLowerCase() === wanted);
  return matches.length === 1 ? matches[0]! : null;
}

function decodeSourcePath(src: string): string {
  let value = src;
  try {
    value = decodeURIComponent(src);
  } catch {
    // Nome com percentual quebrado: tenta o texto original.
  }
  return value.split("#")[0]!.split("?")[0]!.trim();
}

/**
 * Resolve o `src` de uma imagem para um arquivo da pasta/zip. Imagem externa
 * nao e baixada: o import nao faz requisicao para fora do servidor.
 */
function resolveImage(source: NotionSource, htmlPath: string, src: string): { image?: ResolvedImage; warning?: string } {
  const trimmed = src.trim();
  if (!trimmed) return { warning: "imagem sem endereço" };
  if (/^(https?:)?\/\//i.test(trimmed)) {
    return { warning: `imagem externa ignorada: ${trimmed}` };
  }
  if (/^(data:|blob:)/i.test(trimmed)) {
    return { warning: "imagem embutida no HTML ignorada" };
  }
  const value = decodeSourcePath(trimmed);
  if (!value) return { warning: "imagem sem endereço" };
  const base = dirName(htmlPath);
  const target = normalizePath(value.startsWith("/") ? value.slice(1) : `${base}/${value}`);
  let found = findSourceFile(source, target);
  if (!found) {
    // Alguns exports guardam o nome ainda url-encoded no disco.
    const raw = trimQuery(trimmed);
    found = findSourceFile(source, normalizePath(raw.startsWith("/") ? raw.slice(1) : `${base}/${raw}`));
  }
  if (!found) return { warning: `imagem não encontrada: ${baseName(value)}` };
  const name = baseName(found.path);
  const extension = name.toLowerCase().split(".").pop() ?? "";
  const type = found.file.type.startsWith("image/") ? found.file.type : IMAGE_TYPES[extension];
  if (!type) return { warning: `arquivo não é imagem: ${name}` };
  const file =
    found.file.type === type
      ? found.file
      : new File([found.file], name, { type, lastModified: found.file.lastModified });
  return { image: { key: target || found.path, file } };
}

function trimQuery(value: string): string {
  return value.split("#")[0]!.split("?")[0]!.trim();
}

/** Markdown final: texto e imagens na ordem em que o Notion os colocou. */
export function renderNotionMarkdown(page: NotionPage, imageIds: Map<string, string>): string {
  const parts: string[] = [];
  for (const block of page.blocks) {
    if (block.kind === "image") {
      const id = imageIds.get(block.src);
      if (!id) continue;
      const caption = block.caption.replace(/\]/g, "\\]");
      parts.push(`![${caption}](attachment:${id})`);
      continue;
    }
    const text = block.text.trim();
    if (text) parts.push(text);
  }
  return parts.join("\n\n").trim();
}

async function resolveNotebook(
  client: NotionApi,
  choice: NotionImportOptions["notebook"],
): Promise<{ notebook: Notebook; created: boolean }> {
  const result = await client.listNotebooks();
  const notebooks = result.notebooks ?? [];
  if (choice.kind === "existing") {
    const found = notebooks.find((notebook) => notebook.id === choice.id);
    if (!found) {
      throw new NotionImportError("O caderno escolhido não existe mais. Escolha outro.");
    }
    return { notebook: found, created: false };
  }
  const existing = notebooks.find((notebook) => normalizeName(notebook.name) === "notion");
  if (existing) return { notebook: existing, created: false };
  const created = await client.createNotebook({ name: "Notion", color: "" });
  return { notebook: created, created: true };
}

function normalizeComment(value: string): string {
  return value
    .replace(/^>\s?/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A primeira versao do import gravava o titulo "Comentarios da pagina" e o
 * divisor da secao, mas perdia o comentario. Ao acrescentar as citacoes agora,
 * remove esse resto do fim do corpo para nao deixar lixo.
 */
function cleanLegacyCommentsSection(value: string): string {
  return value
    .replace(
      /\n+(?:\*\*)?(?:coment[\u00e1a]rios?(?:\s+(?:da|de|do)\s+(?:p[\u00e1a]gina|bloco))?|comments?(?:\s+(?:on\s+the\s+)?(?:page|block))?)(?:\*\*)?\s*\n+\s*---\s*$/i,
      "",
    )
    .trimEnd();
}

/**
 * Acrescenta a uma nota existente apenas os comentarios que ainda nao estao
 * nela. O corpo atual nunca e reescrito: so ganha as citacoes que faltam, no
 * comeco. Se a nota mudou nesse meio tempo, o 409 aborta em vez de sobrescrever.
 */
async function appendMissingComments(
  client: NotionApi,
  note: Note,
  comments: string[],
  title: string,
  warnings: Set<string>,
): Promise<number> {
  const candidates = comments.map((comment) => comment.trim()).filter(Boolean);
  if (candidates.length === 0) return 0;
  const current = cleanLegacyCommentsSection(note.content_markdown ?? "");
  const currentKey = normalizeComment(current);
  const missing = candidates.filter((comment) => {
    const content = comment.split(/\n\s*\n/).slice(1).join("\n\n");
    const keys = [comment, content].map(normalizeComment).filter(Boolean);
    return keys.length === 0 || !keys.some((key) => currentKey.includes(key));
  });
  if (missing.length === 0) return 0;
  const body = [...missing, current.trim()].filter(Boolean).join("\n\n");
  try {
    await client.updateNote(note.id, body, note.body_version);
    return missing.length;
  } catch {
    warnings.add(`comentarios nao adicionados em "${title}"`);
    return 0;
  }
}

/** Importa as paginas da revisao. Nunca sobrescreve uma nota que ja existia. */
export async function importNotionSource(
  source: NotionSource,
  inspection: NotionInspection,
  options: NotionImportOptions,
): Promise<NotionImportResult> {
  const client = options.client ?? defaultClient;
  const pages = inspection.importable;
  if (pages.length === 0) {
    throw new NotionImportError("Nenhuma página para importar.");
  }
  const total = pages.length;
  const knownPageIds = new Set(pages.map((page) => page.notionId));
  const fallbackYear = options.fallbackYear;
  const warnings = new Set(inspection.warnings);
  const failures: NotionImportFailure[] = [];
  let imported = 0;
  let existing = 0;
  let failed = 0;
  let moved = 0;
  let images = 0;
  let tags = 0;
  let commentCount = 0;
  let updated = 0;
  let withoutDate = 0;
  let cancelled = false;
  let firstEntryId: string | undefined;
  let touched = false;
  let notebookRemoved = false;

  options.onProgress?.({ stage: "notebook", done: 0, total });
  const { notebook, created: notebookCreated } = await resolveNotebook(client, options.notebook);
  const notebookId = notebook.id;

  for (let index = 0; index < pages.length; index += 1) {
    if (options.isCancelled?.()) {
      cancelled = true;
      break;
    }
    const inspected = pages[index]!;
    const entryFile = source.files.get(inspected.fileName);
    if (!entryFile) {
      failed += 1;
      failures.push({ title: inspected.title, message: "arquivo da página não encontrado" });
      continue;
    }
    let page: NotionPage;
    try {
      const html = await entryFile.file.text();
      page = parseNotionPage(html, {
        fileName: entryFile.path,
        fallbackYear,
        dateProperty: options.dateProperty,
        knownPageIds,
        entryIdForPage: (id) => id,
      });
    } catch {
      failed += 1;
      failures.push({ title: inspected.title, message: "não foi possível ler a página" });
      continue;
    }
    if (!page.notionId) {
      failed += 1;
      failures.push({ title: inspected.title, message: "página sem id do Notion" });
      continue;
    }
    for (const warning of page.warnings) warnings.add(warning);
    if (!page.recordedAt) withoutDate += 1;

    const resolved = new Map<string, ResolvedImage>();
    const keyBySrc = new Map<string, string>();
    for (const block of page.blocks) {
      if (block.kind !== "image") continue;
      const image = resolveImage(source, entryFile.path, block.src);
      if (image.warning) {
        warnings.add(image.warning);
        continue;
      }
      if (image.image) {
        resolved.set(image.image.key, image.image);
        keyBySrc.set(block.src, image.image.key);
      }
    }

    try {
      const created = await client.createImportEntry({
        id: page.notionId,
        title: page.title,
        notebookId,
        recordedAt: toRecordedAt(page.recordedAt),
      });
      touched = true;
      const entry = created.entry;
      if (entry.notebook_id && entry.notebook_id !== notebookId) {
        try {
          await client.patchEntry(entry.id, { notebook_id: notebookId });
          moved += 1;
        } catch {
          warnings.add(`não foi possível mover "${page.title}" para o caderno`);
        }
      }
      if (!created.created) {
        const notes = await client.listNotes(entry.id);
        const existingNote = (notes.notes ?? [])[0];
        if (existingNote) {
          if (options.updateExistingComments !== false) {
            const comments = page.blocks
              .filter((block) => block.kind === "comment")
              .map((block) => block.text);
            const added = await appendMissingComments(
              client,
              existingNote,
              comments,
              page.title,
              warnings,
            );
            if (added > 0) {
              commentCount += added;
              updated += 1;
            }
          }
          existing += 1;
          firstEntryId ??= entry.id;
          options.onProgress?.({ stage: "page", done: index + 1, total, title: page.title });
          continue;
        }
      }

      const imageIds = new Map<string, string>();
      const uploaded = new Map<string, string>();
      const uploadedIds: string[] = [];
      for (const [key, image] of resolved) {
        try {
          const attachment = await client.uploadAttachment(entry.id, image.file);
          uploaded.set(key, attachment.id);
          uploadedIds.push(attachment.id);
          images += 1;
        } catch {
          warnings.add(`imagem não importada: ${image.file.name}`);
        }
      }
      for (const [src, key] of keyBySrc) {
        const id = uploaded.get(key);
        if (id) imageIds.set(src, id);
      }

      if (page.tags.length > 0) {
        try {
          await client.setEntryTags(entry.id, page.tags);
          tags += 1;
        } catch {
          warnings.add(`tags não importadas em "${page.title}"`);
        }
      }

      try {
        const markdown = renderNotionMarkdown(page, imageIds);
        await client.createNote(entry.id, "", markdown);
        imported += 1;
        commentCount += page.blocks.filter((block) => block.kind === "comment").length;
        firstEntryId ??= entry.id;
      } catch {
        // A entrada ficou sem nota (import interrompido). Os anexos enviados
        // agora seriam orfaos; apaga para o proximo import nao acumular lixo.
        for (const id of uploadedIds) {
          try {
            await client.deleteAttachment(id);
          } catch {
            // melhor deixar o anexo do que falhar a importacao inteira
          }
        }
        failed += 1;
        failures.push({ title: page.title, message: "não foi possível gravar a nota" });
      }
    } catch {
      failed += 1;
      failures.push({ title: page.title, message: "não foi possível importar" });
    }
    options.onProgress?.({ stage: "page", done: index + 1, total, title: page.title });
  }

  if (notebookCreated && !touched) {
    try {
      await client.deleteNotebook(notebookId);
      notebookRemoved = true;
    } catch {
      warnings.add("o caderno vazio não pôde ser removido");
    }
  }

  return {
    imported,
    existing,
    failed,
    moved,
    images,
    tags,
    comments: commentCount,
    updated,
    withoutDate,
    total,
    cancelled,
    notebookId,
    notebookName: notebook.name,
    notebookCreated,
    notebookRemoved,
    firstEntryId,
    failures,
    warnings: [...warnings],
  };
}
