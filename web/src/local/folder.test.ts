import { describe, expect, it } from "vitest";

import { readVaultFromFolder, writeVaultToFolder, type FolderLike } from "./folder";
import { newRecoveryCode } from "./vault";

/** Pasta em memoria: mesmos arquivos, sem navegador. */
function memoryFolder(inicial: Record<string, string | Uint8Array> = {}): FolderLike & {
  files: Map<string, Uint8Array>;
} {
  const files = new Map<string, Uint8Array>();
  for (const [nome, conteudo] of Object.entries(inicial)) {
    files.set(nome, typeof conteudo === "string" ? new TextEncoder().encode(conteudo) : conteudo);
  }
  return {
    name: "memoria",
    files,
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (!files.has(name)) {
        if (!options?.create) throw new Error(`arquivo nao encontrado: ${name}`);
        files.set(name, new Uint8Array());
      }
      const dados = () => files.get(name) ?? new Uint8Array();
      return {
        getFile: async () => {
          const bytes = dados();
          return {
            text: async () => new TextDecoder().decode(bytes),
            arrayBuffer: async () =>
              bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          };
        },
        createWritable: async () => ({
          write: async (data: string | Uint8Array | ArrayBuffer) => {
            const bytes =
              typeof data === "string"
                ? new TextEncoder().encode(data)
                : data instanceof Uint8Array
                  ? data
                  : new Uint8Array(data);
            files.set(name, new Uint8Array(bytes));
          },
          close: async () => undefined,
        }),
      };
    },
  };
}

describe("backup em pasta", () => {
  it("grava a chave e o envelope lado a lado", async () => {
    const folder = memoryFolder();
    const code = await newRecoveryCode();
    await writeVaultToFolder(folder, code, new Uint8Array([1, 2, 3]));

    expect([...folder.files.keys()].sort()).toEqual(["backup.enc", "key.txt"]);
    expect(new TextDecoder().decode(folder.files.get("key.txt"))).toBe(code);
    expect(Array.from(folder.files.get("backup.enc") ?? [])).toEqual([1, 2, 3]);
  });

  it("le de volta o codigo e o envelope", async () => {
    const folder = memoryFolder();
    const code = await newRecoveryCode();
    await writeVaultToFolder(folder, code, new Uint8Array([9, 9]));
    expect(await readVaultFromFolder(folder)).toEqual({ code, sealed: new Uint8Array([9, 9]) });
  });

  it("grava e le o state.enc ao lado da chave e do backup", async () => {
    const folder = memoryFolder();
    const code = await newRecoveryCode();
    await writeVaultToFolder(folder, code, new Uint8Array([1, 2]), new Uint8Array([7, 8, 9]));

    expect([...folder.files.keys()].sort()).toEqual(["backup.enc", "key.txt", "state.enc"]);
    expect(await readVaultFromFolder(folder)).toEqual({
      code,
      sealed: new Uint8Array([1, 2]),
      state: new Uint8Array([7, 8, 9]),
    });
  });

  it("pasta antiga sem state.enc continua abrindo so com key e backup", async () => {
    const folder = memoryFolder();
    const code = await newRecoveryCode();
    await writeVaultToFolder(folder, code, new Uint8Array([3, 4]));

    const lido = await readVaultFromFolder(folder);
    expect(lido).toEqual({ code, sealed: new Uint8Array([3, 4]) });
    expect(lido.state).toBeUndefined();
  });

  it("recusa pasta com chave invalida", async () => {
    const folder = memoryFolder({ "key.txt": "isso-nao-e-codigo", "backup.enc": "x" });
    await expect(readVaultFromFolder(folder)).rejects.toThrow(/codigo valido/);
  });

  it("recusa pasta sem o envelope", async () => {
    const folder = memoryFolder({ "key.txt": await newRecoveryCode() });
    await expect(readVaultFromFolder(folder)).rejects.toThrow(/nao encontrado/);
  });

  it("recusa envelope vazio", async () => {
    const folder = memoryFolder({ "key.txt": await newRecoveryCode(), "backup.enc": "" });
    await expect(readVaultFromFolder(folder)).rejects.toThrow(/vazio/);
  });
});
