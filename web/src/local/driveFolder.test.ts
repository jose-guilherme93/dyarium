import { beforeEach, describe, expect, it, vi } from "vitest";

// O cofre local fala com o IndexedDB (codigo do cofre, anexos e capas): aqui o
// store e um Map em memoria, igual ao que o navegador teria.
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
    loja,
    STORE: "http",
    ANALYSIS_STORE: "analysis",
    DRAFTS_STORE: "drafts",
    CONFLICT_BACKUPS_STORE: "conflictBackups",
    VAULT_STORE: "vault",
    ATTACHMENTS_STORE: "attachments",
    COVERS_STORE: "covers",
    STORE_SETTINGS: "settings",
    cacheGet: async () => undefined,
    cacheSet: async () => undefined,
    cacheClear: async () => undefined,
    storeGet: async <T>(store: string, key: string) => loja(store).get(key) as T | undefined,
    storeSet: async (store: string, key: string, value: unknown) => {
      loja(store).set(key, value);
    },
    storeDelete: async (store: string, key: string) => {
      loja(store).delete(key);
    },
    storeList: async <T>(store: string): Promise<Array<[string, T]>> =>
      [...loja(store).entries()] as Array<[string, T]>,
  };
});

vi.mock("../lib/idb", () => idb);

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import * as local from "./notes";
import { ensureVaultCode, vaultKeyFromCode } from "./vault";
import { readVaultFile, readVaultManifest, planVaultLayout, writeVaultLayout } from "./vaultLayout";
import { DriveClient } from "./drive";
import { DriveFolder } from "./driveFolder";

const decoder = new TextDecoder();
const FOLDER_MIME = "application/vnd.google-apps.folder";

interface Call {
  url: string;
  init: RequestInit;
}

