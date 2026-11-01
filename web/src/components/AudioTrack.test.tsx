import { describe, expect, it, vi } from "vitest";
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

  it("mostra a transcricao como texto: entre aspas e em italico", () => {
    const { container } = render(<AudioTrack audio={audio} />);
    // Preview compacto: o texto inteiro entre aspas.
    expect(container.querySelector(".transcript--clamped")?.textContent).toContain(
      "“um dois tres quatro cinco seis”",
    );

    fireEvent.click(screen.getByRole("button", { name: "Mostrar transcrição" }));
    const lines = container.querySelectorAll(".transcript-line");
    // Um par de aspas para o texto inteiro: abre no primeiro trecho e fecha no
    // ultimo, sem aspirar cada linha.
    expect(lines[0].textContent).toContain("“um dois");
    expect(lines[lines.length - 1].textContent).toContain("cinco seis”");
    expect(lines[1].textContent).not.toContain("“");
  });

  it("expande a transcrição completa ao clicar", () => {
    const { container } = render(<AudioTrack audio={audio} />);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar transcrição" }));
    expect(screen.getByRole("button", { name: "Ocultar transcrição" })).toBeInTheDocument();
    expect(container.querySelector(".transcript--clamped")).toBeNull();
    expect(container.querySelectorAll(".transcript-line")).toHaveLength(3);
  });
});

describe("AudioTrack revisao por IA", () => {
  const revised: Audio = {
    ...audio,
    transcript: {
      ...audio.transcript!,
      text: "Um, dois. Tres, quatro.",
      segments: [
        { start_ms: 0, end_ms: 1000, text: "um dois", revised: "Um, dois." },
        { start_ms: 1000, end_ms: 2000, text: "tres quatro" },
        { start_ms: 2000, end_ms: 3000, text: "cinco seis" },
      ],
    },
  };

  it("mostra o texto revisado e deixa o original no menu da linha", () => {
    render(<AudioTrack audio={revised} />);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar transcrição" }));
    expect(screen.getByText(/Um, dois\./)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Ver o texto original do whisper" }),
    ).toBeNull();

    fireEvent.click(screen.getAllByLabelText("Opções do trecho")[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Ver texto original" }));
    expect(screen.getByText(/Original do whisper: um dois/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText("Opções do trecho")[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Ocultar texto original" }));
    expect(screen.queryByText(/Original do whisper: um dois/)).toBeNull();
  });
});

describe("AudioTrack ações da linha", () => {
  it("abre edição, tarefa, ideia e citação no menu do lápis", () => {
    render(<AudioTrack audio={audio} entryId="e1" />);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar transcrição" }));

    fireEvent.click(screen.getAllByLabelText("Opções do trecho")[0]);
    expect(screen.getByRole("menuitem", { name: "Editar trecho" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Tarefa" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Ideia" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Citação" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "Editar trecho" }));
    expect(screen.getByLabelText("Editar trecho da transcrição")).toHaveValue("um dois");
  });
});

describe("AudioTrack menu", () => {
  it("oferece apagar o audio e avisa quem cuida do anexo", () => {
    const onDelete = vi.fn();
    render(<AudioTrack audio={audio} onDelete={onDelete} />);

    fireEvent.click(screen.getByLabelText("Opções do áudio"));
    fireEvent.click(screen.getByText("Apagar áudio"));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("nao mostra apagar quando nao ha quem remova", () => {
    render(<AudioTrack audio={audio} />);

    fireEvent.click(screen.getByLabelText("Opções do áudio"));

    expect(screen.queryByText("Apagar áudio")).toBeNull();
  });
});
