import { beforeEach, describe, expect, it, vi } from "vitest";

const banco = new Map<string, unknown>();

vi.mock("../lib/idb", () => ({
  COVERS_STORE: "covers",
  storeSet: async (_store: string, key: string, value: unknown) => {
    banco.set(key, value);
  },
  storeGet: async (_store: string, key: string) => banco.get(key),
  storeDelete: async (_store: string, key: string) => {
    banco.delete(key);
  },
}));

/** Modulo novo por teste: o cache de URL nao vaza de um caso para o outro. */
async function modulo() {
  vi.resetModules();
  return import("./covers");
}

const imagem = (bytes: number[] = [1, 2, 3]) =>
  new Blob([new Uint8Array(bytes)], { type: "image/png" });

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  banco.clear();
  let seq = 0;
  URL.createObjectURL = vi.fn(() => `blob:capa-${seq++}`);
  URL.revokeObjectURL = vi.fn();
});

describe("capas locais", () => {
  it("salvar devolve updated_at e guarda o blob", async () => {
    const { localCoverBlob, localCoverUrl, saveLocalCover } = await modulo();
    const { updated_at } = await saveLocalCover("livro-1", imagem());

    expect(typeof updated_at).toBe("string");
    expect(Number.isNaN(Date.parse(updated_at))).toBe(false);
    expect(banco.size).toBe(1);
    expect(await localCoverBlob("livro-1")).toBeInstanceOf(Blob);
    expect(localCoverUrl("livro-1")).toMatch(/^blob:capa-/);
  });

  it("guardar de novo sobrescreve o blob e troca a URL", async () => {
    const { localCoverBlob, localCoverUrl, saveLocalCover } = await modulo();
    await saveLocalCover("livro-1", imagem([1, 2, 3]));
    const primeira = localCoverUrl("livro-1");

    await saveLocalCover("livro-1", imagem([9, 9]));
    const segunda = localCoverUrl("livro-1");

    expect(banco.size).toBe(1);
    expect((await localCoverBlob("livro-1")).size).toBe(2);
    expect(segunda).toMatch(/^blob:capa-/);
    expect(segunda).not.toBe(primeira);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("apagar remove do banco, revoga a URL e a capa volta a faltar", async () => {
    const { deleteLocalCover, localCoverBlob, localCoverUrl, saveLocalCover } = await modulo();
    await saveLocalCover("livro-1", imagem());
    expect(localCoverUrl("livro-1")).toMatch(/^blob:/);

    await deleteLocalCover("livro-1");

    expect(localCoverUrl("livro-1")).toBe("");
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    await expect(localCoverBlob("livro-1")).rejects.toThrow("capa indisponivel");
  });

  it("o assinante e avisado quando o blob chega depois", async () => {
    const { saveLocalCover } = await modulo();
    await saveLocalCover("livro-1", imagem());

    // Sessao nova: sem cache de URL em memoria.
    const { localCoverUrl: urlFria, subscribeCoverUrls, coverUrlsVersion } = await modulo();
    let avisos = 0;
    const antes = coverUrlsVersion();
    const cancelar = subscribeCoverUrls(() => {
      avisos += 1;
    });

    expect(urlFria("livro-1")).toBe("");
    await tick();
    expect(avisos).toBeGreaterThan(0);
    expect(coverUrlsVersion()).toBeGreaterThan(antes);
    expect(urlFria("livro-1")).toMatch(/^blob:/);
    cancelar();
  });

  it("versao diferente gera URL diferente, e null e vazio sao a mesma versao", async () => {
    const { localCoverUrl, saveLocalCover } = await modulo();
    await saveLocalCover("livro-1", imagem());

    expect(localCoverUrl("livro-1", "v1")).toBe("");
    await tick();
    const primeira = localCoverUrl("livro-1", "v1");
    expect(primeira).toMatch(/^blob:/);

    expect(localCoverUrl("livro-1", "v2")).toBe("");
    await tick();
    const segunda = localCoverUrl("livro-1", "v2");
    expect(segunda).toMatch(/^blob:/);
    expect(segunda).not.toBe(primeira);

    const semVersao = localCoverUrl("livro-1");
    expect(localCoverUrl("livro-1", null)).toBe(semVersao);
    expect(localCoverUrl("livro-1", "")).toBe(semVersao);
  });

  it("livro sem capa rejeita ao pedir o blob", async () => {
    const { localCoverBlob } = await modulo();
    await expect(localCoverBlob("livro-2")).rejects.toThrow("capa indisponivel");
  });
});
