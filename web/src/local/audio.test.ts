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

import { getRecording, upsertRecording } from "../../../mobile/src/core/repo";

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import {
  audioBlobOf,
  audioFromAttachment,
  entryAudios,
  saveLocalAudio,
  uploadLocalAudio,
} from "./audio";
import { saveLocalAttachment } from "./attachments";
import * as local from "./notes";

beforeEach(async () => {
  banco.clear();
  let seq = 0;
  URL.createObjectURL = vi.fn(() => `blob:local-${seq++}`);
  URL.revokeObjectURL = vi.fn();
  await registerNodeDatabase();
});

function arquivo(nome = "voz.m4a", tipo = "audio/mp4"): File {
  return new File([new Uint8Array([1, 2, 3])], nome, { type: tipo });
}

describe("audio local", () => {
  it("envia sem nota e cria a nota no caderno pedido", async () => {
    const resultado = await uploadLocalAudio(arquivo(), {
      title: "Reunião",
      notebookId: "viagens",
    });

    expect(resultado.entry_id).toMatch(/^note_/);
    expect(resultado.attachment_id).toMatch(/^att_/);

    const nota = await local.getEntry(resultado.entry_id);
    expect(nota?.title).toBe("Reunião");
    expect(nota?.notebook_id).toBe("viagens");
    expect(nota?.source).toBe("audio");
    expect(nota?.content_type).toBe("audio/mp4");
    expect(nota?.original_filename).toBe("voz.m4a");
    expect(nota?.size_bytes).toBe(3);
  });

  it("grava o anexo que entryAudios devolve como audio", async () => {
    const nota = await local.createEntry({ title: "Áudio avulso" });
    const anexo = await saveLocalAudio(nota.id, arquivo());

    expect(anexo.entry_id).toBe(nota.id);
    expect(anexo.content_type).toBe("audio/mp4");

    const audios = await entryAudios(nota.id);
    expect(audios).toHaveLength(1);
    expect(audios[0]).toMatchObject({
      id: anexo.id,
      content_type: "audio/mp4",
      size_bytes: 3,
      duration_seconds: 0,
    });
    // Nota sem transcricao nao inventa uma.
    expect(audios[0].transcript).toBeUndefined();
  });

  it("upload com entryId reaproveita a nota existente", async () => {
    const nota = await local.createEntry({ title: "Já existe" });
    const resultado = await uploadLocalAudio(arquivo(), {
      entryId: nota.id,
      title: "Título ignorado",
    });

    expect(resultado.entry_id).toBe(nota.id);
    expect(await local.listEntries()).toHaveLength(1);
    const depois = await local.getEntry(nota.id);
    expect(depois?.title).toBe("Já existe");
    expect(depois?.source).toBe("audio");
  });

  it("usa o nome do arquivo quando o titulo nao vem explicito", async () => {
    const comNome = await uploadLocalAudio(arquivo("ideia de domingo.m4a"));
    expect((await local.getEntry(comNome.entry_id))?.title).toBe("ideia de domingo");

    // Sem nome, o titulo e a data/hora local, como no app.
    const semNome = await uploadLocalAudio(arquivo(""));
    expect((await local.getEntry(semNome.entry_id))?.title).toMatch(
      /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
    );
  });

  it("avisa o progresso uma vez com o tamanho inteiro", async () => {
    const progresso = vi.fn();
    await uploadLocalAudio(arquivo(), { onProgress: progresso });

    expect(progresso).toHaveBeenCalledTimes(1);
    expect(progresso).toHaveBeenCalledWith(3, 3);
  });

  it("audioBlobOf devolve o byte guardado e null sem audio", async () => {
    const semSom = await local.createEntry({ title: "Sem som" });
    expect(await audioBlobOf(semSom.id)).toBeNull();

    const resultado = await uploadLocalAudio(arquivo());
    const blob = await audioBlobOf(resultado.entry_id);
    expect(blob).not.toBeNull();
    expect(blob?.type).toBe("audio/mp4");
    expect(blob?.size).toBe(3);
  });

  it("anexo de imagem nao entra em entryAudios", async () => {
    const nota = await local.createEntry({ title: "Com foto" });
    await saveLocalAttachment(
      nota.id,
      new File([new Uint8Array([9])], "foto.png", { type: "image/png" }),
    );

    expect(await entryAudios(nota.id)).toEqual([]);
    expect(await audioBlobOf(nota.id)).toBeNull();
  });

  it("audioFromAttachment entrega a URL do blob para o player", async () => {
    const resultado = await uploadLocalAudio(arquivo());
    expect(audioFromAttachment(resultado.attachment_id)).toMatch(/^blob:local-/);
  });

  it("monta a transcricao do aparelho no formato da web", async () => {
    const resultado = await uploadLocalAudio(arquivo());
    const gravacao = await getRecording(resultado.entry_id);
    if (!gravacao) throw new Error("a nota enviada sumiu do cofre");

    await upsertRecording({
      ...gravacao,
      transcript: "falei cedo",
      transcriptLanguage: "pt",
      transcriptOrigin: "local",
      transcriptStatus: "ready",
      hasTranscript: true,
      transcriptSegments: [
        { start_ms: 0, end_ms: 900, text: "falei cedo" },
        { start_ms: 900, end_ms: 1500, text: "e depois sai", revised: "e então saí" },
      ],
    });

    const audios = await entryAudios(resultado.entry_id);
    expect(audios[0].transcript).toMatchObject({
      model: "local",
      language: "pt",
      text: "falei cedo",
      duration_seconds: 0,
    });
    expect(audios[0].transcript?.segments?.map((segmento) => segmento.idx)).toEqual([0, 1]);
    expect(audios[0].transcript?.segments?.[1].revised).toBe("e então saí");
  });
});
