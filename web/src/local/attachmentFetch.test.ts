import { beforeEach, describe, expect, it, vi } from "vitest";

// O anexo sob demanda fala com o IndexedDB (metadado e byte) e com o Drive
// (manifest e `.enc`). Aqui o store e um Map em memoria e o Drive e uma pasta
// em memoria; nenhuma chamada sai para a rede.
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
    ATTACHMENTS_STORE: "attachments",
    COVERS_STORE: "covers",
    storeGet: async <T>(store: string, key: string) => loja(store).get(key) as T | undefined,
    storeSet: async (store: string, key: string, value: unknown) => {
      loja(store).set(key, value);
    },
    storeSetMany: async (store: string, entries: Array<[string, unknown]>) => {
      for (const [chave, valor] of entries) loja(store).set(chave, valor);
    },
    storeDelete: async (store: string, key: string) => {
      loja(store).delete(key);
    },
    storeList: async <T>(store: string): Promise<Array<[string, T]>> =>
      [...loja(store).entries()] as Array<[string, T]>,
  };
});

vi.mock("../lib/idb", () => idb);

// A sessao do Drive e a marca local: o teste controla se o cofre esta
// disponivel e qual pasta responde.
const drive = vi.hoisted(() => ({
  state: "connected" as "off" | "connected" | "expired",
  marked: true,
  root: null as unknown,
}));

vi.mock("./driveSession", () => ({
  driveSessionState: () => drive.state,
  driveVaultRoot: async () => drive.root,
  onDriveSessionChange: () => () => undefined,
}));

