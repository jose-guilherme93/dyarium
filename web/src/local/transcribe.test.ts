/**
 * Transcricao local sem worker nem audio de verdade.
 *
 * O worker e substituido por um motor falso e a decodificacao por buffers
 * falsos. O cofre e o de verdade (`node:sqlite` + IndexedDB em memoria), para
 * conferir o que fica gravado na nota.
 *
 * `./audio` fica mockado para o teste controlar o blob, mas a implementacao
 * padrao continua sendo a real: o anexo e procurado no cofre de verdade.
 */

import type { LocalTranscribeEngine } from "./transcribe";
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

const mocks = vi.hoisted(() => ({
  audioBlobOf: vi.fn(),
  decodeAudio: vi.fn(),
  toMono16k: vi.fn(),
  /** Implementacao real, guardada antes de o modulo ser substituido. */
  realAudioBlobOf: undefined as
    | undefined
    | ((entryId: string) => Promise<Blob | null>),
}));

vi.mock("./audio", async (importOriginal) => {
  const real = await importOriginal<typeof import("./audio")>();
  mocks.realAudioBlobOf = real.audioBlobOf;
  return { ...real, audioBlobOf: mocks.audioBlobOf };
});
vi.mock("../lib/audioDecode", () => ({
  decodeAudio: mocks.decodeAudio,
  toMono16k: mocks.toMono16k,
}));

import { getRecording } from "../../../mobile/src/core/repo";

import { planForTier } from "../lib/browserModels";
import type { Transcription } from "../worker/engine";

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import { saveLocalAttachment } from "./attachments";
import { transcribeEntryLocally, type LocalTranscribePlan } from "./transcribe";
import * as local from "./notes";

let urls = 0;

beforeEach(async () => {
  banco.clear();
  urls = 0;
  URL.createObjectURL = vi.fn(() => `blob:local-${urls++}`);
  URL.revokeObjectURL = vi.fn();
  mocks.audioBlobOf.mockReset();
  mocks.decodeAudio.mockReset();
  mocks.toMono16k.mockReset();
  // O anexo e procurado no cofre pelo caminho real; so o blob e interceptado.
  mocks.audioBlobOf.mockImplementation(async (entryId: string) => {
    if (!mocks.realAudioBlobOf) throw new Error("modulo de audio real nao carregou");
    return mocks.realAudioBlobOf(entryId);
  });
  mocks.decodeAudio.mockResolvedValue(audioDecodificado(2.4));
  mocks.toMono16k.mockResolvedValue(new Float32Array(38400));
  await registerNodeDatabase();
});

/** O que o decodificador do navegador devolveria para um audio de N segundos. */
function audioDecodificado(duration: number): AudioBuffer {
  return {
    duration,
    numberOfChannels: 1,
    sampleRate: 16000,
    length: Math.ceil(duration * 16000),
  } as unknown as AudioBuffer;
}

/** Nota com um anexo de audio local, como o app grava. */
async function notaComAudio(titulo: string): Promise<{ id: string }> {
  const nota = await local.createEntry({ title: titulo });
  await saveLocalAttachment(
    nota.id,
    new File([new Uint8Array([1, 2, 3])], "voz.m4a", { type: "audio/mp4" }),
  );
  return nota;
}

function transcricaoDoMotor(): Transcription {
  return {
    text: "falei cedo e depois sai",
    language: "portuguese (cpu)",
    segments: [
      { start_ms: 0, end_ms: 900, text: "falei cedo" },
      { start_ms: 900, end_ms: 1500, text: "e depois sai" },
    ],
    wallMs: 12,
  };
}

function motorFalso(): LocalTranscribeEngine {
  // O mock nao carrega a assinatura do motor real; aqui basta o formato.
  return {
    configure: vi.fn(),
    transcribe: vi.fn(async () => transcricaoDoMotor()),
    dispose: vi.fn(),
  } as unknown as LocalTranscribeEngine;
}

function planoFalso(tier: 0 | 1 | 2 | 3 | 4 = 0): LocalTranscribePlan {
  return { plan: planForTier(tier), allowGpu: true, threads: 2 };
}

