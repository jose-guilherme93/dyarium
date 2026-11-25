import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Audio } from "../types";

// O anexo desta nota vem do cofre sob demanda: o teste entrega cada estado do
// byte no lugar do hook real, sem tocar no IndexedDB nem no Drive.
const duble = vi.hoisted(() => ({
  estado: {
    url: "",
    status: "idle" as "idle" | "loading" | "error",
    reason: "",
    retry: () => undefined,
  },
}));

vi.mock("../lib/useAttachment", () => ({
  useAttachment: () => duble.estado,
}));

import { AudioTrack } from "./AudioTrack";

const audio: Audio = {
  id: "att-audio",
  content_type: "audio/aac",
  size_bytes: 4,
  duration_seconds: 3,
  created_at: "2026-11-18T10:00:00.000Z",
  transcript: {
    model: "m",
    language: "pt",
    text: "fala que chegou do cofre",
    trim_silence: false,
    duration_seconds: 3,
  },
};

describe("AudioTrack com o anexo sob demanda", () => {
  it("enquanto o byte chega mostra so o carregando, e a transcricao continua", () => {
    duble.estado = { url: "", status: "loading", reason: "", retry: () => undefined };
    const { container } = render(<AudioTrack audio={audio} />);

    expect(screen.getByLabelText("Carregando áudio")).toBeInTheDocument();
    // O byte ausente nao esconde o texto que ja esta no retrato.
    expect(container.querySelector(".transcript--clamped")).not.toBeNull();
    expect(screen.queryByLabelText("Reproduzir")).not.toBeInTheDocument();
  });

  it("falha do anexo fica no audio e oferece tentar de novo", () => {
    const retry = vi.fn();
    duble.estado = {
      url: "",
      status: "error",
      reason: "anexo indisponível agora",
      retry,
    };
    render(<AudioTrack audio={audio} />);

    expect(screen.getByText("Áudio fora deste navegador")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("com o byte em maos o player volta, com a transcricao no lugar", () => {
    duble.estado = {
      url: "blob:voz",
      status: "idle",
      reason: "",
      retry: () => undefined,
    };
    const { container } = render(<AudioTrack audio={audio} />);

    expect(screen.getByLabelText("Reproduzir")).toBeInTheDocument();
    expect(container.querySelector("audio")?.getAttribute("src")).toBe("blob:voz");
    expect(screen.queryByLabelText("Carregando áudio")).not.toBeInTheDocument();
  });
});
