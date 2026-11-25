import { beforeEach, describe, expect, it, vi } from "vitest";

const idb = vi.hoisted(() => {
  const stores = new Map<string, Map<string, unknown>>();
  const loja = (store: string): Map<string, unknown> => {
    let atual = stores.get(store);
    if (!atual) {
      atual = new Map();
      stores.set(store, atual);
    }
    return atual;
  };
  return {
    stores,
    ATTACHMENTS_STORE: "attachments",
    COVERS_STORE: "covers",
    storeList: async <T>(store: string): Promise<Array<[string, T]>> =>
      [...loja(store).entries()] as Array<[string, T]>,
  };
});

vi.mock("../lib/idb", () => idb);

vi.mock("../../../mobile/src/core/repo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../mobile/src/core/repo")>();
  return { ...actual, listRecordings: vi.fn() };
});

import { listRecordings } from "../../../mobile/src/core/repo";
import { registerNodeDatabase } from "./__fixtures__/nodeDb";
import { vaultStats } from "./vaultStats";

beforeEach(async () => {
  idb.stores.clear();
  await registerNodeDatabase();
  vi.mocked(listRecordings).mockReset();
});

describe("vaultStats", () => {
  it("conta notas, audios e duracao", async () => {
    vi.mocked(listRecordings).mockResolvedValue([
      { source: "microphone", durationMs: 10000, text: "abc" } as never,
      { source: "share", durationMs: 60000 } as never,
      { source: "text", durationMs: 0 } as never,
    ]);
    const anexos = idb.stores.get("attachments") ?? new Map();
    idb.stores.set("attachments", anexos);
    anexos.set("a1", { size_bytes: 100, content_type: "image/png" });
    anexos.set("a2", { size_bytes: 50, content_type: "audio/mpeg" });

    const capas = idb.stores.get("covers") ?? new Map();
    idb.stores.set("covers", capas);
    capas.set("livro", { blob: new Blob(["abc"], { type: "image/png" }) });

    const resultado = await vaultStats();
    expect(resultado.notes).toBe(3);
    expect(resultado.audioNotes).toBe(2);
    expect(resultado.audioSeconds).toBeCloseTo(70);
    expect(resultado.attachments).toBe(2);
    expect(resultado.attachmentBytes).toBe(150);
    expect(resultado.covers).toBe(1);
    expect(resultado.coverBytes).toBe(3);
    expect(resultado.noteBytes).toBe(3);
    expect(resultado.bytes).toBe(156);
  });

  it("ignora capa sem blob", async () => {
    vi.mocked(listRecordings).mockResolvedValue([]);
    const capas = new Map();
    idb.stores.set("covers", capas);
    capas.set("livro", { content_type: "image/png" });

    const resultado = await vaultStats();
    expect(resultado.covers).toBe(0);
    expect(resultado.coverBytes).toBe(0);
  });
});
