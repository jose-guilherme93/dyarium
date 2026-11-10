import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Recorder } from "./Recorder";

vi.mock("../api", () => ({
  uploadFile: vi.fn(),
}));

import { uploadFile } from "../api";

/** MediaRecorder minimo: o teste so precisa do ciclo start/stop. */
class FakeRecorder {
  static last: FakeRecorder | null = null;
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor() {
    FakeRecorder.last = this;
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["a"], { type: "audio/webm" }) });
    this.onstop?.();
  }
}

describe("Recorder progresso do envio", () => {
  beforeEach(() => {
    FakeRecorder.last = null;
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.stubGlobal("navigator", {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(uploadFile).mockReset();
  });

  it("mostra o percentual enquanto o audio sobe", async () => {
    let report: ((sent: number, total: number) => void) | undefined;
    vi.mocked(uploadFile).mockImplementation(async (_file, onProgress) => {
      report = onProgress;
      return new Promise(() => undefined) as never;
    });

    render(<Recorder onUploaded={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Gravar" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Parar/i }));
      await Promise.resolve();
    });

    // A primeira chamada nao passou o progresso e o botao nao mentiu.
    expect(screen.getByRole("button").textContent).toContain("Enviando 0%");

    await act(async () => {
      report?.(50, 100);
    });
    expect(screen.getByRole("button").textContent).toContain("Enviando 50%");
  });
});
