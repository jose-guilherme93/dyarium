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
    storeSetMany: async (store: string, entries: Array<[string, unknown]>) => {
      for (const [key, value] of entries) loja(store).set(key, value);
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

import type { FolderLike } from "./folder";

import { saveLocalAttachment } from "./attachments";
import { saveLocalCover } from "./covers";
import { createLocalNotebook } from "./notebooks";
import * as local from "./notes";
import { ensureVaultCode, vaultKeyFromCode } from "./vault";
import {
  MANIFEST_FILE,
  planVaultLayout,
  readVaultFile,
  readVaultManifest,
  slugify,
  writeVaultLayout,
  type LayoutPlan,
  type VaultFolderLike,
} from "./vaultLayout";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Abre o envelope `iv||ciphertext` do cofre, como o navegador le um `.enc`. */
async function decifrar(selado: Uint8Array, chave: CryptoKey): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: selado.slice(0, 12) },
    chave,
    selado.slice(12),
  );
  return new Uint8Array(plain);
}

beforeEach(async () => {
  idb.stores.clear();
  let seq = 0;
  URL.createObjectURL = vi.fn(() => `blob:local-${seq++}`);
  URL.revokeObjectURL = vi.fn();
  await registerNodeDatabase();
});

/** Pasta em memoria: Map de caminho -> bytes, com subpasta e remocao. */
function pastaEmMemoria(): VaultFolderLike & { arquivos: Map<string, Uint8Array> } {
  const arquivos = new Map<string, Uint8Array>();
  const pasta = (caminho: string): VaultFolderLike => {
    const completo = (nome: string): string => (caminho ? `${caminho}/${nome}` : nome);
    return {
      name: caminho.split("/").pop() || "cofre",
      async getFileHandle(nome, opcoes) {
        const chave = completo(nome);
        if (!opcoes?.create && !arquivos.has(chave)) throw new Error(`arquivo ausente: ${chave}`);
        return {
          async getFile() {
            const bytes = arquivos.get(chave);
            if (!bytes) throw new Error(`arquivo ausente: ${chave}`);
            const copia = bytes.slice();
            return {
              text: async () => decoder.decode(copia),
              arrayBuffer: async () => copia.buffer as ArrayBuffer,
            };
          },
          async createWritable() {
            let pendente: Uint8Array | null = null;
            return {
              async write(data) {
                pendente =
                  typeof data === "string"
                    ? encoder.encode(data)
                    : data instanceof Uint8Array
                      ? data
                      : new Uint8Array(data);
              },
              async close() {
                if (pendente) arquivos.set(chave, new Uint8Array(pendente));
              },
            };
          },
        };
      },
      async getDirectoryHandle(nome, opcoes) {
        const chave = completo(nome);
        if (
          !opcoes?.create &&
          ![...arquivos.keys()].some((caminho) => caminho.startsWith(`${chave}/`))
        ) {
          throw new Error(`pasta ausente: ${chave}`);
        }
        return pasta(chave);
      },
      async removeEntry(nome) {
        if (!arquivos.delete(completo(nome))) throw new Error(`arquivo ausente: ${completo(nome)}`);
      },
    };
  };
  return { arquivos, ...pasta("") };
}

async function novaNota(titulo: string, texto: string): Promise<string> {
  const entrada = await local.createEntry({ title: titulo });
  await local.saveNote(entrada.id, texto);
  return entrada.id;
}

const notas = (plano: LayoutPlan): string[] =>
  plano.manifest.files.filter((arquivo) => arquivo.kind === "note").map((arquivo) => arquivo.path);

