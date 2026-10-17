/**
 * Converte o corpo das notas que ainda estao em JSON do BlockNote para markdown
 * (formato canonico do app e do dashboard). Roda uma vez, no ambiente de dev.
 *
 * O conversor e o proprio do BlockNote (`tryParseMarkdownToBlocks` /
 * `blocksToMarkdownLossy`), o mesmo que o dashboard usa: nao ha duas implementacoes
 * discordando do que e markdown.
 *
 * Uso (no diretorio web/):
 *   BASE_URL=http://127.0.0.1:8080 TOKEN=... npx tsx scripts/convert-notes-to-markdown.ts [--dry-run]
 *
 * Sem `--dry-run` grava. O corpo antigo vira revisao da nota (o servidor guarda a
 * revision de toda escrita), entao da para voltar.
 */

import { JSDOM } from "jsdom";

import { BlockNoteEditor } from "@blocknote/core";
import { blocksToNoteMarkdown } from "../src/editor/blocknoteMarkdown.ts";
import { createNoteSchema } from "../src/editor/schema.ts";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const TOKEN = process.env.TOKEN ?? "";
const DRY_RUN = process.argv.includes("--dry-run");

interface StoredNote {
  id: string;
  entry_id: string;
  document?: unknown;
  content_markdown?: string;
  body_version?: string;
}

interface Entry {
  id: string;
  title: string;
}

interface Summary {
  entries: number;
  notes: number;
  converted: number;
  skipped: number;
  failed: number;
  /** Blocos que o markdown nao representa (ficam como texto do bloco). */
  lossyBlocks: Record<string, number>;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** O BlockNote precisa de DOM para criar o editor. */
function installDom(): void {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const globals = globalThis as unknown as Record<string, unknown>;
  const define = (name: string, value: unknown): void => {
    // Node 22 expoe `navigator` como getter: define por descritor.
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  define("window", dom.window);
  define("document", dom.window.document);
  define("navigator", dom.window.navigator);
  define("HTMLElement", dom.window.HTMLElement);
  define("Node", dom.window.Node);
  define("DOMParser", dom.window.DOMParser);
  define("Range", dom.window.Range);
  define("getSelection", dom.window.getSelection?.bind(dom.window));
  globals.window = dom.window;
}

function countBlocks(blocks: unknown, counts: Map<string, number>): void {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const type = (block as { type?: string }).type ?? "desconhecido";
    counts.set(type, (counts.get(type) ?? 0) + 1);
    countBlocks((block as { children?: unknown }).children, counts);
  }
}

/** Tipos que o markdown do BlockNote nao representa como estrutura. */
const LOSSY_TYPES = new Set(["audio", "file", "video", "table"]);

async function main(): Promise<void> {
  if (!TOKEN) {
    fail("Falta TOKEN (o token da API do servidor).");
  }
  installDom();
  const editor = BlockNoteEditor.create({ schema: createNoteSchema() });

  const entries = (await api<{ entries: Entry[] }>("/entries?limit=5000")).entries ?? [];
  const summary: Summary = {
    entries: entries.length,
    notes: 0,
    converted: 0,
    skipped: 0,
    failed: 0,
    lossyBlocks: {},
  };

  for (const entry of entries) {
    let notes: StoredNote[];
    try {
      notes = (await api<{ notes: StoredNote[] }>(`/entries/${entry.id}/notes`)).notes ?? [];
    } catch {
      continue;
    }
    for (const note of notes) {
      summary.notes += 1;
      if (!note.document) {
        summary.skipped += 1; // ja em markdown
        continue;
      }
      let markdown: string;
      try {
        const blocks = Array.isArray(note.document) ? note.document : [];
        const types = new Map<string, number>();
        countBlocks(blocks, types);
        for (const [type, count] of types) {
          if (LOSSY_TYPES.has(type)) {
            summary.lossyBlocks[type] = (summary.lossyBlocks[type] ?? 0) + count;
          }
        }
        const normalized = blocks.map((block) => {
          const value = block as { type?: string };
          // Bloco de audio da nota vira audio da propria entrada (a pilha fica no
          // topo), nao texto solto no corpo.
          if (value.type === "audio") return { type: "paragraph", content: [] };
          return block;
        });
        markdown = blocksToNoteMarkdown(editor, normalized);
      } catch (error) {
        summary.failed += 1;
        process.stderr.write(`  ${entry.id}/${note.id}: ${(error as Error).message}\n`);
        continue;
      }
      if (DRY_RUN) {
        summary.converted += 1;
        process.stdout.write(`[dry-run] ${entry.title} -> ${JSON.stringify(markdown.slice(0, 90))}\n`);
        continue;
      }
      try {
        await api(`/notes/${note.id}`, {
          method: "PUT",
          body: JSON.stringify({ content_markdown: markdown }),
        });
        summary.converted += 1;
        process.stdout.write(`ok ${entry.title}\n`);
      } catch (error) {
        summary.failed += 1;
        process.stderr.write(`  ${entry.id}/${note.id}: ${(error as Error).message}\n`);
      }
    }
  }

  process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
  if (DRY_RUN) {
    process.stdout.write("\n(dry-run: nada foi gravado)\n");
  }
}

await main();