vi.mock("./driveMark", () => ({
  driveMarked: () => drive.marked,
}));

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import { ensureVaultCode, vaultKeyFromCode } from "./vault";
import {
  MANIFEST_FILE,
  planVaultLayout,
  writeVaultLayout,
  type VaultFolderLike,
} from "./vaultLayout";
import { saveLocalAttachment, type StoredAttachment } from "./attachments";
import * as local from "./notes";
import {
  attachmentFetchState,
  ensureAttachment,
  resetAttachmentFetch,
  retryAttachment,
} from "./attachmentFetch";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Pasta em memoria: Map de caminho -> bytes, com subpasta e remocao. */
function pastaEmMemoria(): VaultFolderLike & {
  arquivos: Map<string, Uint8Array>;
  leituras: string[];
} {
  const arquivos = new Map<string, Uint8Array>();
  const leituras: string[] = [];
  const pasta = (caminho: string): VaultFolderLike => {
    const completo = (nome: string): string => (caminho ? `${caminho}/${nome}` : nome);
    return {
      name: caminho.split("/").pop() || "cofre",
      async getFileHandle(nome, opcoes) {
        const chave = completo(nome);
        if (!opcoes?.create) {
          leituras.push(chave);
          if (!arquivos.has(chave)) throw new Error(`arquivo ausente: ${chave}`);
        }
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
                    ? new TextEncoder().encode(data)
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
      async getDirectoryHandle(nome) {
        return pasta(completo(nome));
      },
    };
  };
  return { arquivos, leituras, ...pasta("") };
}

async function novaNota(titulo: string): Promise<string> {
  const entrada = await local.createEntry({ title: titulo, recordedAt: "2026-11-18" });
  await local.saveNote(entrada.id, titulo);
  return entrada.id;
}

interface CofreDeTeste {
  pasta: VaultFolderLike & { arquivos: Map<string, Uint8Array>; leituras: string[] };
  notas: string[];
  anexos: string[];
}

/**
 * Monta um cofre completo e apaga os bytes do IndexedDB, como depois de um
 * login rapido: so o metadado de cada anexo fica, com o caminho do `.enc`.
 */
async function cofreComAnexos(bytes: number[][]): Promise<CofreDeTeste> {
  const notas: string[] = [];
  const anexos: string[] = [];
  for (const [indice, conteudo] of bytes.entries()) {
    const nota = await novaNota(`Nota ${indice}`);
    notas.push(nota);
    const anexo = await saveLocalAttachment(
      nota,
      new File([new Uint8Array(conteudo)], `voz-${indice}.aac`, { type: "audio/aac" }),
    );
    anexos.push(anexo.id);
  }
  const pasta = pastaEmMemoria();
  const plano = await planVaultLayout();
  await writeVaultLayout(pasta as unknown as VaultFolderLike, plano);

  // Login rapido: o byte sai, o metadado e o caminho ficam.
  for (const [indice, id] of anexos.entries()) {
    const entrada = plano.manifest.files.find((arquivo) => arquivo.id === id);
    idb.loja("attachments").set(id, {
      id,
      entry_id: notas[indice],
      kind: "original",
      content_type: "audio/aac",
      size_bytes: bytes[indice].length,
      created_at: entrada?.updated_at ?? "2026-11-18T10:00:00.000Z",
      vault_path: entrada?.path,
    } satisfies StoredAttachment);
  }
  return { pasta, notas, anexos };
}

beforeEach(async () => {
  idb.stores.clear();
  localStorage.clear();
  drive.state = "connected";
  drive.marked = true;
  drive.root = null;
  resetAttachmentFetch();
  await registerNodeDatabase();
});

describe("anexo sob demanda", () => {
  it("abrir a nota baixa so o anexo dela e guarda o byte no IndexedDB", async () => {
    const cofre = await cofreComAnexos([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    drive.root = cofre.pasta;
    const [primeiro, segundo] = cofre.anexos;

    await ensureAttachment(primeiro);

    const guardado = idb.loja("attachments").get(primeiro) as StoredAttachment;
    expect(guardado.blob).toBeInstanceOf(Blob);
    expect([...new Uint8Array(await guardado.blob!.arrayBuffer())]).toEqual([1, 2, 3]);
    // O outro anexo continua so com metadado: nada de baixar o cofre inteiro.
    const outro = idb.loja("attachments").get(segundo) as StoredAttachment;
    expect(outro.blob).toBeUndefined();
    const baixados = cofre.pasta.leituras.filter((caminho) =>
      caminho.startsWith("attachments/"),
    );
    expect(baixados).toHaveLength(1);
    expect(attachmentFetchState(primeiro).status).toBe("idle");
  });

  it("a segunda chamada nao le o arquivo de novo", async () => {
    const cofre = await cofreComAnexos([[7, 8, 9]]);
    drive.root = cofre.pasta;
    const [id] = cofre.anexos;

    await ensureAttachment(id);
    const antes = cofre.pasta.leituras.filter((caminho) => caminho.startsWith("attachments/")).length;
    await ensureAttachment(id);

    expect(
      cofre.pasta.leituras.filter((caminho) => caminho.startsWith("attachments/")).length,
    ).toBe(antes);
  });

  it("anexo corrompido falha isolado, sem lancar e sem derrubar os outros", async () => {
    const cofre = await cofreComAnexos([
      [1, 1, 1],
      [2, 2, 2],
    ]);
    drive.root = cofre.pasta;
    const [ruim, bom] = cofre.anexos;
    const caminho = (idb.loja("attachments").get(ruim) as StoredAttachment).vault_path!;
    cofre.pasta.arquivos.set(caminho, new Uint8Array([9]));

    await expect(ensureAttachment(ruim)).resolves.toBeUndefined();
    expect(attachmentFetchState(ruim)).toMatchObject({ status: "error" });
    expect((idb.loja("attachments").get(ruim) as StoredAttachment).blob).toBeUndefined();

    // A falha de um nao contamina o vizinho.
    await ensureAttachment(bom);
    expect((idb.loja("attachments").get(bom) as StoredAttachment).blob).toBeInstanceOf(Blob);
  });

  it("sem sessao do Drive o metadado fica esperando, com motivo em uma linha", async () => {
    const cofre = await cofreComAnexos([[3, 3, 3]]);
    drive.root = cofre.pasta;
    drive.state = "off";
    const [id] = cofre.anexos;

    await ensureAttachment(id);

    expect(attachmentFetchState(id).status).toBe("error");
    expect(attachmentFetchState(id).reason).toMatch(/sessão/i);
    expect((idb.loja("attachments").get(id) as StoredAttachment).blob).toBeUndefined();
  });

  it("tentar de novo depois da falha baixa o anexo", async () => {
    const cofre = await cofreComAnexos([[5, 5, 5]]);
    drive.root = cofre.pasta;
    drive.state = "off";
    const [id] = cofre.anexos;
    await ensureAttachment(id);
    expect(attachmentFetchState(id).status).toBe("error");

    drive.state = "connected";
    resetAttachmentFetch();
    await retryAttachment(id);

    expect(attachmentFetchState(id).status).toBe("idle");
    expect((idb.loja("attachments").get(id) as StoredAttachment).blob).toBeInstanceOf(Blob);
  });

  it("manifest com caminho fora do cofre nao le nada e falha isolado", async () => {
    const cofre = await cofreComAnexos([[1]]);
    drive.root = cofre.pasta;
    const manifest = JSON.parse(
      decoder.decode(cofre.pasta.arquivos.get(MANIFEST_FILE)!),
    ) as { files: Array<{ path: string; kind: string }> };
    const anexo = manifest.files.find((arquivo) => arquivo.kind === "attachment");
    anexo!.path = "attachments/../../segredo.enc";
    cofre.pasta.arquivos.set(MANIFEST_FILE, encoder.encode(JSON.stringify(manifest)));
    const [id] = cofre.anexos;

    await expect(ensureAttachment(id)).resolves.toBeUndefined();

    expect(attachmentFetchState(id).status).toBe("error");
    expect(cofre.pasta.leituras.filter((caminho) => caminho.startsWith("attachments/"))).toEqual(
      [],
    );
    expect((idb.loja("attachments").get(id) as StoredAttachment).blob).toBeUndefined();
  });

  it("a chave do cofre e a mesma do retrato: o byte volta decifrado", async () => {
    const cofre = await cofreComAnexos([[10, 20, 30]]);
    drive.root = cofre.pasta;
    const [id] = cofre.anexos;
    const chave = await vaultKeyFromCode(await ensureVaultCode());
    expect(chave).toBeInstanceOf(CryptoKey);

    await ensureAttachment(id);

    const guardado = idb.loja("attachments").get(id) as StoredAttachment;
    expect([...new Uint8Array(await guardado.blob!.arrayBuffer())]).toEqual([10, 20, 30]);
  });
});
