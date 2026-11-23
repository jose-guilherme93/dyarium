import { beforeEach, describe, expect, it, vi } from "vitest";

// O cofre local guarda analise e configuracoes no IndexedDB: aqui eles vivem
// num Map em memoria, como no navegador. As notas continuam no SQLite real.
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
    ANALYSIS_STORE: "analysis",
    STORE_SETTINGS: "settings",
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

import {
  getRecording,
  updateChapterFields,
  upsertRecording,
} from "../../../mobile/src/core/repo";

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import { listLocalAnalyses, readLocalAnalysis, saveAnalysisSnapshot } from "./analyze";
import {
  applySnapshot,
  buildNotesSnapshot,
  buildSnapshot,
  openSnapshot,
  sealSnapshot,
  snapshotNotes,
  vaultIdFromCode,
  type StepProgress,
  type VaultSnapshot,
} from "./backup";
import { createLocalNotebook, getLocalNotebook } from "./notebooks";
import * as local from "./notes";
import { DEFAULT_SETTINGS, loadLocalSettings, saveLocalSettings } from "./settings";
import { newRecoveryCode, vaultKeyFromCode } from "./vault";

import type { Analysis, Notebook } from "../types";

const ANALISE: Analysis = {
  origin: "api",
  model: "modelo-do-cofre",
  sentiment: 0.4,
  sentiment_label: "positivo",
  emotions: { alegria: 0.7 },
  people: ["Ana"],
  places: [],
  summary: "resumo que veio do Drive",
};

beforeEach(async () => {
  idb.stores.clear();
  await registerNodeDatabase();
});

/** Nota com transcricao e planejamento de capitulo, como o cofre guarda. */
async function notaComTranscricao(notebookId?: string): Promise<string> {
  const nota = await local.createEntry({
    title: "Falada",
    notebookId,
    recordedAt: "2026-01-02T10:00:00Z",
  });
  await local.saveNote(nota.id, "corpo escrito");
  const base = await getRecording(nota.id);
  if (!base) throw new Error("nota nao gravada");
  await upsertRecording({
    ...base,
    transcript: "texto falado",
    transcriptLanguage: "pt",
    transcriptSegments: [{ start_ms: 0, end_ms: 1200, text: "texto falado" }],
    transcriptStatus: "ready",
    transcriptOrigin: "local",
    hasTranscript: true,
  });
  await updateChapterFields(nota.id, {
    chapterKind: "scene",
    chapterPosition: 1024,
    chapterStatus: "draft",
    chapterGoalWords: 800,
    chapterSynopsis: "o que acontece no capitulo",
    chapterBeats: "beat um",
    chapterNotes: "anotacao do autor",
  });
  return nota.id;
}

