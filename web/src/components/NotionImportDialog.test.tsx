import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotionImportDialog } from "./NotionImportDialog";
import type { Notebook } from "../types";
import type {
  NotionImportOptions,
  NotionImportResult,
  NotionInspection,
  NotionInspectionPage,
  NotionSource,
} from "../lib/notionImport";
import {
  importNotionSource,
  inspectNotionSource,
  readNotionSource,
} from "../lib/notionImport";

vi.mock("../lib/notionImport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/notionImport")>();
  return {
    ...actual,
    readNotionSource: vi.fn(),
    inspectNotionSource: vi.fn(),
    importNotionSource: vi.fn(),
  };
});

function notebook(id: string, name: string, isDefault = false): Notebook {
  return {
    id,
    name,
    color: "",
    is_default: isDefault,
    entry_count: 0,
    created_at: "2026-10-28T12:00:00Z",
    updated_at: "2026-10-28T12:00:00Z",
  };
}

const source: NotionSource = {
  files: new Map(),
  html: [],
  fallbackYear: 2026,
  rootName: "Export",
  warnings: [],
};

const pageInfo: NotionInspectionPage = {
  fileName: "Export/Nota.html",
  notionId: "2ae9b5ae3c838019933dc79d240c6afc",
  title: "Nota de exemplo",
  recordedAt: new Date(2025, 10, 17, 15, 57).toISOString(),
  dateProperty: "Criado em",
  imageCount: 1,
  commentCount: 0,
  skippedProperties: ["Status"],
  isDatabaseIndex: false,
  warnings: [],
  preview: [
    { kind: "image", src: "foto.png", caption: "", origin: "property" },
    { kind: "markdown", text: "primeiro paragrafo" },
  ],
};

const inspection: NotionInspection = {
  pages: [pageInfo],
  importable: [pageInfo],
  dateOptions: [
    {
      name: "Criado em",
      type: "created_time",
      raw: "17 de novembro de 2025 15:57",
      sampleDate: pageInfo.recordedAt,
    },
  ],
  counts: {
    pages: 1,
    importable: 1,
    images: 1,
    comments: 0,
    withoutDate: 0,
    databaseIndexes: 0,
    datesWithoutYear: 0,
  },
  skippedProperties: ["Status"],
  warnings: [],
};

const result: NotionImportResult = {
  imported: 1,
  existing: 0,
  failed: 0,
  moved: 0,
  images: 1,
  tags: 0,
  comments: 0,
  updated: 0,
  withoutDate: 0,
  total: 1,
  cancelled: false,
  notebookId: "notion-created",
  notebookName: "Notion",
  notebookCreated: true,
  notebookRemoved: false,
  firstEntryId: pageInfo.notionId,
  failures: [],
  warnings: [],
};

function renderDialog(notebooks: Notebook[], currentNotebookId = "notas-ao-acaso") {
  const onFinished = vi.fn();
  const onOpenEntry = vi.fn();
  const onClose = vi.fn();
  render(
    <NotionImportDialog
      open
      notebooks={notebooks}
      currentNotebookId={currentNotebookId}
      onClose={onClose}
      onFinished={onFinished}
      onOpenEntry={onOpenEntry}
    />,
  );
  return { onFinished, onOpenEntry, onClose };
}

async function loadReview() {
  const zip = new File(["zip"], "Export.zip", { type: "application/zip" });
  fireEvent.change(screen.getByLabelText("Escolher zip do Notion"), {
    target: { files: [zip] },
  });
  await screen.findByRole("button", { name: "Importar 1 nota" });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readNotionSource).mockResolvedValue(source);
  vi.mocked(inspectNotionSource).mockResolvedValue(inspection);
  vi.mocked(importNotionSource).mockResolvedValue(result);
});

describe("NotionImportDialog", () => {
  it("mostra a revisao com data original, previa e limitacoes", async () => {
    renderDialog([notebook("notas-ao-acaso", "Notas ao acaso", true)]);
    await loadReview();
    expect(screen.getByText("Nota de exemplo")).toBeInTheDocument();
    expect(screen.getByText("Criado em")).toBeInTheDocument();
    expect(screen.getByText("Primeiro paragrafo".toLowerCase())).toBeInTheDocument();
    expect(screen.getByText("imagem")).toBeInTheDocument();
    expect(screen.getByText("Ícone e capa da página não são importados.")).toBeInTheDocument();
    expect(screen.getByText(/Status/)).toBeInTheDocument();
  });

  it("cria o caderno Notion com um clique e importa tudo nele", async () => {
    const { onFinished, onOpenEntry } = renderDialog([notebook("notas-ao-acaso", "Notas ao acaso", true)]);
    await loadReview();
    fireEvent.click(screen.getByRole("button", { name: "Criar caderno Notion" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar 1 nota" }));

    await screen.findByText("1 importada");
    expect(onFinished).toHaveBeenCalledWith(result);
    expect(importNotionSource).toHaveBeenCalledWith(
      source,
      inspection,
      expect.objectContaining({
        notebook: { kind: "notion" },
        fallbackYear: 2026,
        dateProperty: "Criado em",
      }),
    );
    expect(screen.getByText(/Notion \(criado\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Abrir a primeira nota" }));
    expect(onOpenEntry).toHaveBeenCalledWith(pageInfo.notionId);
  });

  it("usa o caderno Notion existente em vez de criar outro", async () => {
    const { onFinished } = renderDialog([
      notebook("notas-ao-acaso", "Notas ao acaso", true),
      notebook("notion", "Notion"),
    ]);
    await loadReview();
    fireEvent.click(screen.getByRole("button", { name: "Usar caderno Notion" }));
    fireEvent.click(screen.getByRole("button", { name: "Importar 1 nota" }));
    await screen.findByText("1 importada");
    expect(onFinished).toHaveBeenCalled();
    const options = vi.mocked(importNotionSource).mock.calls[0]![2] as NotionImportOptions;
    expect(options.notebook).toEqual({ kind: "existing", id: "notion" });
  });

  it("mostra erro de leitura sem sair da escolha", async () => {
    vi.mocked(readNotionSource).mockRejectedValueOnce(new Error("ruim"));
    renderDialog([notebook("notas-ao-acaso", "Notas ao acaso", true)]);
    fireEvent.change(screen.getByLabelText("Escolher zip do Notion"), {
      target: { files: [new File(["zip"], "Export.zip", { type: "application/zip" })] },
    });
    await waitFor(() =>
      expect(screen.getByText("Não foi possível importar. Tente de novo.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Escolher \.zip/ })).toBeInTheDocument();
  });
});
