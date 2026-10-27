import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AudioTrack } from "./AudioTrack";
import type { Audio } from "../types";

const audio: Audio = {
  id: "a1",
  content_type: "audio/aac",
  size_bytes: 1234,
  duration_seconds: 3,
  created_at: "2026-10-15T12:00:00Z",
  transcript: {
    model: "m",
    language: "pt",
    text: "um dois tres quatro cinco seis",
    trim_silence: false,
    duration_seconds: 3,
    segments: [
      { start_ms: 0, end_ms: 1000, text: "um dois" },
      { start_ms: 1000, end_ms: 2000, text: "tres quatro" },
      { start_ms: 2000, end_ms: 3000, text: "cinco seis" },
    ],
  },
};

describe("AudioTrack transcript", () => {
  it("mostra um preview compacto por padrao, sem listar os segmentos", () => {
    const { container } = render(<AudioTrack audio={audio} />);
    expect(screen.getByRole("button", { name: "Mostrar transcrição" })).toBeInTheDocument();
    expect(container.querySelector(".transcript--clamped")).not.toBeNull();
    expect(container.querySelectorAll(".transcript-line")).toHaveLength(0);
  });

  it("expande a transcrição completa ao clicar", () => {
    const { container } = render(<AudioTrack audio={audio} />);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar transcrição" }));
    expect(screen.getByRole("button", { name: "Ocultar transcrição" })).toBeInTheDocument();
    expect(container.querySelector(".transcript--clamped")).toBeNull();
    expect(container.querySelectorAll(".transcript-line")).toHaveLength(3);
  });
});
