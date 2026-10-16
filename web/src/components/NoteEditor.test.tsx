import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NoteEditor } from "./NoteEditor";
import { api } from "../api";

// The rich editor is replaced by a button that reports a body change, so the
// test exercises the note's save orchestration without rendering BlockNote.
vi.mock("../editor/NotesEditor", () => ({
  NotesEditor: ({ onChange }: { onChange?: (blocks: unknown[]) => void }) => (
    <button type="button" onClick={() => onChange?.([{ type: "paragraph", content: "novo" }])}>
      editar corpo
    </button>
  ),
  mediaRefs: () => [],
}));

vi.mock("./TagEditor", () => ({ TagEditor: () => null }));

vi.mock("../api", () => ({
  api: {
    getEntry: vi.fn(async () => ({
      id: "e1",
      title: "Nota escrita",
      status: "ready",
      source: "text",
      parent_id: "",
      content_type: "",
      original_filename: "",
      duration_seconds: 0,
      recorded_at: null,
      created_at: "2026-10-15T12:00:00Z",
      updated_at: "2026-10-15T12:00:00Z",
    })),
    getAnalysis: vi.fn(async () => {
      throw new Error("sem analise");
    }),
    listNotes: vi.fn(async () => ({ notes: [] })),
    listAttachments: vi.fn(async () => ({ attachments: [] })),
    listRevisions: vi.fn(async () => ({ revisions: [] })),
    createNote: vi.fn(async () => ({ id: "n1" })),
    updateNote: vi.fn(async () => ({ status: "ok" })),
    patchEntry: vi.fn(async () => ({ status: "ok" })),
    retranscribe: vi.fn(async () => ({ status: "ok" })),
    analyze: vi.fn(async () => ({ status: "ok" })),
    deleteEntry: vi.fn(async () => undefined),
  },
}));

const noop = () => {};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NoteEditor autosave", () => {
  it("grava ao sair da nota sem esperar o debounce (nao perde a digitacao)", async () => {
    const { unmount } = render(
      <NoteEditor
        entryId="e1"
        refreshKey={0}
        onChanged={noop}
        onDeleted={noop}
        onOpenEntity={noop}
        onOpenEntry={noop}
        onCreateChild={noop}
      />,
    );
    const edit = await screen.findByRole("button", { name: "editar corpo" });

    vi.useFakeTimers();
    fireEvent.click(edit);
    expect(api.createNote).not.toHaveBeenCalled();

    unmount();
    // Sem avancar o relogio: a gravacao precisa sair do flush de saida, nao do
    // debounce pendente (que seria perdido ao fechar a pagina).
    await vi.advanceTimersByTimeAsync(0);

    expect(api.createNote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.createNote).mock.calls[0][0]).toBe("e1");
  });
});
