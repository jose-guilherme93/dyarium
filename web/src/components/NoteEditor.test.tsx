import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NoteEditor } from "./NoteEditor";
import { api } from "../api";

// O worker do navegador fica desligado por padrao; um teste liga o "preparando"
// para ver o botao Analisar bloqueado durante o download dos modelos.
const workerState = vi.hoisted(() => ({
  current: null as null | { phase: string },
}));

vi.mock("../lib/browserWorker", () => ({
  getWorkerState: () => workerState.current,
  subscribeWorker: (listener: (state: unknown) => void) => {
    listener(workerState.current);
    return () => undefined;
  },
  beginWorkerEntry: async () => false,
  cancelWorkerEntry: async () => undefined,
  replaceWorkerEntry: () => undefined,
  handOffWorker: async () => undefined,
  startWorker: async () => undefined,
  stopWorker: async () => undefined,
}));

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
  }) => {
    const content = (initialContent ?? []).map((block) => block.content ?? "").join(" ");
    return (
      <div>
        <span data-testid="editor-body">{content}</span>
        <button type="button" onClick={() => onChange?.(`${content} editado`.trim())}>
          editar corpo
        </button>
      </div>
    );
  },
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
    getSettings: vi.fn(async () => ({ owner_name: "", all_notes_mine: true })),
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
let confirmSpy: ReturnType<typeof vi.spyOn>;

