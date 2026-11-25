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

import { getDb } from "../../../mobile/src/core/port";
import { getRecording, upsertRecording } from "../../../mobile/src/core/repo";

import { readLocalAnalysis, saveAnalysisSnapshot } from "./analyze";
import { createLocalNotebook, getLocalNotebook } from "./notebooks";
import { loadLocalSettings, saveLocalSettings } from "./settings";
import {
  formatRecoveryCode,
  newRecoveryCode,
  normalizeRecoveryCode,
  ensureVaultCode,
  vaultKeyFromCode,
} from "./vault";
import {
  buildNotesSnapshot,
  buildSnapshot,
  openSnapshot,
  sealSnapshot,
  vaultIdFromCode,
  type VaultSnapshot,
} from "./backup";
import { BACKUP_FILE, KEY_FILE, STATE_FILE, type FolderLike } from "./folder";
import * as local from "./notes";
import {
  MANIFEST_FILE,
  planVaultLayout,
  writeVaultLayout,
  type VaultFolderLike,
  type VaultManifest,
} from "./vaultLayout";
import { saveLocalAttachment, type StoredAttachment } from "./attachments";
import type { Analysis, Notebook } from "../types";
import {
  driveVaultExists,
  openDriveVault,
  restoreAttachmentsFromVault,
  restoreVaultFromDrive,
  syncVaultToDrive,
  vaultSummary,
} from "./vaultCloud";
import { runVaultSync } from "./folderSync";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

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
  const entrada = await local.createEntry({ title: titulo, recordedAt: "2026-11-18" });
  await local.saveNote(entrada.id, texto);
  return entrada.id;
}