describe("transcricao local", () => {
  it("transcreve e grava o resultado no cofre local", async () => {
    const nota = await notaComAudio("Ideia de domingo");
    const motor = motorFalso();

    const transcricao = await transcribeEntryLocally(nota.id, {
      engineFactory: () => motor,
      planFactory: async () => planoFalso(),
    });

    expect(transcricao.text).toBe("falei cedo e depois sai");

    const gravacao = await getRecording(nota.id);
    expect(gravacao?.transcript).toBe("falei cedo e depois sai");
    expect(gravacao?.transcriptSegments).toEqual([
      { start_ms: 0, end_ms: 900, text: "falei cedo" },
      { start_ms: 900, end_ms: 1500, text: "e depois sai" },
    ]);
    expect(gravacao?.transcriptStatus).toBe("ready");
    expect(gravacao?.transcriptOrigin).toBe("local");
    expect(gravacao?.hasTranscript).toBe(true);
    expect(gravacao?.transcriptLanguage).toBe("portuguese");
    // O resto da nota fica como estava.
    expect(gravacao?.title).toBe("Ideia de domingo");
    expect(gravacao?.text).toBe("");
  });

  it("devolve o Transcript da web com idx e a duracao real", async () => {
    const nota = await notaComAudio("Com áudio");

    const transcricao = await transcribeEntryLocally(nota.id, {
      engineFactory: () => motorFalso(),
      planFactory: async () => planoFalso(),
    });

    expect(transcricao).toEqual({
      model: planForTier(0).whisper.id,
      language: "portuguese",
      text: "falei cedo e depois sai",
      raw_text: "falei cedo e depois sai",
      trim_silence: false,
      duration_seconds: 2,
      segments: [
        { idx: 0, start_ms: 0, end_ms: 900, text: "falei cedo" },
        { idx: 1, start_ms: 900, end_ms: 1500, text: "e depois sai" },
      ],
    });
  });

  it("recusa nota sem audio", async () => {
    const nota = await local.createEntry({ title: "Só texto" });
    const motor = motorFalso();
    const planFactory = vi.fn(async () => planoFalso());

    await expect(
      transcribeEntryLocally(nota.id, { engineFactory: () => motor, planFactory }),
    ).rejects.toThrow("esta nota nao tem audio");

    expect(planFactory).not.toHaveBeenCalled();
    expect(motor.configure).not.toHaveBeenCalled();
    const gravacao = await getRecording(nota.id);
    expect(gravacao?.hasTranscript).toBeFalsy();
  });

  it("nao grava quando o sinal aborta antes de salvar", async () => {
    const nota = await notaComAudio("Cancelada");
    const controle = new AbortController();
    const motor = motorFalso();
    const transcribeFalso = motor.transcribe as unknown as {
      mockImplementation: (fn: () => Promise<unknown>) => void;
    };
    transcribeFalso.mockImplementation(async () => {
      // O cancelamento chega enquanto o Whisper roda; o cofre nao pode mudar.
      controle.abort();
      return transcricaoDoMotor();
    });
    const etapas: string[] = [];

    let erro: unknown;
    try {
      await transcribeEntryLocally(nota.id, {
        signal: controle.signal,
        engineFactory: () => motor,
        planFactory: async () => planoFalso(),
        onProgress: (progresso) => etapas.push(progresso.stage),
      });
    } catch (falha) {
      erro = falha;
    }

    expect(erro).toBeInstanceOf(DOMException);
    expect((erro as DOMException).name).toBe("AbortError");
    expect(etapas).toEqual(["preparing", "decoding", "transcribing"]);
    const gravacao = await getRecording(nota.id);
    expect(gravacao?.hasTranscript).toBeFalsy();
    expect(gravacao?.transcript).toBeUndefined();
    expect(gravacao?.transcriptSegments).toBeUndefined();
  });

  it("configura o motor com o plano, a GPU e os nucleos do perfil", async () => {
    const nota = await notaComAudio("Perfil");
    const motor = motorFalso();
    const perfil = { plan: planForTier(2), allowGpu: false, threads: 3 };

    await transcribeEntryLocally(nota.id, {
      engineFactory: () => motor,
      planFactory: async () => perfil,
    });

    expect(motor.configure).toHaveBeenCalledTimes(1);
    expect(motor.configure).toHaveBeenCalledWith(perfil.plan, false, 3);
  });

  it("avisa o progresso na ordem das etapas", async () => {
    const nota = await notaComAudio("Etapas");
    const etapas: string[] = [];

    await transcribeEntryLocally(nota.id, {
      engineFactory: () => motorFalso(),
      planFactory: async () => planoFalso(),
      onProgress: (progresso) => etapas.push(progresso.stage),
    });

    expect(etapas).toEqual(["preparing", "decoding", "transcribing", "saving", "done"]);
  });
});
