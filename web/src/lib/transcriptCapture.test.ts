import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listNotebooks: vi.fn(),
  createNotebook: vi.fn(),
  createEntry: vi.fn(),
  createNote: vi.fn(),
  listEntryTags: vi.fn(),
  setEntryTags: vi.fn(),
  getEntry: vi.fn(),
  listNotes: vi.fn(),
  updateNote: vi.fn(),
  patchEntry: vi.fn(),
}));

vi.mock("../api", () => ({ api: mocks }));

import {
  markCaptured,
  readCaptures,
  saveTranscriptCapture,
} from "./transcriptCapture";

const segment = { start_ms: 1000, end_ms: 2000, text: "comprar leite" };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.listNotebooks.mockResolvedValue({ notebooks: [] });
  mocks.createNotebook.mockResolvedValue({ id: "nb1", name: "Tarefas e ideias" });
  mocks.createEntry.mockResolvedValue({ id: "c1", title: "comprar leite" });
  mocks.createNote.mockResolvedValue({ id: "n1" });
  mocks.listEntryTags.mockResolvedValue({ tags: [] });
  mocks.setEntryTags.mockResolvedValue({ status: "ok" });
  mocks.getEntry.mockResolvedValue({
    id: "c1",
    title: "comprar leite",
    notebook_id: "nb1",
  });
  mocks.listNotes.mockResolvedValue({ notes: [] });
  mocks.updateNote.mockResolvedValue({ status: "ok" });
  mocks.patchEntry.mockResolvedValue({ status: "ok" });
});

describe("transcriptCapture", () => {
  it("guarda a marcação do trecho neste navegador", () => {
    markCaptured("e1", 1000, "task");
    expect(readCaptures("e1")).toEqual({ "1000": "task" });
  });

  it("cria a nota no caderno Tarefas e ideias com a tag do tipo", async () => {
    const result = await saveTranscriptCapture({
      sourceEntryId: "e1",
      sourceTitle: "Nota de origem",
      segment,
      kind: "task",
    });

    expect(result).toEqual({ entryId: "c1", title: "comprar leite" });
    expect(mocks.createNotebook).toHaveBeenCalledWith({ name: "Tarefas e ideias", color: "" });
    expect(mocks.createEntry).toHaveBeenCalledWith("comprar leite", undefined, "nb1");
    expect(mocks.createNote).toHaveBeenCalledWith(
      "c1",
      "comprar leite",
      "“comprar leite”\n\n— Nota de origem, 0:01",
    );
    expect(mocks.setEntryTags).toHaveBeenCalledWith("c1", ["tarefa"]);
  });

  it("acumula a segunda captura na mesma nota da origem", async () => {
    await saveTranscriptCapture({
      sourceEntryId: "e1",
      sourceTitle: "Nota de origem",
      segment,
      kind: "task",
    });
    mocks.listNotes.mockResolvedValue({
      notes: [
        {
          id: "n1",
          content_markdown: "“comprar leite”\n\n— Nota de origem, 0:01",
          body_version: "v1",
        },
      ],
    });
    mocks.listEntryTags.mockResolvedValue({ tags: [{ name: "tarefa" }] });

    await saveTranscriptCapture({
      sourceEntryId: "e1",
      sourceTitle: "Nota de origem",
      segment: { start_ms: 3000, end_ms: 4000, text: "ligar para Ana" },
      kind: "idea",
    });

    expect(mocks.updateNote).toHaveBeenCalledWith(
      "n1",
      expect.stringContaining("“ligar para Ana”"),
      "v1",
    );
    expect(mocks.setEntryTags).toHaveBeenCalledWith("c1", ["tarefa", "ideia"]);
  });
});
