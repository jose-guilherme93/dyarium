import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NoteList } from "./NoteList";
import { ALL_NOTEBOOKS } from "../lib/notebooks";
import type { Entry, Notebook } from "../types";

const NOTEBOOKS: Notebook[] = [
  {
    id: "trabalho",
    name: "Trabalho",
    color: "",
    entry_count: 1,
    is_default: false,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
  {
    id: "notas-ao-acaso",
    name: "Notas ao acaso",
    color: "",
    entry_count: 2,
    is_default: true,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  },
];

const ENTRIES: Entry[] = [
  {
    id: "e1",
    title: "Reunião de segunda",
    status: "ready",
    source: "text",
    notebook_id: "trabalho",
    original_filename: "",
    content_type: "",
    size_bytes: 0,
    duration_seconds: 0,
    sha256: "",
    recorded_at: "2026-10-19T10:00:00Z",
    created_at: "2026-10-19T10:00:00Z",
    updated_at: "2026-10-19T10:00:00Z",
    tags: ["contrato"],
    preview: "Falamos sobre o contrato e o prazo da entrega.",
  },
  {
    id: "e2",
    title: "Áudio arquivado",
    status: "ready",
    source: "share",
    notebook_id: "notas-ao-acaso",
    original_filename: "a.wav",
    content_type: "audio/wav",
    size_bytes: 10,
    duration_seconds: 65,
    sha256: "",
    recorded_at: "2026-10-18T10:00:00Z",
    created_at: "2026-10-18T10:00:00Z",
    updated_at: "2026-10-18T10:00:00Z",
    archived: true,
    tags: ["audio"],
  },
  {
    id: "e3",
    title: "Viagem de fim de ano",
    status: "ready",
    source: "text",
    notebook_id: "notas-ao-acaso",
    original_filename: "",
    content_type: "",
    size_bytes: 0,
    duration_seconds: 0,
    sha256: "",
    recorded_at: "2026-10-17T10:00:00Z",
    created_at: "2026-10-17T10:00:00Z",
    updated_at: "2026-10-17T10:00:00Z",
    tags: ["viagem"],
  },
];

vi.mock("../api", () => ({
  api: {
    listAllEntries: vi.fn(async () => ({ entries: ENTRIES })),
    listEntriesCached: vi.fn(async () => undefined),
  },
}));

function renderList(notebookId: string, activeId: string | null = null) {
  return render(
    <NoteList
      refreshKey={0}
      activeId={activeId}
      failures={{}}
      notebookId={notebookId}
      notebooks={NOTEBOOKS}
      onOpen={() => undefined}
      onCreate={() => undefined}
      onManageTags={() => undefined}
    />,
  );
}

describe("NoteList", () => {
  it("mostra a previa e as tags da nota aberta", async () => {
    renderList("trabalho", "e1");
    await waitFor(() => expect(screen.getByText("Reunião de segunda")).toBeInTheDocument());
    expect(screen.getByText("Falamos sobre o contrato e o prazo da entrega.")).toBeInTheDocument();
    expect(screen.getAllByText("contrato").length).toBeGreaterThan(0);
  });

  it("limita a lista ao caderno escolhido", async () => {
    renderList("trabalho");
    await waitFor(() => expect(screen.getByText("Reunião de segunda")).toBeInTheDocument());
    expect(screen.queryByText("Áudio arquivado")).not.toBeInTheDocument();
  });

  it("mantem a nota aberta inteira visivel na lista", async () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderList("trabalho", "e1");
      await waitFor(() => expect(screen.getByText("Reunião de segunda")).toBeInTheDocument());
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("em todos os cadernos mostra as notas ativas dos dois", async () => {
    renderList(ALL_NOTEBOOKS);
    await waitFor(() => expect(screen.getByText("Reunião de segunda")).toBeInTheDocument());
    expect(screen.queryByText("Áudio arquivado")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver notas arquivadas" }));
    expect(await screen.findByText("Áudio arquivado")).toBeInTheDocument();
  });

  it("filtra por tag depois de abrir o filtro", async () => {
    renderList(ALL_NOTEBOOKS);
    await waitFor(() => expect(screen.getByText("Viagem de fim de ano")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^contrato/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Filtrar por tags" }));
    fireEvent.click(screen.getByRole("button", { name: /^contrato/ }));
    expect(screen.queryByText("Viagem de fim de ano")).not.toBeInTheDocument();
    expect(screen.getByText("Reunião de segunda")).toBeInTheDocument();
  });

  it("sinaliza o filtro ativo fora do popover", async () => {
    renderList(ALL_NOTEBOOKS);
    await waitFor(() => expect(screen.getByText("Viagem de fim de ano")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Filtrar por tags" }));
    fireEvent.click(screen.getByRole("button", { name: /^contrato/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Remover filtro contrato" })).toBeInTheDocument();
  });
});