function entry(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    entry_id: "e1",
    title: "",
    content_markdown: "antigo",
    body_version: "v1",
    created_at: "2026-10-15T12:00:00Z",
    updated_at: "2026-10-15T12:00:00Z",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Um unico spy para o arquivo inteiro: criar/restaurar por teste deixava a
  // resposta do teste anterior valendo quando um caso terminava no meio.
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
  workerState.current = null;
  confirmSpy?.mockRestore();
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
    confirmSpy.mockReturnValue(true);
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
    confirmSpy.mockReturnValue(false);

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

  it("nao apaga a analise quando um refresh falha", async () => {
    vi.mocked(api.getAnalysis)
      .mockResolvedValueOnce({
        origin: "app",
        model: "gemma-3-270m",
        sentiment: 0.2,
        sentiment_label: "positivo",
        emotions: null,
        people: null,
        places: null,
        summary: "Um dia bom.",
      })
      .mockRejectedValueOnce(new Error("rede"));

    const props = {
      entryId: "e1",
      onChanged: noop,
      onDeleted: noop,
      onOpenEntity: noop,
      onOpenEntry: noop,
      notebooks: [],
    };
    const { rerender } = render(<NoteEditor {...props} refreshKey={0} />);
    await screen.findByLabelText("Ver markdown");
    const open = screen.queryByLabelText("Abrir propriedades");
    if (open) fireEvent.click(open);
    expect(await screen.findByText("aparelho")).toBeInTheDocument();

    rerender(<NoteEditor {...props} refreshKey={1} />);
    await waitFor(() => expect(api.getAnalysis).toHaveBeenCalledTimes(2));
    expect(screen.getByText("aparelho")).toBeInTheDocument();
  });

  it("bloqueia Analisar enquanto os modelos do PC estao carregando", async () => {
    workerState.current = { phase: "preparing" };
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
    expect(await screen.findByRole("button", { name: /Analisar/ })).toBeDisabled();
  });

  it("mostra o aparelho que processou a analise no navegador", async () => {
    vi.mocked(api.getAnalysis).mockResolvedValue({
      origin: "browser",
      model: "lfm2.5-230m-q5",
      device_name: "Edge 156 · Windows · Intel HD Graphics 620",
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
    expect(
      await screen.findByText("Edge 156 · Windows · Intel HD Graphics 620 · LFM2.5 230M"),
    ).toBeInTheDocument();
  });

  it("libera o botao Analisar depois de enfileirar a nota", async () => {
    vi.mocked(api.getAnalysis).mockRejectedValue(new Error("sem analise"));
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
    const analyze = await screen.findByRole("button", { name: /Analisar/ });
    fireEvent.click(analyze);

    await waitFor(() => expect(api.analyze).toHaveBeenCalledWith("e1"));
    // O trabalho continua no servidor (ou neste PC); o botao precisa voltar ao
    // normal em vez de girar para sempre.
    await waitFor(() => expect(screen.getByRole("button", { name: /Analisar/ })).not.toBeDisabled());
    expect(screen.queryByText(/Analisando/)).not.toBeInTheDocument();
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

function renderEditor() {
  return render(
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
}

describe("NoteEditor integridade do corpo", () => {
  it("remonta com o corpo da rede quando o cache estava velho", async () => {
    const cachedEntry = entry();
    const freshEntry = deferred<ReturnType<typeof entry>>();
    const freshNotes = deferred<{ notes: ReturnType<typeof note>[] }>();
    vi.mocked(api.getEntryCached).mockResolvedValueOnce(cachedEntry as never);
    vi.mocked(api.listNotesCached).mockResolvedValueOnce({ notes: [note()] } as never);
    vi.mocked(api.getEntry).mockReturnValueOnce(freshEntry.promise as never);
    vi.mocked(api.listNotes).mockReturnValueOnce(freshNotes.promise as never);

    renderEditor();
    const before = await screen.findByTestId("editor-body");
    expect(before).toHaveTextContent("antigo");

    freshEntry.resolve(cachedEntry);
    freshNotes.resolve({ notes: [note({ content_markdown: "novo", body_version: "v2" })] });

    await waitFor(() => expect(screen.getByTestId("editor-body")).toHaveTextContent("novo"));
    // Um texto novo por cima do editor montado nao basta: o BlockNote so le o
    // initialContent na criacao, entao o editor precisa ter remontado.
    expect(screen.getByTestId("editor-body")).not.toBe(before);
  });

  it("nao cria nota duplicada quando o corpo nao carrega", async () => {
    vi.mocked(api.listNotes).mockRejectedValueOnce(new Error("falha"));

    renderEditor();

    expect(
      await screen.findByText("Não foi possível carregar o corpo da nota."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "editar corpo" })).toBeNull();
    expect(api.createNote).not.toHaveBeenCalled();
  });

  it("mantem a nota em cache quando a rede falha, sem criar duplicata", async () => {
    const cachedEntry = entry();
    vi.mocked(api.getEntryCached).mockResolvedValueOnce(cachedEntry as never);
    vi.mocked(api.listNotesCached).mockResolvedValueOnce({ notes: [note()] } as never);
    vi.mocked(api.listNotes).mockRejectedValueOnce(new Error("falha"));

    const { unmount } = renderEditor();
    expect(await screen.findByTestId("editor-body")).toHaveTextContent("antigo");

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "editar corpo" }));
    unmount();
    await vi.advanceTimersByTimeAsync(0);

    expect(api.updateNote).toHaveBeenCalled();
    expect(api.createNote).not.toHaveBeenCalled();
  });

  it("nao renomeia com o nome do arquivo ao abrir e fechar", async () => {
    vi.mocked(api.getEntry).mockResolvedValueOnce(
      entry({ title: "", original_filename: "gravacao.m4a" }) as never,
    );

    const { unmount } = renderEditor();
    await screen.findByTestId("editor-body");
    expect(screen.getByLabelText("Título da nota")).toHaveValue("");

    unmount();
    expect(api.patchEntry).not.toHaveBeenCalled();
  });

  it("reenvia a criacao da nota com o mesmo id depois de uma falha", async () => {
    vi.mocked(api.listNotes).mockResolvedValueOnce({ notes: [] } as never);
    vi.mocked(api.createNote).mockRejectedValueOnce(new Error("rede"));

    renderEditor();
    const edit = await screen.findByRole("button", { name: "editar corpo" });

    vi.useFakeTimers();
    fireEvent.click(edit);
    await vi.advanceTimersByTimeAsync(900);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.createNote).toHaveBeenCalledTimes(1);
    const firstId = vi.mocked(api.createNote).mock.calls[0][3];
    expect(firstId).toMatch(/^note_/);

    fireEvent.click(screen.getByRole("button", { name: "Ver markdown" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown da nota" }), {
      target: { value: "outro texto" },
    });
    await vi.advanceTimersByTimeAsync(900);

    expect(api.createNote).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.createNote).mock.calls[1][3]).toBe(firstId);
  });
});