/** Caderno do retrato, com todos os campos persistidos. */
function cadernoDoRetrato(patch: Partial<Notebook> = {}): Notebook {
  return {
    id: "nb-do-drive",
    name: "Viagens",
    color: "#335577",
    is_default: false,
    kind: "book",
    subtitle: "um livro",
    author: "Dono",
    synopsis: "sinopse",
    language: "pt",
    goal_words: 50000,
    book_status: "drafting",
    page_size: "6x9",
    page_margin_mm: 15,
    body_px: 18,
    body_leading: 160,
    body_font: "newsreader",
    daily_goal_words: 500,
    deadline: "2027-01-01",
    entry_count: 0,
    chapter_count: 0,
    has_cover: true,
    cover_updated_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("backup do cofre", () => {
  it("o id do cofre vem do codigo e nao revela a chave", async () => {
    const codigo = await newRecoveryCode();
    const id = await vaultIdFromCode(codigo);
    expect(id).toMatch(/^[0-9a-f]{10}$/);
    expect(id).not.toContain(codigo.slice(0, 4));
    expect(await vaultIdFromCode(codigo)).toBe(id);
    expect(await vaultIdFromCode(await newRecoveryCode())).not.toBe(id);
  });

  it("o retrato v2 leva titulo, data, caderno, tag, corpo, transcricao e analise", async () => {
    const caderno = await createLocalNotebook({ name: "Viagens", color: "#335577" });
    const notaId = await notaComTranscricao(caderno.id);
    await local.setEntryTags(notaId, ["viagem"]);
    await saveAnalysisSnapshot(notaId, ANALISE);
    await saveLocalSettings({ owner_name: "Dono do Drive", transcribe_provider: "deepgram" });

    const retrato = await buildSnapshot("abc123");

    expect(retrato.version).toBe(2);
    expect(retrato.vaultId).toBe("abc123");
    expect(retrato.notes).toHaveLength(1);
    expect(retrato.notes[0]).toMatchObject({
      id: notaId,
      title: "Falada",
      tags: ["viagem"],
      text: "corpo escrito",
      notebookId: caderno.id,
      transcript: "texto falado",
      transcriptLanguage: "pt",
      transcriptStatus: "ready",
      transcriptOrigin: "local",
      hasTranscript: true,
      transcriptSegments: [{ start_ms: 0, end_ms: 1200, text: "texto falado" }],
      chapterKind: "scene",
      chapterPosition: 1024,
      chapterStatus: "draft",
      chapterGoalWords: 800,
      chapterSynopsis: "o que acontece no capitulo",
      chapterBeats: "beat um",
      chapterNotes: "anotacao do autor",
    });
    expect(retrato.notebooks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: caderno.id, name: "Viagens", kind: "notes" }),
      ]),
    );
    expect(retrato.analyses).toEqual([{ entry_id: notaId, analysis: ANALISE }]);
    expect(retrato.settings).toMatchObject({
      owner_name: "Dono do Drive",
      transcribe_provider: "deepgram",
    });
  });

  it("buildNotesSnapshot gera o v1 compartilhado com as notas e sem campos extras", async () => {
    const caderno = await createLocalNotebook({ name: "Viagens", color: "#335577" });
    const notaId = await notaComTranscricao(caderno.id);
    await saveAnalysisSnapshot(notaId, ANALISE);
    await saveLocalSettings({ owner_name: "Dono do Drive" });

    const retrato = await buildNotesSnapshot("abc123");

    expect(retrato.version).toBe(1);
    expect(retrato.notes).toHaveLength(1);
    expect(retrato.notes[0]).toMatchObject({
      id: notaId,
      title: "Falada",
      text: "corpo escrito",
      notebookId: caderno.id,
    });
    expect(retrato).not.toHaveProperty("notebooks");
    expect(retrato).not.toHaveProperty("analyses");
    expect(retrato).not.toHaveProperty("settings");
    // O JSON que vai para o arquivo nao carrega nada da v2.
    const gravado = JSON.parse(JSON.stringify(retrato)) as {
      version: number;
      notes: Record<string, unknown>[];
    };
    expect(gravado.version).toBe(1);
    expect(gravado.notes[0]).not.toHaveProperty("transcript");
    expect(gravado.notes[0]).not.toHaveProperty("transcriptSegments");
    expect(gravado.notes[0]).not.toHaveProperty("chapterKind");
    const permitidos = [
      "archived",
      "author",
      "icon",
      "id",
      "notebookId",
      "recordedAt",
      "tags",
      "text",
      "title",
      "updatedAt",
    ];
    const chaves = Object.keys(gravado.notes[0]);
    expect(chaves.every((chave) => permitidos.includes(chave))).toBe(true);
    expect(chaves).toEqual(expect.arrayContaining(["id", "title", "recordedAt", "updatedAt", "text"]));
  });

  it("cifra e abre com a mesma chave", async () => {
    const codigo = await newRecoveryCode();
    const chave = await vaultKeyFromCode(codigo);
    const retrato: VaultSnapshot = {
      version: 2,
      vaultId: "abc123",
      createdAt: "2026-11-15T10:00:00Z",
      notes: snapshotNotes([]),
      notebooks: [],
      analyses: [],
      settings: DEFAULT_SETTINGS,
    };
    const selado = await sealSnapshot(retrato, chave);
    expect(new TextDecoder().decode(selado)).not.toContain("abc123");
    expect(await openSnapshot(selado, await vaultKeyFromCode(codigo))).toEqual(retrato);
  });

  it("chave errada nao abre o backup", async () => {
    const chave = await vaultKeyFromCode(await newRecoveryCode());
    const selado = await sealSnapshot(
      { version: 1, vaultId: "v", createdAt: "x", notes: [] },
      chave,
    );
    const outra = await vaultKeyFromCode(await newRecoveryCode());
    await expect(openSnapshot(selado, outra)).rejects.toThrow();
  });

  it("abre retrato v1 e restaura so as notas", async () => {
    const chave = await vaultKeyFromCode(await newRecoveryCode());
    const selado = await sealSnapshot(
      {
        version: 1,
        vaultId: "v",
        createdAt: "2026-01-01T00:00:00Z",
        notes: [
          {
            id: "n-v1",
            title: "Antiga",
            recordedAt: "2026-01-02T10:00:00Z",
            updatedAt: "2026-01-02T10:00:00Z",
            text: "corpo v1",
          },
        ],
        // Campos da v2 num retrato marcado como v1 sao ignorados.
        notebooks: [cadernoDoRetrato({ id: "nb-v1", name: "Nao deve entrar" })],
        analyses: [{ entry_id: "n-v1", analysis: ANALISE }],
        settings: { ...DEFAULT_SETTINGS, owner_name: "Nao deve entrar" },
      },
      chave,
    );

    const retrato = await openSnapshot(selado, chave);
    expect(retrato.version).toBe(1);

    const resultado = await applySnapshot(retrato);

    expect(resultado).toEqual({
      created: 1,
      updated: 0,
      skipped: 0,
      notebooks: { created: 0, updated: 0, skipped: 0 },
      analyses: 0,
      settings: false,
    });
    const nota = await local.getEntry("n-v1");
    expect(nota?.title).toBe("Antiga");
    expect((await local.listNotes("n-v1"))[0].content_markdown).toBe("corpo v1");
    expect(await getLocalNotebook("nb-v1")).toBeNull();
    expect(await readLocalAnalysis("n-v1")).toBeNull();
    expect((await loadLocalSettings()).owner_name).toBe("");
  });

  it("restaura as notas do retrato no cofre vazio", async () => {
    const resultado = await applySnapshot({
      version: 1,
      vaultId: "v",
      createdAt: "2026-01-01T00:00:00Z",
      notes: [
        {
          id: "n1",
          title: "Voltou",
          recordedAt: "2026-01-02T10:00:00Z",
          updatedAt: "2026-01-02T10:00:00Z",
          tags: ["volta"],
          text: "corpo restaurado",
        },
      ],
    });

    expect(resultado).toEqual({
      created: 1,
      updated: 0,
      skipped: 0,
      notebooks: { created: 0, updated: 0, skipped: 0 },
      analyses: 0,
      settings: false,
    });
    const nota = await local.getEntry("n1");
    expect(nota?.title).toBe("Voltou");
    expect((await local.listNotes("n1"))[0].content_markdown).toBe("corpo restaurado");
  });

  it("restaura caderno, transcricao, analise e configuracoes do retrato v2", async () => {
    const caderno = cadernoDoRetrato();
    const notaId = "nota-do-drive";

    const resultado = await applySnapshot({
      version: 2,
      vaultId: "v",
      createdAt: "2026-01-01T00:00:00Z",
      notes: [
        {
          id: notaId,
          title: "Do Drive",
          recordedAt: "2026-01-02T10:00:00Z",
          updatedAt: "2026-01-02T10:00:00Z",
          notebookId: caderno.id,
          text: "corpo do drive",
          transcript: "fala do drive",
          transcriptLanguage: "pt",
          transcriptSegments: [{ start_ms: 0, end_ms: 900, text: "fala do drive" }],
          transcriptStatus: "ready",
          transcriptOrigin: "server",
          hasTranscript: true,
          chapterKind: "scene",
          chapterPosition: 2048,
          chapterStatus: "written",
          chapterGoalWords: 1200,
          chapterSynopsis: "sinopse do drive",
          chapterBeats: "beat do drive",
          chapterNotes: "nota do drive",
          parentId: "nota-origem",
        },
      ],
      notebooks: [caderno],
      analyses: [{ entry_id: notaId, analysis: ANALISE }],
      settings: {
        ...DEFAULT_SETTINGS,
        owner_name: "Dono do Drive",
        transcribe_provider: "deepgram",
      },
    });

    expect(resultado).toEqual({
      created: 1,
      updated: 0,
      skipped: 0,
      notebooks: { created: 1, updated: 0, skipped: 0 },
      analyses: 1,
      settings: true,
    });

    const cadernoLocal = await getLocalNotebook(caderno.id);
    expect(cadernoLocal).toMatchObject({
      name: "Viagens",
      kind: "book",
      color: "#335577",
      created_at: "2026-01-01T00:00:00.000Z",
      has_cover: true,
      cover_updated_at: "2026-01-01T00:00:00.000Z",
    });

    const nota = await getRecording(notaId);
    expect(nota).toMatchObject({
      transcript: "fala do drive",
      transcriptLanguage: "pt",
      transcriptStatus: "ready",
      transcriptOrigin: "server",
      hasTranscript: true,
      transcriptSegments: [{ start_ms: 0, end_ms: 900, text: "fala do drive" }],
      chapterKind: "scene",
      chapterPosition: 2048,
      chapterStatus: "written",
      chapterGoalWords: 1200,
      chapterSynopsis: "sinopse do drive",
      chapterBeats: "beat do drive",
      chapterNotes: "nota do drive",
      captureSourceId: "nota-origem",
    });
    expect((await local.listNotes(notaId))[0].content_markdown).toBe("corpo do drive");

    expect(await readLocalAnalysis(notaId)).toEqual(ANALISE);
    const settings = await loadLocalSettings();
    expect(settings.owner_name).toBe("Dono do Drive");
    expect(settings.transcribe_provider).toBe("deepgram");
  });

  it("configuracao local alterada nao e sobrescrita pelo retrato", async () => {
    await saveLocalSettings({ owner_name: "Daqui", analyze_provider: "openai" });

    const resultado = await applySnapshot({
      version: 2,
      vaultId: "v",
      createdAt: "2026-01-01T00:00:00Z",
      notes: [],
      settings: { ...DEFAULT_SETTINGS, owner_name: "Do Drive" },
    });

    expect(resultado.settings).toBe(false);
    expect((await loadLocalSettings()).owner_name).toBe("Daqui");
    expect((await loadLocalSettings()).analyze_provider).toBe("openai");
  });

  it("analise local nao e sobrescrita pelo retrato", async () => {
    const nota = await local.createEntry({ title: "Com analise" });
    const localAnalysis: Analysis = { ...ANALISE, summary: "analise daqui" };
    await saveAnalysisSnapshot(nota.id, localAnalysis);

    const resultado = await applySnapshot({
      version: 2,
      vaultId: "v",
      createdAt: "2026-01-01T00:00:00Z",
      notes: [],
      analyses: [{ entry_id: nota.id, analysis: { ...ANALISE, summary: "analise do drive" } }],
    });

    expect(resultado.analyses).toBe(0);
    expect((await readLocalAnalysis(nota.id))?.summary).toBe("analise daqui");
  });

  it("caderno local mais novo nao e sobrescrito por um retrato antigo", async () => {
    const caderno = await createLocalNotebook({ id: "nb-local", name: "Local", color: "" });

    const resultado = await applySnapshot({
      version: 2,
      vaultId: "v",
      createdAt: "2025-01-01T00:00:00Z",
      notes: [],
      notebooks: [
        cadernoDoRetrato({
          id: caderno.id,
          name: "Antigo",
          kind: "notes",
          updated_at: "2025-01-01T00:00:00.000Z",
          created_at: "2025-01-01T00:00:00.000Z",
        }),
      ],
    });

    expect(resultado.notebooks).toEqual({ created: 0, updated: 0, skipped: 1 });
    expect((await getLocalNotebook(caderno.id))?.name).toBe("Local");
  });

  it("retrato mais antigo nao passa por cima da nota local mais nova", async () => {
    const nota = await local.createEntry({ title: "Local, mais nova" });
    await local.saveNote(nota.id, "texto daqui");

    const resultado = await applySnapshot({
      version: 1,
      vaultId: "v",
      createdAt: "2025-01-01T00:00:00Z",
      notes: [
        {
          id: nota.id,
          title: "Antiga",
          recordedAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
          text: "texto velho",
          transcript: "fala velha",
        },
      ],
    });

    expect(resultado).toMatchObject({ updated: 0, skipped: 1 });
    expect((await local.getEntry(nota.id))?.title).toBe("Local, mais nova");
    expect((await getRecording(nota.id))?.transcript).toBeUndefined();
  });

  it("listLocalAnalyses so devolve as chaves de analise", async () => {
    const nota = await local.createEntry({ title: "Uma" });
    await saveAnalysisSnapshot(nota.id, ANALISE);
    idb.stores.get("analysis")!.set("outra-coisa", { qualquer: true });

    expect(await listLocalAnalyses()).toEqual([{ entry_id: nota.id, analysis: ANALISE }]);
  });

  it("onProgress recebe 0/total e depois cada nota processada, inclusive a pulada", async () => {
    const localMaisNova = await local.createEntry({ title: "Fica como esta" });
    await local.saveNote(localMaisNova.id, "texto local");

    const eventos: StepProgress[] = [];
    const resultado = await applySnapshot(
      {
        version: 1,
        vaultId: "v",
        createdAt: "2026-01-01T00:00:00Z",
        notes: [
          {
            id: localMaisNova.id,
            title: "Antiga",
            recordedAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            text: "texto velho",
          },
          {
            id: "n2",
            title: "Segunda",
            recordedAt: "2026-01-02T10:00:00Z",
            updatedAt: "2026-01-02T10:00:00Z",
            text: "corpo 2",
          },
          {
            id: "n3",
            title: "Terceira",
            recordedAt: "2026-01-03T10:00:00Z",
            updatedAt: "2026-01-03T10:00:00Z",
            text: "corpo 3",
          },
        ],
      },
      { onProgress: (p) => eventos.push(p) },
    );

    expect(eventos).toEqual([
      { done: 0, total: 3 },
      { done: 1, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ]);
    expect(resultado).toEqual({
      created: 2,
      updated: 0,
      skipped: 1,
      notebooks: { created: 0, updated: 0, skipped: 0 },
      analyses: 0,
      settings: false,
    });
  });

  it("onProgress que lanca nao interrompe a restauracao", async () => {
    const resultado = await applySnapshot(
      {
        version: 1,
        vaultId: "v",
        createdAt: "2026-01-01T00:00:00Z",
        notes: [
          {
            id: "n1",
            title: "Uma",
            recordedAt: "2026-01-02T10:00:00Z",
            updatedAt: "2026-01-02T10:00:00Z",
            text: "corpo 1",
          },
          {
            id: "n2",
            title: "Duas",
            recordedAt: "2026-01-03T10:00:00Z",
            updatedAt: "2026-01-03T10:00:00Z",
            text: "corpo 2",
          },
        ],
      },
      {
        onProgress: () => {
          throw new Error("tela quebrou");
        },
      },
    );

    expect(resultado).toMatchObject({ created: 2, updated: 0, skipped: 0 });
    expect((await local.getEntry("n2"))?.title).toBe("Duas");
  });

  it("backup truncado falha com mensagem clara", async () => {
    const chave = await vaultKeyFromCode(await newRecoveryCode());
    await expect(openSnapshot(new Uint8Array(4), chave)).rejects.toThrow(/truncado/);
  });
});
