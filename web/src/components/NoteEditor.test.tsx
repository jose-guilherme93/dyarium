import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NoteEditor } from "./NoteEditor";
import { api } from "../api";

// The rich editor is replaced by a button that reports a body change in
// markdown (the format the note speaks), so the test exercises the note's save
// orchestration without rendering BlockNote.
vi.mock("../editor/NotesEditor", () => ({
  NotesEditor: ({
    initialContent,
    onChange,
  }: {
    initialContent?: { content?: string }[];
    onChange?: (markdown: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => {
        const current = (initialContent ?? []).map((block) => block.content ?? "").join(" ");
        onChange?.(`${current} editado`.trim());
      }}
    >
      editar corpo
    </button>
  ),
  mediaRefs: () => [],
}));

// Markdown <-> blocks without BlockNote: one block per body, enough to see which
// text the editor was mounted with.
vi.mock("../editor/markdownBlocks", () => ({
  markdownToNoteBlocks: (markdown: string) => [{ type: "paragraph", content: markdown }],
  resetMarkdownCache: () => {},
}));

vi.mock("./TagEditor", () => ({ TagEditor: () => null }));

vi.mock("../api", () => ({
  attachmentUrl: (id: string) => `/api/v1/attachments/${id}`,
  api: {
    getEntry: vi.fn(async () => ({
      id: "e1",
      title: "Nota escrita",
      status: "ready",
      source: "text",
      parent_id: "",
      notebook_id: "notas-ao-acaso",
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
    getEntryCached: vi.fn(async () => undefined),
    getAnalysisCached: vi.fn(async () => undefined),
    listNotesCached: vi.fn(async () => undefined),
    listAttachmentsCached: vi.fn(async () => undefined),
    listNotes: vi.fn(async () => ({ notes: [] })),
    listAttachments: vi.fn(async () => ({ attachments: [] })),
    listRevisions: vi.fn(async () => ({ revisions: [] })),
    createNote: vi.fn(async () => ({ id: "n1" })),
    updateNote: vi.fn(async () => ({ status: "ok" })),
    patchEntry: vi.fn(async () => ({ status: "ok" })),
    retranscribe: vi.fn(async () => ({ status: "ok" })),
    analyze: vi.fn(async () => ({ status: "ok" })),
    deleteEntry: vi.fn(async () => undefined),
    deleteAttachment: vi.fn(async () => undefined),
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
        notebooks={[]}
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

  it("editar no markdown cru e voltar nao descarta a edicao crua", async () => {
    vi.mocked(api.listNotes).mockResolvedValueOnce({
      notes: [
        {
          id: "n1",
          entry_id: "e1",
          title: "",
          content_markdown: "antigo",
          body_version: "v1",
          created_at: "2026-10-15T12:00:00Z",
          updated_at: "2026-10-15T12:00:00Z",
        },
      ],
    });

    render(
      <NoteEditor
        entryId="e1"
        refreshKey={0}
        onChanged={noop}
        onDeleted={noop}
        onOpenEntity={noop}
        onOpenEntry={noop}
        notebooks={[]}
      />,
    );
    await screen.findByRole("button", { name: "editar corpo" });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Ver markdown" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown da nota" }), {
      target: { value: "novo texto" },
    });
    // Voltando ao formatado, o editor remonta: ele precisa receber "novo texto",
    // nao o corpo que a nota tinha quando foi aberta.
    fireEvent.click(screen.getByRole("button", { name: "Ver nota formatada" }));
    fireEvent.click(screen.getByRole("button", { name: "editar corpo" }));
    await vi.advanceTimersByTimeAsync(900);

    expect(vi.mocked(api.updateNote).mock.calls.at(-1)?.[0]).toBe("n1");
    expect(vi.mocked(api.updateNote).mock.calls.at(-1)?.[1]).toBe("novo texto editado");
  });
});

describe("NoteEditor apagar audio", () => {
  it("apaga o anexo no servidor quando o menu do player pede", async () => {
    const base = await vi.mocked(api.getEntry)("e1");
    vi.mocked(api.getEntry).mockResolvedValueOnce({
      ...base,
      duration_seconds: 3,
      audios: [
        {
          id: "a1",
          content_type: "audio/aac",
          size_bytes: 1234,
          duration_seconds: 3,
          created_at: "2026-10-15T12:00:00Z",
          transcript: null,
        },
      ],
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onChanged = vi.fn();

    render(
      <NoteEditor
        entryId="e1"
        refreshKey={0}
        onChanged={onChanged}
        onDeleted={noop}
        onOpenEntity={noop}
        onOpenEntry={noop}
        notebooks={[]}
      />,
    );

    fireEvent.click(await screen.findByLabelText("Opções do áudio"));
    fireEvent.click(screen.getByText("Apagar áudio"));

    await waitFor(() => expect(api.deleteAttachment).toHaveBeenCalledWith("a1"));
    expect(onChanged).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByLabelText("Opções do áudio")).toBeNull());
    confirm.mockRestore();
  });

  it("nao apaga nada quando a confirmacao e cancelada", async () => {
    const base = await vi.mocked(api.getEntry)("e1");
    vi.mocked(api.getEntry).mockResolvedValueOnce({
      ...base,
      audios: [
        {
          id: "a1",
          content_type: "audio/aac",
          size_bytes: 1234,
          duration_seconds: 3,
          created_at: "2026-10-15T12:00:00Z",
          transcript: null,
        },
      ],
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <NoteEditor
        entryId="e1"
        refreshKey={0}
        onChanged={noop}
        onDeleted={noop}
        onOpenEntity={noop}
        onOpenEntry={noop}
        notebooks={[]}
      />,
    );

    fireEvent.click(await screen.findByLabelText("Opções do áudio"));
    fireEvent.click(screen.getByText("Apagar áudio"));

    expect(api.deleteAttachment).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});

describe("Origem da analise", () => {
  it("mostra que a analise veio do aparelho", async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue({
      origin: "app",
      model: "gemma-3-270m",
      sentiment: 0.2,
      sentiment_label: "positivo",
      emotions: null,
      people: null,
      places: null,
      summary: "Um dia bom.",
      comprehension: 80,
      comprehension_source: "review",
    });

    render(
      <NoteEditor
        entryId="e1"
        refreshKey={0}
        onChanged={noop}
        onDeleted={noop}
        onOpenEntity={noop}
        onOpenEntry={noop}
        notebooks={[]}
      />,
    );

    await screen.findByLabelText("Ver markdown");
    const open = screen.queryByLabelText("Abrir propriedades");
    if (open) fireEvent.click(open);
    expect(await screen.findByText("aparelho")).toBeInTheDocument();
  });

  it("marca a analise de provedor de terceiro como API", async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue({
      origin: "api",
      model: "qwen",
      sentiment: 0.1,
      sentiment_label: "neutro",
      emotions: null,
      people: null,
      places: null,
      summary: "Resumo.",
    });

    render(
      <NoteEditor
        entryId="e1"
        refreshKey={0}
        onChanged={noop}
        onDeleted={noop}
        onOpenEntity={noop}
        onOpenEntry={noop}
        notebooks={[]}
      />,
    );

    await screen.findByLabelText("Ver markdown");
    const open = screen.queryByLabelText("Abrir propriedades");
    if (open) fireEvent.click(open);
    expect(await screen.findByText("API")).toBeInTheDocument();
  });
});