interface ArquivoNoFake {
  id: string;
  name: string;
  parent: string;
  mimeType: string;
  bytes: Uint8Array;
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

/**
 * Drive de mentira com um Map no lugar do servidor: listagem por `q=` (nome e
 * pasta pai), criacao de pasta, upload multipart, download e DELETE. Nenhuma
 * requisicao sai para a rede.
 */
function fakeDrive() {
  const arquivos = new Map<string, ArquivoNoFake>();
  const calls: Call[] = [];
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

    if (url.pathname.endsWith("/files") && metodo === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const nome = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'");
      const pai = /'([^']+)' in parents/.exec(q)?.[1];
      const lista = [...arquivos.values()].filter(
        (arquivo) => (!nome || arquivo.name === nome) && (!pai || arquivo.parent === pai),
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

  return { arquivos, calls, fetchImpl };
}

function cofreNoDrive() {
  const drive = fakeDrive();
  const client = new DriveClient("token", { fetchImpl: drive.fetchImpl });
  return { drive, client, raiz: new DriveFolder(client, "raiz", "Dyarium") };
}

beforeEach(async () => {
  idb.stores.clear();
  await registerNodeDatabase();
});

describe("pasta do cofre no Drive", () => {
  it("grava notes/<data>-<slug>.md.enc, le o manifest e decifra o texto", async () => {
    const { drive, raiz } = cofreNoDrive();
    const texto = "diario guardado no drive";
    const entrada = await local.createEntry({ title: "x", recordedAt: "2026-11-18" });
    await local.saveNote(entrada.id, texto);

    const plano = await planVaultLayout();
    expect(plano.writes.map((write) => write.path)).toContain("notes/2026-11-18-x.md.enc");
    await writeVaultLayout(raiz, plano);

    const manifest = await readVaultManifest(raiz);
    expect(manifest?.files.map((arquivo) => arquivo.path)).toEqual(["notes/2026-11-18-x.md.enc"]);

    const chave = await vaultKeyFromCode(await ensureVaultCode());
    const bytes = await readVaultFile(raiz, "notes/2026-11-18-x.md.enc", chave);
    expect(decoder.decode(bytes)).toBe(texto);

    // No Drive o byte gravado e o cifrado, nao o texto.
    const gravado = [...drive.arquivos.values()].find(
      (arquivo) => arquivo.name === "2026-11-18-x.md.enc",
    );
    expect(decoder.decode(gravado!.bytes)).not.toContain(texto);
  });

  it("plano repetido sobre o Drive nao reescreve nada", async () => {
    const { raiz } = cofreNoDrive();
    const entrada = await local.createEntry({ title: "unica", recordedAt: "2026-11-18" });
    await local.saveNote(entrada.id, "texto");
    const primeiro = await planVaultLayout();
    await writeVaultLayout(raiz, primeiro);

    const manifest = await readVaultManifest(raiz);
    const segundo = await planVaultLayout(manifest);

    expect(segundo.writes).toEqual([]);
    expect(segundo.deletes).toEqual([]);
    expect(segundo.unchanged).toBe(1);
  });

  it("subpasta ausente sem create lanca erro de pasta ausente", async () => {
    const { raiz } = cofreNoDrive();
    await expect(raiz.getDirectoryHandle("nao-existe")).rejects.toThrow(
      /pasta ausente no Drive: nao-existe/,
    );
  });

  it("arquivo ausente sem create lanca erro de arquivo ausente", async () => {
    const { raiz } = cofreNoDrive();
    await expect(raiz.getFileHandle("sumiu.enc")).rejects.toThrow(
      /arquivo ausente no Drive: sumiu\.enc/,
    );
  });

  it("escrever duas vezes no mesmo nome substitui em vez de duplicar", async () => {
    const { drive, raiz } = cofreNoDrive();
    const plano = await planVaultLayout();
    const escrever = (bytes: Uint8Array) =>
      writeVaultLayout(raiz, {
        manifest: plano.manifest,
        writes: [{ path: "notes/mesma.md.enc", size: bytes.length, load: async () => bytes }],
        deletes: [],
        unchanged: 0,
      });

    await escrever(new Uint8Array([1, 2]));
    await escrever(new Uint8Array([3, 4, 5]));

    const iguais = [...drive.arquivos.values()].filter(
      (arquivo) => arquivo.name === "mesma.md.enc",
    );
    expect(iguais).toHaveLength(1);
    expect(Array.from(iguais[0].bytes)).toEqual([3, 4, 5]);
    expect(drive.calls.at(-1)!.init.method).toBe("PATCH");
  });

  it("getFileHandle nao baixa o arquivo antes de getFile", async () => {
    const { drive, raiz } = cofreNoDrive();
    drive.arquivos.set("arq-1", {
      id: "arq-1",
      name: "manifest.json",
      parent: "raiz",
      mimeType: "application/json",
      bytes: new TextEncoder().encode('{"version":3}'),
    });

    const handle = await raiz.getFileHandle("manifest.json");
    const downloads = () =>
      drive.calls.filter((call) => new URL(call.url).searchParams.get("alt") === "media");
    expect(downloads()).toHaveLength(0);

    expect(await (await handle.getFile()).text()).toBe('{"version":3}');
    expect(downloads()).toHaveLength(1);
  });

  it("removeEntry apaga um arquivo do Drive", async () => {
    const { drive, raiz } = cofreNoDrive();
    drive.arquivos.set("arq-1", {
      id: "arq-1",
      name: "velha.md.enc",
      parent: "raiz",
      mimeType: "application/octet-stream",
      bytes: new Uint8Array([9]),
    });

    await raiz.removeEntry("velha.md.enc");

    expect(drive.arquivos.size).toBe(0);
    await expect(raiz.getFileHandle("velha.md.enc")).rejects.toThrow(/arquivo ausente/);
  });

  it("removeEntry de pasta apaga os filhos antes da pasta", async () => {
    const { drive, raiz } = cofreNoDrive();
    const entrada = await local.createEntry({ title: "vai sumir", recordedAt: "2026-11-18" });
    await local.saveNote(entrada.id, "texto");
    await writeVaultLayout(raiz, await planVaultLayout());
    expect([...drive.arquivos.values()].some((arquivo) => arquivo.mimeType === FOLDER_MIME)).toBe(
      true,
    );

    await raiz.removeEntry("notes", { recursive: true });

    expect([...drive.arquivos.values()].map((arquivo) => arquivo.name)).toEqual(["manifest.json"]);
    await expect(raiz.getDirectoryHandle("notes")).rejects.toThrow(/pasta ausente/);
  });

  it("removeEntry de nome ausente nao e erro", async () => {
    const { raiz } = cofreNoDrive();
    await expect(raiz.removeEntry("nunca-existiu.enc")).resolves.toBeUndefined();
  });

  it("getDirectoryHandle reaproveita a instancia e lista a pasta uma vez", async () => {
    const { drive, raiz } = cofreNoDrive();
    drive.arquivos.set("pasta-notes", {
      id: "pasta-notes",
      name: "notes",
      parent: "raiz",
      mimeType: FOLDER_MIME,
      bytes: new Uint8Array(),
    });
    drive.arquivos.set("arq-a", {
      id: "arq-a",
      name: "a.md.enc",
      parent: "pasta-notes",
      mimeType: "application/octet-stream",
      bytes: new Uint8Array([1]),
    });

    const primeira = await raiz.getDirectoryHandle("notes");
    const segunda = await raiz.getDirectoryHandle("notes");

    expect(segunda).toBe(primeira);
    await primeira.getFileHandle("a.md.enc");
    await segunda.getFileHandle("a.md.enc");

    const listagensDaSubpasta = drive.calls.filter((call) => {
      const url = new URL(call.url);
      return (
        url.pathname.endsWith("/files") &&
        (call.init.method ?? "GET").toUpperCase() === "GET" &&
        (url.searchParams.get("q") ?? "").includes("'pasta-notes' in parents")
      );
    });
    expect(listagensDaSubpasta).toHaveLength(1);
  });

  it("nao compartilha pasta entre clientes diferentes", async () => {
    const { drive, raiz } = cofreNoDrive();
    drive.arquivos.set("pasta-notes", {
      id: "pasta-notes",
      name: "notes",
      parent: "raiz",
      mimeType: FOLDER_MIME,
      bytes: new Uint8Array(),
    });
    const outraRaiz = new DriveFolder(
      new DriveClient("outro-token", { fetchImpl: drive.fetchImpl }),
      "raiz",
      "Dyarium",
    );

    const primeira = await raiz.getDirectoryHandle("notes");
    const segunda = await outraRaiz.getDirectoryHandle("notes");

    // Token vencido troca de client: o cache nao pode atravessar a sessao.
    expect(segunda).not.toBe(primeira);
  });
});

describe("escrita de arquivo ja conhecido", () => {
  it("vai por PATCH sem busca previa quando a pasta ja tem o id", async () => {
    const chamadas: string[] = [];
    const resposta = (corpo: unknown) =>
      new Response(JSON.stringify(corpo), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/drive/v3/files") {
        chamadas.push("list");
        return resposta({
          files: [{ id: "arq-1", name: "nota.md.enc", mimeType: "application/octet-stream" }],
        });
      }
      if (url.pathname.startsWith("/upload/drive/v3/files")) {
        chamadas.push(`upload:${url.pathname}`);
        return resposta({ id: "arq-1", name: "nota.md.enc" });
      }
      chamadas.push(`outro:${url.pathname}`);
      return resposta({});
    }) as unknown as typeof fetch;

    const client = new (await import("./drive")).DriveClient("token", { fetchImpl });
    const pasta = new DriveFolder(client, "pasta", "notes");
    const handle = await pasta.getFileHandle("nota.md.enc", { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Uint8Array([1, 2, 3]));
    await writable.close();

    // Uma listagem da pasta (cache) e um PATCH no arquivo conhecido.
    expect(chamadas).toEqual(["list", "upload:/upload/drive/v3/files/arq-1"]);
  });
});
