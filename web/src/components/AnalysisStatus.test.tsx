import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AnalysisStatus } from "./AnalysisStatus";

const handOff = vi.fn();
let workerState: unknown = null;

vi.mock("../lib/browserWorker", () => ({
  getWorkerState: () => workerState,
  subscribeWorker: () => () => undefined,
  handOffWorker: () => handOff(),
}));

function withJob(entryId: string, stage: string, read: number, total: number) {
  workerState = {
    phase: "working",
    engine: null,
    job: {
      id: "j1",
      type: "analyze",
      entryId,
      title: "Nota",
      stage,
      read,
      total,
      blockIndex: read,
      tokensPerSecond: 4.5,
      startedAt: Date.now(),
    },
  };
}

afterEach(() => {
  workerState = null;
  cleanup();
});

describe("AnalysisStatus", () => {
  it("mostra o bloco e o botao de devolver ao servidor quando roda neste PC", () => {
    withJob("e1", "reading", 1, 3);
    render(<AnalysisStatus entryId="e1" status="analyzing" />);

    expect(screen.getByText("lendo bloco 2 de 3")).toBeInTheDocument();
    expect(screen.getByText("4.5 tok/s")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "no servidor" })).toBeInTheDocument();
  });

  it("ignora a nota de outro job e segue o progresso do servidor", () => {
    withJob("outra", "reading", 0, 2);
    render(
      <AnalysisStatus
        entryId="e1"
        status="analyzing"
        progress={{ stage: "analyzing", done: 1, total: 4 }}
      />,
    );

    expect(screen.getByText("lendo bloco 2 de 4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "no servidor" })).not.toBeInTheDocument();
  });
});
