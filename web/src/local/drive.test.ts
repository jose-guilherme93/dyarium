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

function json(corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Separa as duas partes do `multipart/related` que o cliente envia. */
function partesMultipart(
  corpo: Uint8Array,
  contentType: string,
): { meta: Record<string, unknown>; bytes: Uint8Array } {
  const fronteira = /boundary=(.+)$/.exec(contentType)?.[1] ?? "";
  // Latin-1 mantem um caractere por byte: os indices da string valem no array.
  const cru = new TextDecoder("latin1").decode(corpo);
  const marcador = `\r\n--${fronteira}`;
  const inicioMeta = cru.indexOf("\r\n\r\n") + 4;
  const fimMeta = cru.indexOf(marcador, inicioMeta);
  const meta = JSON.parse(cru.slice(inicioMeta, fimMeta)) as Record<string, unknown>;
  const inicioBytes = cru.indexOf("\r\n\r\n", fimMeta) + 4;
  const fim = cru.indexOf(marcador, inicioBytes);
  return { meta, bytes: corpo.slice(inicioBytes, fim) };
}

interface ArquivoNoFake {
  id: string;
  name: string;
  parent: string;
  mimeType: string;
  bytes: Uint8Array;
}

/**
 * Drive de mentira com um Map no lugar do servidor: listagem por `q=` (nome e
 * pasta pai), criacao de pasta, upload multipart, download e DELETE.
 */
function fakeDriveStore() {
  const arquivos = new Map<string, ArquivoNoFake>();
  const calls: Call[] = [];
  const metodos: string[] = [];
  let seq = 0;

  const meta = (arquivo: ArquivoNoFake) => ({
    id: arquivo.id,
    name: arquivo.name,
    mimeType: arquivo.mimeType,
    size: String(arquivo.bytes.length),
  });

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const metodo = (init.method ?? "GET").toUpperCase();
    calls.push({ url: String(input), init });
    metodos.push(metodo);

    if (url.pathname.endsWith("/files") && metodo === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const nome = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'");
      const pai = /'([^']+)' in parents/.exec(q)?.[1];
      const lista = [...arquivos.values()].filter(
        (arquivo) =>
          (!nome || arquivo.name === nome) && (!pai || arquivo.parent === pai),
      );
      return json({ files: lista.map(meta) });
    }

    if (url.pathname === "/drive/v3/files" && metodo === "POST") {
      const corpo = JSON.parse(String(init.body)) as {
        name: string;
        mimeType: string;
        parents?: string[];
      };
      const arquivo: ArquivoNoFake = {
        id: `arq-${++seq}`,
        name: corpo.name,
        parent: corpo.parents?.[0] ?? "root",
        mimeType: corpo.mimeType,
        bytes: new Uint8Array(),
      };
      arquivos.set(arquivo.id, arquivo);
      return json(meta(arquivo));
    }

    if (url.pathname.startsWith("/upload/drive/v3/files")) {
      const { meta: dados, bytes } = partesMultipart(
        init.body as Uint8Array,
        String((init.headers as Record<string, string>)["Content-Type"]),
      );
      const id = url.pathname.split("/").pop() ?? "";
      const existente = metodo === "PATCH" ? arquivos.get(id) : undefined;
      if (existente) {
        existente.bytes = bytes;
        if (typeof dados.name === "string") existente.name = dados.name;
        return json(meta(existente));
      }
      const arquivo: ArquivoNoFake = {
        id: `arq-${++seq}`,
        name: String(dados.name),
        parent: String((dados.parents as string[] | undefined)?.[0] ?? "root"),
        mimeType: "application/octet-stream",
        bytes,
      };
      arquivos.set(arquivo.id, arquivo);
      return json(meta(arquivo));
    }

    if (url.pathname.includes("/files/") && metodo === "DELETE") {
      arquivos.delete(url.pathname.split("/").pop() ?? "");
      // DELETE bem-sucedido nao tem corpo.
      return new Response(null, { status: 204 });
    }

    if (url.pathname.includes("/files/") && metodo === "GET") {
      const arquivo = arquivos.get(url.pathname.split("/").pop() ?? "");
      if (!arquivo) return new Response("nao encontrado", { status: 404 });
      return new Response(arquivo.bytes.slice().buffer, { status: 200 });
    }

    return new Response("rota nao prevista no teste", { status: 500 });
  }) as unknown as typeof fetch;

  return { arquivos, calls, metodos, fetchImpl };
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

