import { describe, expect, it } from "vitest";
import { noteDate, sortNotesByDate } from "./noteOrder";
import type { Entry } from "../types";

function entry(
  id: string,
  recordedAt: string | null,
  createdAt: string,
  updatedAt = createdAt,
): Entry {
  return {
    id,
    title: id,
    status: "ready",
    source: "text",
    original_filename: "",
    content_type: "text/plain",
    size_bytes: 0,
    duration_seconds: 0,
    sha256: "",
    recorded_at: recordedAt,
    created_at: createdAt,
    updated_at: updatedAt,
  } as Entry;
}

describe("ordem das notas", () => {
  const importada = entry("importada", "2024-03-01T10:00:00Z", "2026-10-01T10:00:00Z");
  const recente = entry("recente", "2026-03-02T10:00:00Z", "2026-03-02T10:00:00Z");
  const antiga = entry("antiga", "2026-03-01T10:00:00Z", "2026-03-01T10:00:00Z");
  const editada = entry(
    "editada",
    "2026-03-01T12:00:00Z",
    "2026-03-01T12:00:00Z",
    "2026-11-01T10:00:00Z",
  );

  it("ordena pela data do evento, nao pela data de criacao", () => {
    expect(sortNotesByDate([importada, recente, antiga], "newest").map((item) => item.id)).toEqual([
      "recente",
      "antiga",
      "importada",
    ]);
  });

  it("nao sobe a nota antiga so porque foi editada agora", () => {
    expect(
      sortNotesByDate([editada, recente], "newest").map((item) => item.id),
    ).toEqual(["recente", "editada"]);
  });

  it("inverte para as mais antigas primeiro", () => {
    expect(sortNotesByDate([recente, antiga, importada], "oldest").map((item) => item.id)).toEqual([
      "importada",
      "antiga",
      "recente",
    ]);
  });

  it("desempata pelo id para a lista nao pular entre renders", () => {
    const a = entry("a", "2026-03-02T10:00:00Z", "2026-03-02T10:00:00Z");
    const b = entry("b", "2026-03-02T10:00:00Z", "2026-03-02T10:00:00Z");
    const first = sortNotesByDate([a, b], "newest").map((item) => item.id);
    const second = sortNotesByDate([b, a], "newest").map((item) => item.id);
    expect(second).toEqual(first);
  });

  it("compara instantes, nao texto, entre datas com fusos diferentes", () => {
    // 23:00-03:00 e 02:00Z do dia seguinte: em texto o ISO do dia 1 viria antes.
    const antes = entry("antes", "2026-03-02T01:00:00Z", "2026-03-02T01:00:00Z");
    const depois = entry("depois", "2026-03-01T23:00:00-03:00", "2026-03-01T23:00:00-03:00");
    expect(sortNotesByDate([antes, depois], "newest").map((item) => item.id)).toEqual([
      "depois",
      "antes",
    ]);
  });

  it("sem recorded_at usa a data de criacao", () => {
    const semEvento = entry("sem", null, "2026-03-05T10:00:00Z");
    expect(noteDate(semEvento)).toBe("2026-03-05T10:00:00Z");
    expect(sortNotesByDate([recente, semEvento], "newest")[0].id).toBe("sem");
  });
});
