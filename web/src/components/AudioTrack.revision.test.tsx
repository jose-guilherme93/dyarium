import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const listSegments = vi.hoisted(() => vi.fn());

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: { ...actual.api, listSegments } };
});

import { AudioTrack } from "./AudioTrack";
import type { Audio } from "../types";

function audio(text: string): Audio {
  return {
    id: "a1",
    content_type: "audio/aac",
    size_bytes: 1234,
    duration_seconds: 3,
    created_at: "2026-10-15T12:00:00Z",
    transcript: {
      model: "m",
      language: "pt",
      text,
      trim_silence: false,
      duration_seconds: 3,
      revised: true,
    },
  };
}

describe("AudioTrack revisão em streaming", () => {
  it("relê os segmentos quando a revisão chega com o painel aberto", async () => {
    listSegments
      .mockResolvedValueOnce({
        segments: [
          { start_ms: 0, end_ms: 1000, text: "um dois" },
          { start_ms: 1000, end_ms: 2000, text: "tres quatro" },
        ],
      })
      .mockResolvedValueOnce({
        segments: [
          { start_ms: 0, end_ms: 1000, text: "um dois", revised: "Um, dois." },
          { start_ms: 1000, end_ms: 2000, text: "tres quatro", revised: "Três, quatro." },
        ],
      });

    const { container, rerender } = render(
      <AudioTrack audio={audio("um dois tres quatro")} entryId="e1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mostrar transcrição" }));

    await waitFor(() => {
      expect(container.querySelectorAll(".transcript-line")).toHaveLength(2);
    });
    expect(listSegments).toHaveBeenCalledTimes(1);

    // A primeira janela da revisao chega: o texto visivel muda.
    rerender(<AudioTrack audio={audio("Um, dois. Tres, quatro.")} entryId="e1" />);

    await waitFor(() => {
      expect(listSegments).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText(/Um, dois\./)).toBeTruthy();
    });
    expect(container.querySelectorAll(".transcript-line")).toHaveLength(2);
  });
});