describe("cliente do Drive sobre uma pasta do cofre", () => {
  it("lista com o tipo do arquivo e o nome do pai na consulta", async () => {
    const drive = fakeDriveStore();
    drive.arquivos.set("arq-1", {
      id: "arq-1",
      name: "notas",
      parent: "raiz",
      mimeType: "application/vnd.google-apps.folder",
      bytes: new Uint8Array(),
    });
    const client = new DriveClient("token", { fetchImpl: drive.fetchImpl });

    const lista = await client.list("raiz");

    expect(lista).toEqual([
      expect.objectContaining({ id: "arq-1", name: "notas", mimeType: "application/vnd.google-apps.folder" }),
    ]);
    const url = new URL(drive.calls[0].url);
    expect(url.searchParams.get("fields")).toContain("mimeType");
    expect(url.searchParams.get("q")).toContain("'raiz' in parents");
  });

  it("acha um filho pelo nome dentro da pasta", async () => {
    const drive = fakeDriveStore();
    drive.arquivos.set("arq-1", {
      id: "arq-1",
      name: "manifest.json",
      parent: "pasta",
      mimeType: "application/json",
      bytes: new TextEncoder().encode("{}"),
    });
    const client = new DriveClient("token", { fetchImpl: drive.fetchImpl });

    const achado = await client.findChild("pasta", "manifest.json");
    expect(achado).toMatchObject({ id: "arq-1", name: "manifest.json" });

    const url = new URL(drive.calls[0].url);
    const consulta = url.searchParams.get("q") ?? "";
    expect(consulta).toContain("name = 'manifest.json'");
    expect(consulta).toContain("'pasta' in parents");
    expect(url.searchParams.get("fields")).toContain("mimeType");
  });

  it("findChild devolve undefined quando o nome nao existe", async () => {
    const drive = fakeDriveStore();
    const client = new DriveClient("token", { fetchImpl: drive.fetchImpl });
    expect(await client.findChild("pasta", "sumiu.json")).toBeUndefined();
  });

  it("cria pasta com os metadados no corpo", async () => {
    const drive = fakeDriveStore();
    const client = new DriveClient("token", { fetchImpl: drive.fetchImpl });

    const id = await client.ensureFolder("notes", "raiz");

    expect(drive.arquivos.get(id)).toMatchObject({
      name: "notes",
      parent: "raiz",
      mimeType: "application/vnd.google-apps.folder",
    });
  });

  it("envia arquivo novo em multipart e baixa de volta", async () => {
    const drive = fakeDriveStore();
    const client = new DriveClient("token", { fetchImpl: drive.fetchImpl });
    const bytes = new Uint8Array([7, 8, 9]);

    const criado = await client.put("raiz", "manifest.json", bytes);
    expect(drive.metodos).toEqual(["GET", "POST"]);

    const baixado = await client.download(criado.id);
    expect(Array.from(baixado)).toEqual([7, 8, 9]);
    const url = new URL(drive.calls.at(-1)!.url);
    expect(url.searchParams.get("alt")).toBe("media");
  });

  it("substitui o arquivo existente com PATCH, sem duplicar", async () => {
    const drive = fakeDriveStore();
    const client = new DriveClient("token", { fetchImpl: drive.fetchImpl });

    const primeiro = await client.put("raiz", "nota.md.enc", "primeira");
    const segundo = await client.put("raiz", "nota.md.enc", "segunda");

    expect(segundo.id).toBe(primeiro.id);
    expect([...drive.arquivos.values()]).toHaveLength(1);
    expect(new TextDecoder().decode(drive.arquivos.get(primeiro.id)!.bytes)).toBe("segunda");
    expect(drive.metodos).toContain("PATCH");
  });

  it("apaga com DELETE e aceita a resposta 204 sem corpo", async () => {
    const drive = fakeDriveStore();
    drive.arquivos.set("arq-1", {
      id: "arq-1",
      name: "nota.md.enc",
      parent: "raiz",
      mimeType: "application/octet-stream",
      bytes: new Uint8Array([1]),
    });
    const client = new DriveClient("token", { fetchImpl: drive.fetchImpl });

    await client.remove("arq-1");

    expect(drive.arquivos.size).toBe(0);
    expect(drive.calls.at(-1)!.init.method).toBe("DELETE");
  });

  it("erro no DELETE vira excecao com o status", async () => {
    const { fetchImpl } = fakeDrive([new Response("sem permissao", { status: 403 })]);
    const client = new DriveClient("token", { fetchImpl });
    await expect(client.remove("arq-1")).rejects.toThrow(/403/);
  });
});

describe("DriveClient com o fetch do navegador", () => {
  it("nao perde o vinculo com o global ao guardar o fetch", async () => {
    // `window.fetch` chamado fora do global lanca "called on an object that
    // does not implement interface Window"; aqui o stub imita esse WebIDL.
    const original = globalThis.fetch;
    const espiao = function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("'fetch' called on an object that does not implement interface Window");
      }
      return Promise.resolve(json({ files: [{ id: "raiz", name: "Dyarium" }] }));
    };
    globalThis.fetch = espiao as unknown as typeof fetch;
    try {
      const client = new DriveClient("token");
      await expect(client.ensureFolder("Dyarium", "raiz")).resolves.toBe("raiz");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("listagem paginada do Drive", () => {
  it("segue nextPageToken em vez de parar nas 100 primeiras", async () => {
    const paginas = [
      { files: Array.from({ length: 100 }, (_, i) => ({ id: `a${i}`, name: `a${i}` })), nextPageToken: "p2" },
      { files: Array.from({ length: 50 }, (_, i) => ({ id: `b${i}`, name: `b${i}` })) },
    ];
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return json(paginas.shift() ?? { files: [] });
    }) as unknown as typeof fetch;

    const client = new DriveClient("token", { fetchImpl });
    const arquivos = await client.list("pasta");

    expect(arquivos).toHaveLength(150);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("pageToken=p2");
  });

  it("findChild continua procurando na pagina seguinte", async () => {
    // O Drive so devolve o que casa com o `q`; a pagina vazia com token
    // acontece quando o filtro nao acha nada na primeira leva.
    const paginas = [
      { files: [], nextPageToken: "p2" },
      { files: [{ id: "alvo", name: "chave.txt" }] },
    ];
    const fetchImpl = vi.fn(async () => json(paginas.shift() ?? { files: [] })) as unknown as typeof fetch;
    const client = new DriveClient("token", { fetchImpl });

    await expect(client.findChild("pasta", "chave.txt")).resolves.toMatchObject({ id: "alvo" });
  });
});
