import { beforeEach, describe, expect, it, vi } from "vitest";

const banco = new Map<string, unknown>();

vi.mock("../lib/idb", () => ({
  ATTACHMENTS_STORE: "attachments",
  storeSet: async (_store: string, key: string, value: unknown) => {
    banco.set(key, value);
  },
  storeGet: async (_store: string, key: string) => banco.get(key),
  storeList: async () => [...banco.entries()],
  storeDelete: async (_store: string, key: string) => {
    banco.delete(key);
  },
}));

import {
  deleteLocalAttachment,
  listLocalAttachments,
  localAttachmentUrl,
  saveLocalAttachment,
} from "./attachments";

const imagem = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

beforeEach(() => {
  banco.clear();
  let seq = 0;
  URL.createObjectURL = vi.fn(() => `blob:local-${seq++}`);
  URL.revokeObjectURL = vi.fn();
});

describe("anexos locais", () => {
  it("guarda o byte e devolve o metadado sem blob", async () => {
    const anexo = await saveLocalAttachment("nota-1", imagem());
    expect(anexo.id).toMatch(/^att_[0-9a-f]+$/);
    expect(anexo.entry_id).toBe("nota-1");
    expect(anexo.content_type).toBe("image/png");
    expect(anexo.size_bytes).toBe(3);
    expect("blob" in anexo).toBe(false);
  });

  it("lista so os anexos da nota pedida", async () => {
    await saveLocalAttachment("nota-1", imagem());
    await saveLocalAttachment("nota-2", imagem());
    const daNota1 = await listLocalAttachments("nota-1");
    expect(daNota1).toHaveLength(1);
    expect(daNota1[0].entry_id).toBe("nota-1");
  });

  it("a imagem recem-enviada ja tem URL", async () => {
    const anexo = await saveLocalAttachment("nota-1", imagem());
    expect(localAttachmentUrl(anexo.id)).toMatch(/^blob:local-/);
  });

  it("depois de recarregar, a URL chega no primeiro render e avisa", async () => {
    const enviado = await saveLocalAttachment("nota-1", imagem());
    // Simula uma sessao nova: sem cache de URL.
    vi.resetModules();
    const { localAttachmentUrl: urlFria, subscribeAttachmentUrls } = await import("./attachments");
    let avisos = 0;
    const cancelar = subscribeAttachmentUrls(() => {
      avisos += 1;
    });

    expect(urlFria(enviado.id)).toBe("");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(avisos).toBeGreaterThan(0);
    expect(urlFria(enviado.id)).toMatch(/^blob:/);
    cancelar();
  });

  it("apagar remove do banco e revoga a URL", async () => {
    const anexo = await saveLocalAttachment("nota-1", imagem());
    await deleteLocalAttachment(anexo.id);
    expect(await listLocalAttachments("nota-1")).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
