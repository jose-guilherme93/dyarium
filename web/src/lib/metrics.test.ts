import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Recording } from "../../../mobile/src/core/types";
import type { MetricsSnapshotV2 } from "../types";

// O cofre local mora no repositorio do app (`mobile/src/core/repo`). O teste
// troca so a leitura: o resto do modulo continua real.
const repo = vi.hoisted(() => ({
  recordings: [] as Recording[],
}));

vi.mock("../../../mobile/src/core/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../mobile/src/core/repo")>();
  return {
    ...actual,
    listRecordings: vi.fn(async () => repo.recordings),
  };
});

import { api } from "../api";
import {
  buildWebSnapshot,
  recordingFromEntry,
  webDeviceId,
  type EntryWithText,
} from "./metrics";

/** Relogio local fixo: as janelas contam dias corridos no fuso do navegador. */
const NOW = new Date(2026, 10, 16, 12, 0, 0);

function at(daysAgo: number, hour = 10): string {
  return new Date(2026, 10, 16 - daysAgo, hour, 0, 0).toISOString();
}

function recording(overrides: Partial<Recording>): Recording {
  return {
    id: "r1",
    title: "Nota",
    recordedAt: at(2),
    dir: "/vault/r1",
    segmentCount: 0,
    status: "completed",
    offset: 0,
    attempts: 0,
    createdAt: at(2),
    updatedAt: at(2),
    ...overrides,
  };
}

describe("analise local do dashboard", () => {
  it("conta notas, palavras e caracteres nas janelas 7d/30d/365d", () => {
    const snapshot = buildWebSnapshot(
      [
        recording({ id: "r1", text: "um dois três quatro cinco", recordedAt: at(2) }),
        recording({ id: "r2", text: "seis sete", recordedAt: at(20) }),
        recording({ id: "r3", text: "oito", recordedAt: at(200) }),
      ],
      { deviceId: "web-teste", now: NOW },
    );

    expect(snapshot.schema).toBe(2);
    expect(snapshot.windows["7d"].writing.notes).toBe(1);
    expect(snapshot.windows["7d"].writing.words).toBe(5);
    expect(snapshot.windows["7d"].writing.chars).toBe(25);

    expect(snapshot.windows["30d"].writing.notes).toBe(2);
    expect(snapshot.windows["30d"].writing.words).toBe(7);

    expect(snapshot.windows["365d"].writing.notes).toBe(3);
    expect(snapshot.windows["365d"].writing.words).toBe(8);
  });

  it("marca o snapshot como deste navegador, nao como recebido do aparelho", () => {
    const snapshot = buildWebSnapshot([recording({ text: "uma nota" })], {
      deviceId: "web-teste",
      now: NOW,
    });

    expect(snapshot.device_id).toBe("web-teste");
    expect(snapshot.device_name).toBe("Navegador");
    expect(snapshot.generated_at).toBe(NOW.toISOString());
    expect(snapshot.received_at).toBe(NOW.toISOString());
  });

  it("cofre vazio devolve um snapshot zerado sem estourar", () => {
    const snapshot = buildWebSnapshot([], { deviceId: "web-teste", now: NOW });

    expect(snapshot.schema).toBe(2);
    expect(snapshot.windows["7d"].writing.notes).toBe(0);
    expect(snapshot.windows["7d"].writing.words).toBe(0);
    expect(snapshot.windows["365d"].writing.notes).toBe(0);
    expect(snapshot.streak.current).toBe(0);
  });

  it("gera um device_id estavel com prefixo web-", () => {
    localStorage.removeItem("dyarium.web.device");
    const first = webDeviceId();
    const second = webDeviceId();

    expect(first.startsWith("web-")).toBe(true);
    expect(second).toBe(first);
    expect(localStorage.getItem("dyarium.web.device")).toBe(first);
  });

  it("traduz a entrada do servidor para o formato que as metricas leem", () => {
    const entry: EntryWithText = {
      id: "e1",
      title: "No servidor",
      status: "ready",
      source: "text",
      original_filename: "",
      content_type: "",
      size_bytes: 0,
      duration_seconds: 0,
      sha256: "",
      recorded_at: at(1),
      created_at: at(1),
      updated_at: at(1),
      notebook_id: "notas-ao-acaso",
      tags: ["diario"],
      text: "corpo completo da nota",
      transcript: "fala transcrita",
    };

    const converted = recordingFromEntry(entry);

    expect(converted.id).toBe("e1");
    expect(converted.recordedAt).toBe(at(1));
    expect(converted.createdAt).toBe(at(1));
    expect(converted.updatedAt).toBe(at(1));
    expect(converted.text).toBe("corpo completo da nota");
    expect(converted.transcript).toBe("fala transcrita");
    expect(converted.notebookId).toBe("notas-ao-acaso");
    expect(converted.tags).toEqual(["diario"]);
    expect(converted.source).toBe("text");
    expect(converted.status).toBe("completed");
  });
});

describe("api.getMetrics sem token", () => {
  beforeEach(() => {
    localStorage.removeItem("dyarium.token");
    repo.recordings = [
      recording({
        id: "local-1",
        text: "uma nota local com cinco palavras",
        recordedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ];
  });

  it("calcula um snapshot schema 2 a partir das notas do cofre", async () => {
    const result = await api.getMetrics();

    expect(result.schema).toBe(2);
    expect(result.snapshots).toHaveLength(1);

    const snapshot = result.snapshots[0] as MetricsSnapshotV2;
    expect(snapshot.schema).toBe(2);
    expect(snapshot.device_id.startsWith("web-")).toBe(true);
    expect(snapshot.device_name).toBe("Navegador");
    expect(snapshot.windows["7d"].writing.notes).toBe(1);
    expect(snapshot.windows["7d"].writing.words).toBe(6);
  });

  it("cofre vazio devolve lista vazia sem estourar", async () => {
    repo.recordings = [];

    const result = await api.getMetrics();

    expect(result.snapshots).toEqual([]);
    expect(result.schema).toBe(2);
  });
});