describe("layout do cofre em pasta", () => {
  it("nota vira notes/<data>-<slug>.md.enc cifrado, listado no manifest", async () => {
    await novaNota("Compras da semana", "leite, cafe e pao");
    const plano = await planVaultLayout();

    const caminho = notas(plano)[0];
    expect(caminho).toBe(`notes/${new Date().toISOString().slice(0, 10)}-compras-da-semana.md.enc`);

    const write = plano.writes.find((w) => w.path === caminho);
    expect(write).toBeDefined();
    // `size` e o envelope fechado: iv (12) + ciphertext + tag (16).
    expect(write!.size).toBe(encoder.encode("leite, cafe e pao").length + 28);
    const chave = await vaultKeyFromCode(await ensureVaultCode());
    const selado = await write!.load();
    expect(selado).toHaveLength(write!.size);
    expect(decoder.decode(selado)).not.toContain("leite");
    expect(decoder.decode(await decifrar(selado, chave))).toBe("leite, cafe e pao");

    const entrada = plano.manifest.files.find((arquivo) => arquivo.path === caminho);
    expect(entrada?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plano.manifest.version).toBe(4);
    expect(plano.manifest.vault_id).toMatch(/^[0-9a-f]{10}$/);
    expect(JSON.stringify(plano.manifest)).not.toContain("leite");
  });

  it("plano repetido nao reescreve nada", async () => {
    await novaNota("Unica", "texto");
    const plano = await planVaultLayout();
    const deNovo = await planVaultLayout(plano.manifest);

    expect(deNovo.writes).toEqual([]);
    expect(deNovo.deletes).toEqual([]);
    expect(deNovo.unchanged).toBe(1);
  });

  it("editar a nota reescreve so o arquivo dela", async () => {
    const id = await novaNota("Diario", "primeira versao");
    await novaNota("Outra", "nao mexeu");
    const antes = await planVaultLayout();

    await local.saveNote(id, "segunda versao");
    const depois = await planVaultLayout(antes.manifest);

    expect(depois.writes.map((w) => w.path)).toEqual([
      `notes/${new Date().toISOString().slice(0, 10)}-diario.md.enc`,
    ]);
    expect(depois.deletes).toEqual([]);
    expect(depois.unchanged).toBe(1);
  });

  it("nota na lixeira sai com delete", async () => {
    const id = await novaNota("Vai embora", "texto");
    const antes = await planVaultLayout();
    const caminho = notas(antes)[0];

    await local.deleteEntry(id);
    const depois = await planVaultLayout(antes.manifest);

    expect(depois.deletes).toEqual([caminho]);
  });

  it("colisao de nota no mesmo dia resolve com -2", async () => {
    await novaNota("Mesmo nome", "primeira");
    await novaNota("Mesmo nome", "segunda");
    const plano = await planVaultLayout();
    const hoje = new Date().toISOString().slice(0, 10);

    expect(notas(plano).sort()).toEqual([
      `notes/${hoje}-mesmo-nome-2.md.enc`,
      `notes/${hoje}-mesmo-nome.md.enc`,
    ]);
  });

  it("livro com 2 capitulos ordena por chapter_position e livros homonimos ganham -2", async () => {
    const livro = await createLocalNotebook({ name: "A Torre", color: "", kind: "book" });
    await local.saveNote(
      (await local.createEntry({ title: "Chegada", notebookId: livro.id, kind: "chapter" })).id,
      "primeiro texto",
    );
    await local.saveNote(
      (await local.createEntry({ title: "Chegada", notebookId: livro.id, kind: "chapter" })).id,
      "segundo texto",
    );
    const outro = await createLocalNotebook({ name: "A Torre", color: "", kind: "book" });
    await local.saveNote(
      (await local.createEntry({ title: "Comeco", notebookId: outro.id, kind: "chapter" })).id,
      "texto do outro",
    );
    const plano = await planVaultLayout();

    const capitulos = plano.manifest.files
      .filter((arquivo) => arquivo.kind === "chapter")
      .map((arquivo) => arquivo.path);
    expect(capitulos.sort()).toEqual([
      "books/a-torre-2/001-comeco.md.enc",
      "books/a-torre/001-chegada.md.enc",
      "books/a-torre/002-chegada.md.enc",
    ]);
  });

  it("capitulo sem titulo vira sem-titulo", async () => {
    const livro = await createLocalNotebook({ name: "Sonhos", color: "", kind: "book" });
    const capitulo = await local.createEntry({
      title: "   ",
      notebookId: livro.id,
      kind: "chapter",
    });
    await local.saveNote(capitulo.id, "texto");
    const plano = await planVaultLayout();

    expect(
      plano.manifest.files
        .filter((arquivo) => arquivo.kind === "chapter")
        .map((arquivo) => arquivo.path),
    ).toEqual(["books/sonhos/001-sem-titulo.md.enc"]);
  });

  it("audio local vira attachments/<id>.<ext>.enc com entry_id e content_type", async () => {
    const id = await novaNota("Com voz", "transcricao aqui");
    const anexo = await saveLocalAttachment(
      id,
      new File([new Uint8Array([1, 2, 3, 4])], "voz.m4a", { type: "audio/mp4" }),
    );
    const plano = await planVaultLayout();

    const entrada = plano.manifest.files.find((arquivo) => arquivo.kind === "attachment");
    expect(entrada?.path).toBe(`attachments/${anexo.id}.m4a.enc`);
    expect(entrada?.entry_id).toBe(id);
    expect(entrada?.content_type).toBe("audio/mp4");
    const write = plano.writes.find((w) => w.path === entrada?.path);
    expect(write?.size).toBe(4 + 28);
    const chave = await vaultKeyFromCode(await ensureVaultCode());
    const selado = await write!.load();
    expect(decoder.decode(selado)).not.toContain("transcricao");
    expect([...(await decifrar(selado, chave))]).toEqual([1, 2, 3, 4]);
    // O sha do anexo novo nasce com o selo, quando o blob e lido de verdade.
    expect(entrada?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("manifest v3 anterior reescreve tudo para entrar entry_id e content_type", async () => {
    const id = await novaNota("Com voz", "texto");
    const anexo = await saveLocalAttachment(
      id,
      new File([new Uint8Array([1, 2, 3, 4])], "voz.aac", { type: "audio/aac" }),
    );
    const planoV4 = await planVaultLayout();
    const planoV3 = {
      ...planoV4.manifest,
      version: 3 as const,
      files: planoV4.manifest.files.map((arquivo) => ({
        path: arquivo.path,
        id: arquivo.id,
        kind: arquivo.kind,
        sha256: arquivo.sha256,
        size: arquivo.size,
        updated_at: arquivo.updated_at,
      })),
    };

    const novo = await planVaultLayout(planoV3);

    // O sha continuaria casando, mas a base v3 nao serve: sem reescrever, o
    // entry_id nunca entraria no manifest.
    expect(novo.unchanged).toBe(0);
    expect(novo.writes).toHaveLength(planoV4.manifest.files.length);
    const entrada = novo.manifest.files.find((arquivo) => arquivo.id === anexo.id);
    expect(entrada?.entry_id).toBe(id);
    expect(entrada?.content_type).toBe("audio/aac");
  });

  it("segundo plano com o manifest v4 nao le o blob nem reescreve o anexo", async () => {
    const id = await novaNota("Com voz", "texto");
    const audio = new File([new Uint8Array([1, 2, 3, 4])], "voz.aac", { type: "audio/aac" });
    const anexo = await saveLocalAttachment(id, audio);
    const pasta = pastaEmMemoria();
    await writeVaultLayout(pasta as unknown as FolderLike, await planVaultLayout());
    const manifest = await readVaultManifest(pasta);
    const ler = vi.spyOn(audio, "arrayBuffer");

    const deNovo = await planVaultLayout(manifest);

    // O caminho do anexo carrega o id e o conteudo nao muda: o sha do manifest
    // anterior basta, sem abrir o audio a cada sync.
    expect(ler).not.toHaveBeenCalled();
    expect(deNovo.writes).toEqual([]);
    expect(deNovo.unchanged).toBe(manifest!.files.length);
    const entrada = deNovo.manifest.files.find((arquivo) => arquivo.id === anexo.id);
    const anterior = manifest!.files.find((arquivo) => arquivo.id === anexo.id);
    expect(entrada?.sha256).toBe(anterior?.sha256);
    expect(entrada?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entrada?.entry_id).toBe(id);
  });

  it("anexo so com metadado (login rapido) fica no manifest sem write nem delete", async () => {
    const id = await novaNota("Com voz", "texto");
    const anexo = await saveLocalAttachment(
      id,
      new File([new Uint8Array([1, 2, 3])], "voz.aac", { type: "audio/aac" }),
    );
    const pasta = pastaEmMemoria();
    await writeVaultLayout(pasta as unknown as FolderLike, await planVaultLayout());
    const manifest = await readVaultManifest(pasta);
    const entrada = manifest!.files.find((arquivo) => arquivo.id === anexo.id)!;

    // Login rapido: o byte sai do IndexedDB e so o caminho do `.enc` fica.
    idb.loja("attachments").set(anexo.id, {
      id: anexo.id,
      entry_id: id,
      kind: "original",
      content_type: "audio/aac",
      size_bytes: 3,
      created_at: entrada.updated_at,
      vault_path: entrada.path,
    });

    const deNovo = await planVaultLayout(manifest);

    // Sem byte local nao ha o que selar, e o arquivo remoto nao pode sumir.
    expect(deNovo.writes).toEqual([]);
    expect(deNovo.deletes).toEqual([]);
    const preservada = deNovo.manifest.files.find((arquivo) => arquivo.id === anexo.id);
    expect(preservada).toMatchObject({
      path: entrada.path,
      entry_id: id,
      content_type: "audio/aac",
      sha256: entrada.sha256,
    });
  });

  it("capa so com metadado tambem continua no manifest depois do sync", async () => {
    const livro = await createLocalNotebook({ name: "Livro", color: "", kind: "book" });
    const capa = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" });
    await saveLocalCover(livro.id, capa);
    const pasta = pastaEmMemoria();
    await writeVaultLayout(pasta as unknown as FolderLike, await planVaultLayout());
    const manifest = await readVaultManifest(pasta);
    const entrada = manifest!.files.find((arquivo) => arquivo.kind === "cover")!;

    idb.loja("covers").set(livro.id, {
      book_id: livro.id,
      content_type: "image/jpeg",
      updated_at: entrada.updated_at,
      vault_path: entrada.path,
    });

    const deNovo = await planVaultLayout(manifest);

    expect(deNovo.writes).toEqual([]);
    expect(deNovo.deletes).toEqual([]);
    expect(deNovo.manifest.files.find((arquivo) => arquivo.kind === "cover")).toMatchObject({
      path: entrada.path,
      id: livro.id,
    });
  });

  it("capa trocada reescreve o arquivo dela no cofre", async () => {
    const livro = await createLocalNotebook({ name: "Livro", color: "", kind: "book" });
    await saveLocalCover(
      livro.id,
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])], "a.jpg", { type: "image/jpeg" }),
    );
    const pasta = pastaEmMemoria();
    await writeVaultLayout(pasta as unknown as FolderLike, await planVaultLayout());
    const manifest = await readVaultManifest(pasta);

    await saveLocalCover(
      livro.id,
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 2])], "b.jpg", { type: "image/jpeg" }),
    );
    const deNovo = await planVaultLayout(manifest);

    // A capa e mutavel: o sha muda e o arquivo precisa ser reescrito.
    const escritas = deNovo.writes.filter((write) => write.path.endsWith(".bin.enc"));
    expect(escritas).toHaveLength(1);
    expect(deNovo.deletes).toEqual([]);
  });

  it("plano com 2 anexos nao le os blobs; a escrita le um por vez", async () => {
    const id = await novaNota("Dois audios", "transcricao");
    const primeiro = new File([new Uint8Array([1, 2, 3])], "a.aac", { type: "audio/aac" });
    const segundo = new File([new Uint8Array([4, 5, 6])], "b.m4a", { type: "audio/mp4" });
    const anexoA = await saveLocalAttachment(id, primeiro);
    const anexoB = await saveLocalAttachment(id, segundo);
    const lerA = vi.spyOn(primeiro, "arrayBuffer");
    const lerB = vi.spyOn(segundo, "arrayBuffer");

    const plano = await planVaultLayout();
    expect(lerA).not.toHaveBeenCalled();
    expect(lerB).not.toHaveBeenCalled();
    // O tamanho sai do `blob.size`, que nao carrega o conteudo.
    expect(plano.writes.find((w) => w.path === `attachments/${anexoA.id}.aac.enc`)?.size).toBe(
      3 + 28,
    );
    expect(plano.writes.find((w) => w.path === `attachments/${anexoB.id}.m4a.enc`)?.size).toBe(
      3 + 28,
    );

    const pasta = pastaEmMemoria();
    await writeVaultLayout(pasta as unknown as FolderLike, plano);
    expect(lerA).toHaveBeenCalledTimes(1);
    expect(lerB).toHaveBeenCalledTimes(1);

    const manifest = await readVaultManifest(pasta);
    const entradaA = manifest?.files.find(
      (arquivo) => arquivo.path === `attachments/${anexoA.id}.aac.enc`,
    );
    expect(entradaA?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const chave = await vaultKeyFromCode(await ensureVaultCode());
    const voltou = await readVaultFile(pasta, `attachments/${anexoB.id}.m4a.enc`, chave);
    expect([...voltou]).toEqual([4, 5, 6]);
  });

  it("escreve na pasta, grava o manifest e le de volta o texto original", async () => {
    const texto = "diario secreto de hoje";
    await novaNota("Pagina unica", texto);
    const plano = await planVaultLayout();

    const pasta = pastaEmMemoria();
    await writeVaultLayout(pasta as unknown as FolderLike, plano);

    const manifest = await readVaultManifest(pasta);
    expect(manifest?.files).toHaveLength(1);
    expect(manifest?.files[0].path).toBe(plano.manifest.files[0].path);

    const chave = await vaultKeyFromCode(await ensureVaultCode());
    const bytes = await readVaultFile(pasta, plano.manifest.files[0].path, chave);
    expect(decoder.decode(bytes)).toBe(texto);

    // O byte na pasta nao abre o conteudo sem a chave.
    const cifrado = pasta.arquivos.get(plano.manifest.files[0].path)!;
    expect(decoder.decode(cifrado)).not.toContain(texto);
  });

  it("pasta sem manifest devolve null e manifest estranho e recusado", async () => {
    const pasta = pastaEmMemoria();
    expect(await readVaultManifest(pasta)).toBeNull();

    await writeVaultLayout(pasta as unknown as FolderLike, {
      manifest: {
        version: 99 as unknown as 4,
        vault_id: "x",
        updated_at: "agora",
        files: [],
      },
      writes: [],
      deletes: [],
      unchanged: 0,
    });
    await expect(readVaultManifest(pasta)).rejects.toThrow(/versao de manifest desconhecida/);
  });

  it("le manifest v3 antigo e v4 novo", async () => {
    const pasta = pastaEmMemoria();
    const v3 = {
      version: 3,
      vault_id: "cofre-antigo",
      updated_at: "2026-01-01T00:00:00.000Z",
      files: [
        {
          path: "attachments/att_1.aac.enc",
          id: "att_1",
          kind: "attachment",
          sha256: "0".repeat(64),
          size: 10,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    pasta.arquivos.set(MANIFEST_FILE, encoder.encode(JSON.stringify(v3)));

    const lido = await readVaultManifest(pasta);
    expect(lido?.version).toBe(3);
    expect(lido?.files[0].entry_id).toBeUndefined();
  });

  it("caminho com .. e recusado, para ler e para escrever", async () => {
    const pasta = pastaEmMemoria();
    const chave = await vaultKeyFromCode(await ensureVaultCode());

    for (const malicioso of ["../fuga.md.enc", "notes/../../etc/passwd", "/etc/passwd", "notes//lixo", "notes\\lixo.md.enc"]) {
      await expect(readVaultFile(pasta, malicioso, chave)).rejects.toThrow(/invalido/);
    }
    await expect(
      writeVaultLayout(pasta as unknown as FolderLike, {
        manifest: { version: 3, vault_id: "v", updated_at: "agora", files: [] },
        writes: [
          { path: "notes/../mal.md.enc", size: 16, load: async () => new Uint8Array(16) },
        ],
        deletes: [],
        unchanged: 0,
      }),
    ).rejects.toThrow(/invalido/);
    await expect(
      writeVaultLayout(pasta as unknown as FolderLike, {
        manifest: { version: 3, vault_id: "v", updated_at: "agora", files: [] },
        writes: [],
        deletes: ["/absoluto.md.enc"],
        unchanged: 0,
      }),
    ).rejects.toThrow(/invalido/);
  });

  it("ciphertext mexido nao abre e chave errada nao decifra", async () => {
    const texto = "integridade em prova";
    await novaNota("Selo", texto);
    const plano = await planVaultLayout();
    const pasta = pastaEmMemoria();
    await writeVaultLayout(pasta as unknown as FolderLike, plano);

    const chave = await vaultKeyFromCode(await ensureVaultCode());
    const caminho = plano.manifest.files[0].path;

    const mexido = pasta.arquivos.get(caminho)!;
    mexido[mexido.length - 1] ^= 0xff;
    await expect(readVaultFile(pasta, caminho, chave)).rejects.toThrow();

    const outra = await vaultKeyFromCode(await (await import("./vault")).newRecoveryCode());
    await expect(readVaultFile(pasta, caminho, outra)).rejects.toThrow();
  });

  it("slugify cobre acento, maiuscula, pontuacao e limite de 60", () => {
    expect(slugify("Árvores & Cães")).toBe("arvores-caes");
    expect(slugify("GÊNERO E DRAMA")).toBe("genero-e-drama");
    expect(slugify("Olá, mundo!")).toBe("ola-mundo");
    expect(slugify("!!!")).toBe("");
    expect(slugify("a".repeat(80))).toHaveLength(60);
    expect(slugify("título-com-muitos-caracteres-".repeat(3)).endsWith("-")).toBe(false);
  });
});
