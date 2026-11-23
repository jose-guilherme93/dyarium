import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportResult } from "../local/import";
import type { Diagnosis } from "../local/diagnose";

const mocks = vi.hoisted(() => ({
  importEntries: vi.fn(),
  serverSource: vi.fn(() => ({ fonte: true })),
  diagnoseSource: vi.fn(async (): Promise<Diagnosis> => ({ ok: true })),
  flushVaultSync: vi.fn(async () => null),
}));

vi.mock("../local/import", () => ({ importEntries: mocks.importEntries }));
vi.mock("../local/serverSource", () => ({ serverSource: mocks.serverSource }));
vi.mock("../local/diagnose", () => ({ diagnoseSource: mocks.diagnoseSource }));
vi.mock("../local/folderSync", () => ({ flushVaultSync: mocks.flushVaultSync }));

const RESULTADO: ImportResult = {
  created: 400,
  updated: 19,
  trashed: 0,
  failed: 0,
  total: 419,
  notebooks: 0,
  covers: 0,
  coversFailed: 0,
  audios: 12,
  audiosFailed: 0,
  transcripts: 0,
  transcriptsFailed: 0,
  analyses: 0,
  analysesFailed: 0,
};

let job: typeof import("../local/importJob");
let Strip: typeof import("./ImportJobStrip").ImportJobStrip;
let ToastProvider: typeof import("./Toasts").ToastProvider;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  mocks.importEntries.mockReset();
  mocks.serverSource.mockReset().mockReturnValue({ fonte: true });
  mocks.diagnoseSource.mockReset().mockResolvedValue({ ok: true });
  mocks.flushVaultSync.mockReset().mockResolvedValue(null);
  job = await import("../local/importJob");
  Strip = (await import("./ImportJobStrip")).ImportJobStrip;
  ToastProvider = (await import("./Toasts")).ToastProvider;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** Inicia a tarefa e espera as promessas, sem depender de tempo real. */
async function iniciar(): Promise<void> {
  await act(async () => {
    job.startServerImport("https://exemplo.invalido", "token-secreto");
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

function montar() {
  return render(
    <ToastProvider>
      <Strip />
    </ToastProvider>,
  );
}

describe("ImportJobStrip", () => {
  it("running mostra o numero, o medidor e nada de aviso ainda", async () => {
    mocks.importEntries.mockImplementation(
      async (_fonte, onProgress) => {
        onProgress({ done: 213, total: 419 });
        return new Promise<ImportResult>(() => undefined);
      },
    );
    const { container } = montar();
    await iniciar();

    expect(screen.getByText("419 notas")).toBeInTheDocument();
    expect(screen.getByText("· 213")).toBeInTheDocument();

    const medidor = container.querySelector(".import-job-meter");
    expect(medidor).toHaveAttribute("aria-hidden", "true");
    const barra = medidor?.querySelector("span") as HTMLElement;
    expect(barra.style.width).toMatch(/^50\./);

    // O aviso do fim nao pode disparar no meio do caminho nem a cada nota.
    expect(screen.queryByText(/importadas/)).not.toBeInTheDocument();
    expect(container.querySelector(".import-job-strip [aria-live]")).toBeEmptyDOMElement();
  });

  it("done avisa uma vez, mostra os audios e some depois de 8 s", async () => {
    mocks.importEntries.mockResolvedValue(RESULTADO);
    montar();
    await iniciar();

    expect(screen.getByText("419 notas")).toBeInTheDocument();
    expect(screen.getByText("· 12 áudios")).toBeInTheDocument();
    // O aviso do projeto aparece uma vez, na regiao dos toasts.
    const avisos = screen.getByRole("status");
    expect(within(avisos).getByText("419 notas importadas · 12 áudios")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    // A faixa some sozinha e o aviso nao e repetido.
    expect(screen.queryByText("419 notas")).not.toBeInTheDocument();
    expect(within(avisos).queryByText("419 notas importadas · 12 áudios")).not.toBeInTheDocument();
  });

  it("done conta transcricoes e analises quando existem", async () => {
    mocks.importEntries.mockResolvedValue({
      ...RESULTADO,
      transcripts: 3,
      analyses: 2,
      transcriptsFailed: 1,
      analysesFailed: 0,
    });
    montar();
    await iniciar();

    expect(screen.getByText("· 3 transcrições")).toBeInTheDocument();
    expect(screen.getByText("· 2 análises")).toBeInTheDocument();
    const avisos = screen.getByRole("status");
    expect(
      within(avisos).getByText(
        "419 notas importadas · 12 áudios · 3 transcrições · 2 análises",
      ),
    ).toBeInTheDocument();
  });

  it("done mostra os cadernos quando a importacao trouxe algum", async () => {
    mocks.importEntries.mockResolvedValue({ ...RESULTADO, notebooks: 2 });
    montar();
    await iniciar();

    expect(screen.getByText("· 2 cadernos")).toBeInTheDocument();
    const avisos = screen.getByRole("status");
    expect(
      within(avisos).getByText("419 notas importadas · 2 cadernos · 12 áudios"),
    ).toBeInTheDocument();
  });

  it("done mostra as capas quando a importacao trouxe alguma", async () => {
    mocks.importEntries.mockResolvedValue({ ...RESULTADO, notebooks: 1, covers: 2 });
    montar();
    await iniciar();

    expect(screen.getByText("· 2 capas")).toBeInTheDocument();
    const avisos = screen.getByRole("status");
    expect(
      within(avisos).getByText("419 notas importadas · 1 caderno · 2 capas · 12 áudios"),
    ).toBeInTheDocument();
  });

  it("done mostra no fim as notas que ficaram com erro", async () => {
    mocks.importEntries.mockResolvedValue({ ...RESULTADO, failed: 2 });
    montar();
    await iniciar();

    expect(screen.getByText("· 2 com erro")).toBeInTheDocument();
    const avisos = screen.getByRole("status");
    expect(
      within(avisos).getByText("419 notas importadas · 12 áudios · 2 com erro"),
    ).toBeInTheDocument();
  });

  it("erro mostra a causa em uma linha e fecha no botao", async () => {
    mocks.importEntries.mockRejectedValue(new Error("conexão caiu no meio"));
    montar();
    await iniciar();

    expect(screen.getByText("conexão caiu no meio")).toBeInTheDocument();
    expect(
      within(screen.getByRole("status")).getByText("importação parou · conexão caiu no meio"),
    ).toBeInTheDocument();
    // Erro fica ate a pessoa fechar.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByText("conexão caiu no meio")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "fechar" }));
    expect(screen.queryByText("conexão caiu no meio")).not.toBeInTheDocument();
  });

  it("status de HTTP vira causa curta e sem caminho", async () => {
    mocks.importEntries.mockRejectedValue(
      new Error("401 Unauthorized em /api/v1/sync/manifest?kind=entries&limit=500"),
    );
    montar();
    await iniciar();

    // O numero do status e o caminho nao dizem nada a quem esta vendo as notas.
    expect(screen.getByText("token recusado")).toBeInTheDocument();
    expect(screen.queryByText(/401/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/api\/v1\//)).not.toBeInTheDocument();
  });
});