/** Caderno minimo do retrato, com o id e a data que o teste controla. */
function cadernoDoRetrato(id: string, name: string, updatedAt: string): Notebook {
  return {
    id,
    name,
    color: "",
    is_default: false,
    kind: "notes",
    subtitle: "",
    author: "",
    synopsis: "",
    language: "",
    goal_words: 0,
    book_status: "drafting",
    entry_count: 0,
    chapter_count: 0,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

/** Escreve o layout e os arquivos de chave/retrato que o restore procura. */
async function escreverCofreCompleto(
  pasta: VaultFolderLike & { arquivos: Map<string, Uint8Array> },
): Promise<void> {
  const plano = await planVaultLayout();
  await writeVaultLayout(pasta as unknown as FolderLike, plano);
  const codigo = await ensureVaultCode();
  const chave = await vaultKeyFromCode(codigo);
  const vaultId = await vaultIdFromCode(codigo);
  pasta.arquivos.set(KEY_FILE, encoder.encode(formatRecoveryCode(codigo)));
  pasta.arquivos.set(BACKUP_FILE, await sealSnapshot(await buildNotesSnapshot(vaultId), chave));
  pasta.arquivos.set(STATE_FILE, await sealSnapshot(await buildSnapshot(vaultId), chave));
}

beforeEach(async () => {
  idb.stores.clear();
  localStorage.clear();
  let seq = 0;
  URL.createObjectURL = vi.fn(() => `blob:local-${seq++}`);
  URL.revokeObjectURL = vi.fn();
  await registerNodeDatabase();
});

describe("cofre no Google Drive", () => {
  it("sync grava key.txt, backup.enc (v1), state.enc (v2) e o manifest do cofre", async () => {
    const pasta = pastaEmMemoria();
    await novaNota("no drive", "texto que sobe cifrado");

    const resultado = await syncVaultToDrive(pasta);

    expect(resultado).toMatchObject({ written: 1 });
    expect(await driveVaultExists(pasta)).toBe(true);
    expect(pasta.arquivos.has(MANIFEST_FILE)).toBe(true);
    const codigo = normalizeRecoveryCode(decoder.decode(pasta.arquivos.get(KEY_FILE)!));
    expect(codigo).toBe(await ensureVaultCode());
    expect(decoder.decode(pasta.arquivos.get(KEY_FILE)!).includes("-")).toBe(true);
    expect(pasta.arquivos.has(BACKUP_FILE)).toBe(true);
    expect(pasta.arquivos.has(STATE_FILE)).toBe(true);
    // A nota sobe cifrada: o texto em claro nao aparece em nenhum arquivo.
    for (const bytes of pasta.arquivos.values()) {
      expect(decoder.decode(bytes)).not.toContain("texto que sobe cifrado");
    }
    const chave = await vaultKeyFromCode(codigo);
    const compartilhado = await openSnapshot(pasta.arquivos.get(BACKUP_FILE)!, chave);
    expect(compartilhado.version).toBe(1);
    expect(compartilhado.notes[0]).not.toHaveProperty("transcript");
    expect(compartilhado).not.toHaveProperty("notebooks");
    const estado = await openSnapshot(pasta.arquivos.get(STATE_FILE)!, chave);
    expect(estado.version).toBe(2);
    const manifest = JSON.parse(decoder.decode(pasta.arquivos.get(MANIFEST_FILE)!)) as {
      version: number;
      files: { path: string }[];
    };
    expect(manifest.version).toBe(4);
    expect(manifest.files.map((arquivo) => arquivo.path)).toEqual(["notes/2026-11-18-no-drive.md.enc"]);
  });

  it("segundo sync sem mudanca nao reescreve key.txt nem os retratos", async () => {
    const pasta = pastaEmMemoria();
    await novaNota("estavel", "sem mudanca");
    await syncVaultToDrive(pasta);
    const chaveAntes = pasta.arquivos.get(KEY_FILE);
    const backupAntes = pasta.arquivos.get(BACKUP_FILE);
    const stateAntes = pasta.arquivos.get(STATE_FILE);

    const resultado = await syncVaultToDrive(pasta);

    expect(resultado).toMatchObject({ written: 0 });
    expect(pasta.arquivos.get(KEY_FILE)).toBe(chaveAntes);
    expect(pasta.arquivos.get(BACKUP_FILE)).toBe(backupAntes);
    expect(pasta.arquivos.get(STATE_FILE)).toBe(stateAntes);
  });

  it("restore adota o codigo do key.txt e aplica o retrato do Drive", async () => {
    const pasta = pastaEmMemoria();
    const codigo = await newRecoveryCode();
    const chave = await vaultKeyFromCode(codigo);
    const retrato: VaultSnapshot = {
      version: 1,
      vaultId: await vaultIdFromCode(codigo),
      createdAt: new Date().toISOString(),
      notes: [
        {
          id: "nota-do-drive",
          title: "Do Drive",
          recordedAt: "2026-11-18",
          updatedAt: "2026-11-18T10:00:00.000Z",
          text: "texto que veio do drive",
        },
      ],
    };
    pasta.arquivos.set(KEY_FILE, encoder.encode(formatRecoveryCode(codigo)));
    pasta.arquivos.set(BACKUP_FILE, await sealSnapshot(retrato, chave));

    const resumo = await restoreVaultFromDrive(pasta);

    expect(resumo).toEqual({
      created: 1,
      updated: 0,
      skipped: 0,
      notebooks: { created: 0, updated: 0, skipped: 0 },
      analyses: 0,
      settings: false,
      attachments: { restored: 0, skipped: 0 },
      source: "backup",
    });
    expect(await ensureVaultCode()).toBe(codigo);
    const [nota] = await local.listNotes("nota-do-drive");
    expect(nota.content_markdown).toBe("texto que veio do drive");
  });

  it("key.txt invalido recusa a restauracao", async () => {
    const pasta = pastaEmMemoria();
    pasta.arquivos.set(KEY_FILE, encoder.encode("nao-e-um-codigo"));

    await expect(restoreVaultFromDrive(pasta)).rejects.toThrow(/nao tem um codigo valido/);
  });

  it("pasta sem key.txt da erro claro", async () => {
    const pasta = pastaEmMemoria();

    expect(await driveVaultExists(pasta)).toBe(false);
    await expect(restoreVaultFromDrive(pasta)).rejects.toThrow(
      "o Drive nao tem cofre do Dyarium",
    );
  });

  it("pasta com key.txt e sem backup.enc da erro claro", async () => {
    const pasta = pastaEmMemoria();
    pasta.arquivos.set(KEY_FILE, encoder.encode(formatRecoveryCode(await newRecoveryCode())));

    await expect(restoreVaultFromDrive(pasta)).rejects.toThrow(
      "o cofre do Drive nao tem retrato (backup.enc)",
    );
  });
});

describe("abrir o cofre do Drive", () => {
  it("sobe as notas locais quando o retrato do Drive esta vazio", async () => {
    // Cenario do bug: entrar num cofre que ja tem `key.txt` e um retrato sem
    // nota nenhuma. A restauracao nao traz nada e, sem o sync no fim, o banco
    // local com 3 notas nunca subia.
    const pasta = pastaEmMemoria();
    const codigo = await newRecoveryCode();
    const chave = await vaultKeyFromCode(codigo);
    pasta.arquivos.set(KEY_FILE, encoder.encode(formatRecoveryCode(codigo)));
    pasta.arquivos.set(
      BACKUP_FILE,
      await sealSnapshot(
        {
          version: 1,
          vaultId: await vaultIdFromCode(codigo),
          createdAt: "2026-11-01T00:00:00.000Z",
          notes: [],
        },
        chave,
      ),
    );
    await novaNota("Nota 1", "um");
    await novaNota("Nota 2", "dois");
    await novaNota("Nota 3", "tres");

    const stages: string[] = [];
    const aberto = await openDriveVault(pasta, {
      onStage: (stage) => stages.push(stage),
    });

    expect(aberto.restored).toEqual({
      created: 0,
      updated: 0,
      skipped: 0,
      notebooks: { created: 0, updated: 0, skipped: 0 },
      analyses: 0,
      settings: false,
      attachments: { restored: 0, skipped: 0 },
      source: "backup",
    });
    expect(aberto.synced).toMatchObject({ written: 3 });
    expect(stages).toContain("decifrando");
    expect(stages).toContain("aplicando");
    expect(stages).toContain("sincronizando");
    // "lendo" e so da restauracao; o sync no fim nao repete a etapa.
    expect(stages.filter((stage) => stage === "lendo")).toHaveLength(1);

    // O retrato no Drive agora tem o que o dono esta vendo no app.
    const retrato = await openSnapshot(pasta.arquivos.get(BACKUP_FILE)!, chave);
    expect(retrato.notes.map((nota) => nota.title).sort()).toEqual([
      "Nota 1",
      "Nota 2",
      "Nota 3",
    ]);
    const manifest = JSON.parse(
      decoder.decode(pasta.arquivos.get(MANIFEST_FILE)!),
    ) as VaultManifest;
    expect(manifest.files).toHaveLength(3);
    expect(manifest.files.map((arquivo) => arquivo.kind)).toEqual(["note", "note", "note"]);
    expect(aberto.summary).toEqual({
      notes: 3,
      attachments: 0,
      bytes: manifest.files.reduce((soma, arquivo) => soma + arquivo.size, 0),
    });
  });

  it("une local e Drive por id: o mais novo vence e ids diferentes coexistem", async () => {
    const pasta = pastaEmMemoria();
    const codigo = await newRecoveryCode();
    const chave = await vaultKeyFromCode(codigo);

    // Banco local: A so existe aqui, B existe dos dois lados (mais antiga) e o
    // caderno comum tambem existe no Drive com versao mais nova.
    const comum = await createLocalNotebook({ id: "nb-comum", name: "Local", color: "" });
    const soLocal = await createLocalNotebook({ id: "nb-local", name: "So local", color: "" });
    const db = await getDb();
    await db.runAsync("UPDATE notebooks SET updated_at = ? WHERE id = ?", [
      "2020-01-01T00:00:00.000Z",
      comum.id,
    ]);
    const a = await local.createEntry({ id: "nota-a", title: "A local", recordedAt: "2026-01-01" });
    await local.saveNote(a.id, "A");
    const b = await local.createEntry({ id: "nota-b", title: "B local", recordedAt: "2026-01-01" });
    await local.saveNote(b.id, "B local");
    const base = await getRecording(b.id);
    if (!base) throw new Error("nota nao gravada");
    await upsertRecording({ ...base, updatedAt: "2020-01-01T00:00:00.000Z" });

    const retrato: VaultSnapshot = {
      version: 2,
      vaultId: await vaultIdFromCode(codigo),
      createdAt: "2030-01-01T00:00:00.000Z",
      notes: [
        {
          id: "nota-b",
          title: "B do Drive",
          recordedAt: "2026-01-01",
          updatedAt: "2030-01-01T00:00:00.000Z",
          text: "B do Drive",
        },
        {
          id: "nota-c",
          title: "C do Drive",
          recordedAt: "2026-02-01",
          updatedAt: "2030-01-01T00:00:00.000Z",
          text: "C do Drive",
        },
      ],
      notebooks: [
        cadernoDoRetrato("nb-comum", "Do Drive", "2030-01-01T00:00:00.000Z"),
        cadernoDoRetrato("nb-drive", "Novo do Drive", "2030-01-01T00:00:00.000Z"),
      ],
      analyses: [],
    };
    pasta.arquivos.set(KEY_FILE, encoder.encode(formatRecoveryCode(codigo)));
    pasta.arquivos.set(STATE_FILE, await sealSnapshot(retrato, chave));

    const aberto = await openDriveVault(pasta);

    expect(aberto.restored).toMatchObject({
      created: 1,
      updated: 1,
      skipped: 0,
      notebooks: { created: 1, updated: 1, skipped: 0 },
    });

    const notas = await local.listEntries();
    expect(notas.map((nota) => nota.id).sort()).toEqual(["nota-a", "nota-b", "nota-c"]);
    expect((await getRecording("nota-b"))?.title).toBe("B do Drive");
    expect((await local.listNotes("nota-b"))[0].content_markdown).toBe("B do Drive");
    expect((await getRecording("nota-a"))?.title).toBe("A local");
    expect((await getLocalNotebook("nb-comum"))?.name).toBe("Do Drive");
    expect((await getLocalNotebook("nb-drive"))?.name).toBe("Novo do Drive");
    expect((await getLocalNotebook("nb-local"))?.name).toBe("So local");

    // O retrato final e a uniao: nenhum id duplicado de nenhum dos lados.
    const final = await openSnapshot(pasta.arquivos.get(STATE_FILE)!, chave);
    const ids = final.notes.map((nota) => nota.id);
    expect(ids.sort()).toEqual(["nota-a", "nota-b", "nota-c"]);
    expect(new Set(ids).size).toBe(ids.length);
    const idsCadernos = final.notebooks?.map((caderno) => caderno.id) ?? [];
    expect(idsCadernos).toEqual(
      expect.arrayContaining(["nb-comum", "nb-drive", "nb-local"]),
    );
    expect(new Set(idsCadernos).size).toBe(idsCadernos.length);
    expect(soLocal.id).toBe("nb-local");
  });

  it("cofre novo, sem key.txt, nao restaura e ja grava o banco local", async () => {
    const pasta = pastaEmMemoria();
    await novaNota("Primeira nota", "texto local");
    const stages: string[] = [];

    const aberto = await openDriveVault(pasta, {
      onStage: (stage) => stages.push(stage),
    });

    expect(aberto.restored).toBeNull();
    expect(aberto.synced).toMatchObject({ written: 1 });
    expect(aberto.summary).toEqual({
      notes: 1,
      attachments: 0,
      bytes: expect.any(Number),
    });
    expect(stages).toContain("sincronizando");
    expect(stages).not.toContain("lendo");
    expect(await driveVaultExists(pasta)).toBe(true);
  });

  it("vaultSummary conta notas, capitulos e anexos e soma os tamanhos do manifest", async () => {
    const pasta = pastaEmMemoria();
    const manifest: VaultManifest = {
      version: 4,
      vault_id: "cofre-1",
      updated_at: "2026-11-20T00:00:00.000Z",
      files: [
        {
          path: "notes/a.md.enc",
          id: "a",
          kind: "note",
          sha256: "0".repeat(64),
          size: 10,
          updated_at: "2026-11-20T00:00:00.000Z",
        },
        {
          path: "books/livro/001-b.md.enc",
          id: "b",
          kind: "chapter",
          sha256: "1".repeat(64),
          size: 20,
          updated_at: "2026-11-20T00:00:00.000Z",
        },
        {
          path: "books/livro/capa.bin.enc",
          id: "livro",
          kind: "cover",
          sha256: "2".repeat(64),
          size: 5,
          updated_at: "2026-11-20T00:00:00.000Z",
        },
        {
          path: "attachments/att.aac.enc",
          id: "att",
          kind: "attachment",
          sha256: "3".repeat(64),
          size: 100,
          updated_at: "2026-11-20T00:00:00.000Z",
          entry_id: "a",
          content_type: "audio/aac",
        },
      ],
    };
    pasta.arquivos.set(MANIFEST_FILE, encoder.encode(JSON.stringify(manifest)));

    expect(await vaultSummary(pasta)).toEqual({ notes: 2, attachments: 1, bytes: 135 });
  });

  it("vaultSummary de pasta sem manifest devolve zeros", async () => {
    expect(await vaultSummary(pastaEmMemoria())).toEqual({
      notes: 0,
      attachments: 0,
      bytes: 0,
    });
  });
});

describe("restauracao de anexos do cofre", () => {
  it("grava o audio no IndexedDB e a segunda chamada pula o que ja existe", async () => {
    const pasta = pastaEmMemoria();
    const id = await novaNota("Com audio", "texto");
    const anexo = await saveLocalAttachment(
      id,
      new File([new Uint8Array([1, 2, 3, 4])], "voz.aac", { type: "audio/aac" }),
    );
    await escreverCofreCompleto(pasta);
    idb.loja("attachments").clear();

    expect(await restoreAttachmentsFromVault(pasta)).toEqual({ restored: 1, skipped: 0 });

    const guardado = idb.loja("attachments").get(anexo.id) as StoredAttachment;
    expect(guardado).toMatchObject({
      id: anexo.id,
      entry_id: id,
      kind: "original",
      content_type: "audio/aac",
      size_bytes: 4,
    });
    const bytes = new Uint8Array(await guardado.blob.arrayBuffer());
    expect([...bytes]).toEqual([1, 2, 3, 4]);

    expect(await restoreAttachmentsFromVault(pasta)).toEqual({ restored: 0, skipped: 1 });
  });

  it("anexo corrompido conta como skipped e nao derruba o restore inteiro", async () => {
    const pasta = pastaEmMemoria();
    const id = await novaNota("Dois audios", "texto");
    const bom = await saveLocalAttachment(
      id,
      new File([new Uint8Array([9, 9, 9])], "bom.aac", { type: "audio/aac" }),
    );
    const ruim = await saveLocalAttachment(
      id,
      new File([new Uint8Array([8, 8, 8])], "ruim.aac", { type: "audio/aac" }),
    );
    const plano = await planVaultLayout();
    await writeVaultLayout(pasta as unknown as FolderLike, plano);
    const entradaRuim = plano.manifest.files.find((arquivo) => arquivo.id === ruim.id);
    pasta.arquivos.set(entradaRuim!.path, new Uint8Array([1, 2, 3]));
    idb.loja("attachments").clear();

    expect(await restoreAttachmentsFromVault(pasta)).toEqual({ restored: 1, skipped: 1 });
    expect(idb.loja("attachments").has(bom.id)).toBe(true);
    expect(idb.loja("attachments").has(ruim.id)).toBe(false);
  });

  it("manifest v3 sem entry_id nao restaura anexo nenhum e nao da erro", async () => {
    const pasta = pastaEmMemoria();
    const v3: VaultManifest = {
      version: 3,
      vault_id: "cofre-antigo",
      updated_at: "2026-01-01T00:00:00.000Z",
      files: [
        {
          path: "attachments/att_velho.aac.enc",
          id: "att_velho",
          kind: "attachment",
          sha256: "0".repeat(64),
          size: 10,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    pasta.arquivos.set(MANIFEST_FILE, encoder.encode(JSON.stringify(v3)));
    idb.loja("attachments").clear();

    expect(await restoreAttachmentsFromVault(pasta)).toEqual({ restored: 0, skipped: 0 });
  });

  it("restore avisa lendo, decifrando, aplicando e anexos, nessa ordem", async () => {
    const pasta = pastaEmMemoria();
    const id = await novaNota("Com audio", "texto do drive");
    await saveLocalAttachment(
      id,
      new File([new Uint8Array([4, 5, 6])], "voz.aac", { type: "audio/aac" }),
    );
    await escreverCofreCompleto(pasta);
    idb.loja("attachments").clear();

    const stages: string[] = [];
    const resumo = await restoreVaultFromDrive(pasta, {
      onStage: (stage) => stages.push(stage),
    });

    expect(stages).toEqual(["lendo", "decifrando", "aplicando", "anexos"]);
    expect(resumo.attachments).toEqual({ restored: 1, skipped: 0 });
  });

  it("emite a contagem real de notas e de anexos durante a restauracao", async () => {
    const pasta = pastaEmMemoria();
    const n1 = await novaNota("Nota 1", "um");
    const n2 = await novaNota("Nota 2", "dois");
    await novaNota("Nota 3", "tres");
    await saveLocalAttachment(
      n1,
      new File([new Uint8Array([1, 1, 1])], "a.aac", { type: "audio/aac" }),
    );
    await saveLocalAttachment(
      n2,
      new File([new Uint8Array([2, 2, 2])], "b.m4a", { type: "audio/mp4" }),
    );
    await escreverCofreCompleto(pasta);
    idb.loja("attachments").clear();

    let stage = "";
    const eventos: { stage: string; done: number; total: number }[] = [];
    const resumo = await restoreVaultFromDrive(pasta, {
      onStage: (novo) => {
        stage = novo;
      },
      onProgress: (p) => eventos.push({ stage, ...p }),
    });

    const aplicando = eventos
      .filter((evento) => evento.stage === "aplicando")
      .map(({ done, total }) => ({ done, total }));
    const anexos = eventos
      .filter((evento) => evento.stage === "anexos")
      .map(({ done, total }) => ({ done, total }));

    expect(aplicando).toEqual([
      { done: 0, total: 3 },
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
    expect(anexos).toEqual([
      { done: 0, total: 2 },
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
    expect(resumo.attachments).toEqual({ restored: 2, skipped: 0 });
  });

  it("sync do cofre inteiro sobe 3 notas e 2 anexos, e o restore devolve os audios", async () => {
    const pasta = pastaEmMemoria();
    const n1 = await novaNota("Nota 1", "um");
    const n2 = await novaNota("Nota 2", "dois");
    await novaNota("Nota 3", "tres");
    const a = await saveLocalAttachment(
      n1,
      new File([new Uint8Array([1, 1, 1])], "a.aac", { type: "audio/aac" }),
    );
    const b = await saveLocalAttachment(
      n2,
      new File([new Uint8Array([2, 2])], "b.m4a", { type: "audio/mp4" }),
    );

    expect(await syncVaultToDrive(pasta)).toMatchObject({ written: 5, deleted: 0 });

    const manifest = JSON.parse(decoder.decode(pasta.arquivos.get(MANIFEST_FILE)!)) as VaultManifest;
    expect(manifest.version).toBe(4);
    expect(manifest.files.filter((arquivo) => arquivo.kind === "note")).toHaveLength(3);
    expect(manifest.files.filter((arquivo) => arquivo.kind === "attachment")).toHaveLength(2);
    // O plano sob demanda nao muda o sync repetido: sem blob lido a toa, zero.
    expect(await syncVaultToDrive(pasta)).toMatchObject({ written: 0, deleted: 0 });

    idb.loja("attachments").clear();
    expect(await restoreAttachmentsFromVault(pasta)).toEqual({ restored: 2, skipped: 0 });
    const voltouA = idb.loja("attachments").get(a.id) as StoredAttachment;
    const voltouB = idb.loja("attachments").get(b.id) as StoredAttachment;
    expect([...new Uint8Array(await voltouA.blob.arrayBuffer())]).toEqual([1, 1, 1]);
    expect([...new Uint8Array(await voltouB.blob.arrayBuffer())]).toEqual([2, 2]);
  });

  it("onStage que lanca nao interrompe a restauracao", async () => {
    const pasta = pastaEmMemoria();
    const codigo = await newRecoveryCode();
    const chave = await vaultKeyFromCode(codigo);
    const retrato: VaultSnapshot = {
      version: 1,
      vaultId: await vaultIdFromCode(codigo),
      createdAt: new Date().toISOString(),
      notes: [
        {
          id: "nota-teimosa",
          title: "Teimosa",
          recordedAt: "2026-11-18",
          updatedAt: "2026-11-18T10:00:00.000Z",
          text: "o restore segue mesmo com a tela quebrada",
        },
      ],
    };
    pasta.arquivos.set(KEY_FILE, encoder.encode(formatRecoveryCode(codigo)));
    pasta.arquivos.set(BACKUP_FILE, await sealSnapshot(retrato, chave));

    const resumo = await restoreVaultFromDrive(pasta, {
      onStage: () => {
        throw new Error("tela quebrou");
      },
    });

    expect(resumo.created).toBe(1);
    const [nota] = await local.listNotes("nota-teimosa");
    expect(nota.content_markdown).toBe("o restore segue mesmo com a tela quebrada");
  });

  it("ida e volta completa devolve cadernos, notas, transcricoes, analises e configuracoes", async () => {
    const pasta = pastaEmMemoria();
    const caderno = await createLocalNotebook({
      name: "Viagens",
      color: "#123456",
      kind: "book",
    });
    const nota = await local.createEntry({
      title: "Falada no Drive",
      notebookId: caderno.id,
      recordedAt: "2026-11-18",
    });
    await local.saveNote(nota.id, "corpo escrito");
    const base = await getRecording(nota.id);
    if (!base) throw new Error("nota nao gravada");
    await upsertRecording({
      ...base,
      transcript: "fala que volta",
      transcriptSegments: [
        { start_ms: 0, end_ms: 1500, text: "fala que volta" },
      ],
      transcriptStatus: "ready",
      transcriptOrigin: "local",
      hasTranscript: true,
    });
    const analise: Analysis = {
      origin: "api",
      model: "modelo-do-cofre",
      sentiment: 0.2,
      sentiment_label: "neutro",
      emotions: {},
      people: [],
      places: [],
      summary: "analise que volta",
    };
    await saveAnalysisSnapshot(nota.id, analise);
    await saveLocalSettings({ owner_name: "Dono do Drive", transcribe_provider: "deepgram" });

    expect(await syncVaultToDrive(pasta)).toMatchObject({ written: 1 });

    // Outro navegador: banco e IndexedDB novos.
    idb.stores.clear();
    await registerNodeDatabase();
    expect(await local.getEntry(nota.id)).toBeNull();

    const resumo = await restoreVaultFromDrive(pasta);

    expect(resumo).toMatchObject({
      created: 1,
      updated: 0,
      skipped: 0,
      notebooks: { created: 1, updated: 0, skipped: 1 },
      analyses: 1,
      settings: true,
      attachments: { restored: 0, skipped: 0 },
      source: "state",
    });
    const cadernoLocal = await getLocalNotebook(caderno.id);
    expect(cadernoLocal).toMatchObject({ name: "Viagens", kind: "book", color: "#123456" });
    const restaurada = await getRecording(nota.id);
    expect(restaurada).toMatchObject({
      transcript: "fala que volta",
      transcriptStatus: "ready",
      transcriptOrigin: "local",
      hasTranscript: true,
      transcriptSegments: [{ start_ms: 0, end_ms: 1500, text: "fala que volta" }],
      notebookId: caderno.id,
    });
    expect((await local.listNotes(nota.id))[0].content_markdown).toBe("corpo escrito");
    expect((await readLocalAnalysis(nota.id))?.summary).toBe("analise que volta");
    expect((await loadLocalSettings()).owner_name).toBe("Dono do Drive");
    expect((await loadLocalSettings()).transcribe_provider).toBe("deepgram");
  });

  it("sem state.enc, o cofre antigo restaura so as notas do backup.enc v1", async () => {
    const pasta = pastaEmMemoria();
    const caderno = await createLocalNotebook({ name: "Viagens", color: "#123456" });
    const nota = await local.createEntry({
      title: "So o v1",
      notebookId: caderno.id,
      recordedAt: "2026-11-18",
    });
    await local.saveNote(nota.id, "corpo que volta");
    const base = await getRecording(nota.id);
    if (!base) throw new Error("nota nao gravada");
    await upsertRecording({
      ...base,
      transcript: "fala que nao vai no v1",
      transcriptStatus: "ready",
      transcriptOrigin: "local",
      hasTranscript: true,
    });
    await saveAnalysisSnapshot(nota.id, {
      origin: "api",
      model: "modelo-do-cofre",
      sentiment: 0,
      sentiment_label: "neutro",
      emotions: {},
      people: [],
      places: [],
      summary: "analise que nao vai no v1",
    });
    await saveLocalSettings({ owner_name: "Dono do Drive" });
    await syncVaultToDrive(pasta);
    // Cofre antigo: o app so conhece o backup.enc.
    pasta.arquivos.delete(STATE_FILE);

    idb.stores.clear();
    await registerNodeDatabase();

    const resumo = await restoreVaultFromDrive(pasta);

    expect(resumo).toMatchObject({
      created: 1,
      updated: 0,
      skipped: 0,
      notebooks: { created: 0, updated: 0, skipped: 0 },
      analyses: 0,
      settings: false,
      attachments: { restored: 0, skipped: 0 },
      source: "backup",
    });
    expect((await local.listNotes(nota.id))[0].content_markdown).toBe("corpo que volta");
    expect((await getRecording(nota.id))?.transcript).toBeUndefined();
    expect(await getLocalNotebook(caderno.id)).toBeNull();
    expect(await readLocalAnalysis(nota.id)).toBeNull();
    expect((await loadLocalSettings()).owner_name).toBe("");
  });
});

describe("sync automatico e snapshots", () => {
  it("runVaultSync com o gancho registrado reescreve state.enc com a contagem atual de notas", async () => {
    const pasta = pastaEmMemoria();
    await novaNota("nota auto", "texto");

    await runVaultSync(pasta);

    const codigo = normalizeRecoveryCode(decoder.decode(pasta.arquivos.get(KEY_FILE)!));
    const chave = await vaultKeyFromCode(codigo);
    const retrato = await openSnapshot(pasta.arquivos.get(STATE_FILE)!, chave);
    expect(retrato.version).toBe(2);
    expect(retrato.notes).toHaveLength(1);
  });

  it("syncVaultToDrive em pasta vazia cria key.txt, backup.enc e state.enc", async () => {
    const pasta = pastaEmMemoria();

    await syncVaultToDrive(pasta);

    expect(pasta.arquivos.has(KEY_FILE)).toBe(true);
    expect(pasta.arquivos.has(BACKUP_FILE)).toBe(true);
    expect(pasta.arquivos.has(STATE_FILE)).toBe(true);
  });

  it("o snapshot e escrito uma unica vez por sync, nao duplicado", async () => {
    const pasta = pastaEmMemoria();
    await novaNota("nota unica", "texto");

    let escritasState = 0;
    const setOriginal = pasta.arquivos.set.bind(pasta.arquivos);
    pasta.arquivos.set = (chave, valor) => {
      if (chave === STATE_FILE) escritasState += 1;
      return setOriginal(chave, valor);
    };

    await syncVaultToDrive(pasta);

    expect(escritasState).toBe(1);
  });
});
