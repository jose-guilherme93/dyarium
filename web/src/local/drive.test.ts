import { describe, expect, it, vi } from "vitest";

import { DriveClient, openVaultFolder } from "./drive";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeDrive(respostas: Array<unknown>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const proxima = respostas.shift();
    if (proxima instanceof Response) return proxima;
    return new Response(JSON.stringify(proxima ?? {}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("cliente do Drive", () => {
  it("acha a pasta existente sem criar outra", async () => {
    const { calls, fetchImpl } = fakeDrive([{ files: [{ id: "pasta-1", name: "Dyarium" }] }]);
    const client = new DriveClient("token", { fetchImpl });

    const id = await client.ensureFolder("Dyarium");

    expect(id).toBe("pasta-1");
    expect(calls).toHaveLength(1);
    const consulta = new URL(calls[0].url).searchParams.get("q") ?? "";
    expect(consulta).toContain("name = 'Dyarium'");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer token");
  });

  it("cria a pasta quando nao existe", async () => {
    const { calls, fetchImpl } = fakeDrive([{ files: [] }, { id: "pasta-nova" }]);
    const client = new DriveClient("token", { fetchImpl });

    expect(await client.ensureFolder("Dyarium")).toBe("pasta-nova");
    const criacao = JSON.parse(String(calls[1].init.body));
    expect(criacao).toMatchObject({
      name: "Dyarium",
      mimeType: "application/vnd.google-apps.folder",
    });
  });

  it("monta Dyarium/<vaultId>", async () => {
    const { fetchImpl } = fakeDrive([
      { files: [{ id: "raiz" }] },
      { files: [] },
      { id: "cofre" },
    ]);
    const client = new DriveClient("token", { fetchImpl });
    expect(await client.ensureVaultFolder("abc123")).toBe("cofre");
  });

  it("cria arquivo novo com conteudo e metadados no mesmo envio", async () => {
    const { calls, fetchImpl } = fakeDrive([
      { files: [] },
      { id: "arq-1", name: "backup.enc" },
    ]);
    const client = new DriveClient("token", { fetchImpl });

    const arquivo = await client.put("pasta", "backup.enc", new Uint8Array([1, 2, 3]));

    expect(arquivo.id).toBe("arq-1");
    const envio = calls[1];
    expect(envio.url).toContain("uploadType=multipart");
    expect(envio.init.method).toBe("POST");
    const corpo = new TextDecoder().decode(envio.init.body as Uint8Array);
    expect(corpo).toContain('"name":"backup.enc"');
    expect(corpo).toContain('"parents":["pasta"]');
    expect(corpo).toContain("\u0001\u0002\u0003");
  });

  it("substitui o arquivo existente em vez de duplicar", async () => {
    const { calls, fetchImpl } = fakeDrive([
      { files: [{ id: "arq-1", name: "backup.enc" }] },
      { id: "arq-1" },
    ]);
    const client = new DriveClient("token", { fetchImpl });

    await client.put("pasta", "backup.enc", "texto");

    expect(calls[1].url).toContain("/files/arq-1");
    expect(calls[1].init.method).toBe("PATCH");
    const corpo = new TextDecoder().decode(calls[1].init.body as Uint8Array);
    expect(corpo).not.toContain('"parents"');
    expect(corpo).toContain("texto");
  });

  it("baixa o conteudo do arquivo", async () => {
    const { fetchImpl } = fakeDrive([new Response(new Uint8Array([9, 8, 7]), { status: 200 })]);
    const client = new DriveClient("token", { fetchImpl });
    expect(Array.from(await client.download("arq-1"))).toEqual([9, 8, 7]);
  });

  it("erro do Drive vira excecao com o status", async () => {
    const { fetchImpl } = fakeDrive([new Response("unauthorized", { status: 401 })]);
    const client = new DriveClient("token-vencido", { fetchImpl });
    await expect(client.list("pasta")).rejects.toThrow(/401/);
  });

  it("abre a pasta do cofre e lista o que ja existe", async () => {
    const { fetchImpl } = fakeDrive([
      { files: [{ id: "raiz" }] },
      { files: [{ id: "cofre" }] },
      { files: [{ id: "a", name: "backup.enc" }] },
    ]);
    const client = new DriveClient("token", { fetchImpl });
    const cofre = await openVaultFolder(client, "abc123");
    expect(cofre.folderId).toBe("cofre");
    expect(cofre.files.map((file) => file.name)).toEqual(["backup.enc"]);
  });
});
