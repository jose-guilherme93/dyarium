/**
 * Transcricao por provedor (Deepgram) sem rede: o `fetch` e falso e o audio e
 * um anexo de verdade no cofre local (`node:sqlite` + IndexedDB em memoria).
 *
 * Nenhuma chave real entra aqui; a chave de teste serve para conferir o
 * cabecalho e para garantir que ela nao vaza em URL nem em mensagem de erro.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const banco = new Map<string, unknown>();

vi.mock("../lib/idb", () => ({
  ATTACHMENTS_STORE: "attachments",
  STORE_SETTINGS: "settings",
  storeSet: async (_store: string, key: string, value: unknown) => {
    banco.set(key, value);
  },
  storeGet: async (_store: string, key: string) => banco.get(key),
  storeList: async () => [...banco.entries()],
  storeDelete: async (_store: string, key: string) => {
    banco.delete(key);
  },
}));

import { getRecording } from "../../../mobile/src/core/repo";

import { registerNodeDatabase } from "./__fixtures__/nodeDb";

import { saveLocalAttachment } from "./attachments";
import * as local from "./notes";
import { transcribeWithProvider } from "./providerTranscribe";
import type { TranscribeConfig } from "./settings";

const CONFIG: TranscribeConfig = {
  provider: "deepgram",
  apiKey: "dg-chave-de-teste",
  model: "nova-2",
  language: "pt",
};

beforeEach(async () => {
  banco.clear();
  let seq = 0;
  URL.createObjectURL = vi.fn(() => `blob:local-${seq++}`);
  URL.revokeObjectURL = vi.fn();
  await registerNodeDatabase();
});

/** Nota com um anexo de audio local, como o app grava. */
async function notaComAudio(titulo: string): Promise<{ id: string }> {
  const nota = await local.createEntry({ title: titulo });
  await saveLocalAttachment(
    nota.id,
    new File([new Uint8Array([1, 2, 3, 4])], "voz.wav", { type: "audio/wav" }),
  );
  return nota;
}

function resposta(corpo: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  } as unknown as Response;
}

/** `fetch` falso com a assinatura que o modulo chama. */
function fetchFalso(corpo: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => resposta(corpo, status));
}

describe("transcricao por provedor", () => {
  it("transcreve com utterances e grava origem, status e idioma no cofre", async () => {
    const nota = await notaComAudio("Ideia de domingo");
    const fetchMock = fetchFalso({
      results: {
        utterances: [
          { transcript: "bom dia", start: 0, end: 1.2 },
          { transcript: "tudo certo?", start: 2.1, end: 3.2 },
        ],
        channels: [{ alternatives: [{ transcript: "bom dia tudo certo?" }] }],
      },
    });

    const transcricao = await transcribeWithProvider(nota.id, {
      config: CONFIG,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(transcricao).toEqual({
      model: "nova-2",
      language: "pt",
      text: "bom dia tudo certo?",
      raw_text: "bom dia tudo certo?",
      trim_silence: false,
      // Fim do ultimo trecho (3,2 s) arredondado.
      duration_seconds: 3,
      segments: [
        { idx: 0, start_ms: 0, end_ms: 1200, text: "bom dia" },
        { idx: 1, start_ms: 2100, end_ms: 3200, text: "tudo certo?" },
      ],
    });

    const gravacao = await getRecording(nota.id);
    expect(gravacao?.transcript).toBe("bom dia tudo certo?");
    expect(gravacao?.transcriptSegments).toEqual([
      { start_ms: 0, end_ms: 1200, text: "bom dia" },
      { start_ms: 2100, end_ms: 3200, text: "tudo certo?" },
    ]);
    expect(gravacao?.transcriptStatus).toBe("ready");
    expect(gravacao?.transcriptOrigin).toBe("provider");
    expect(gravacao?.hasTranscript).toBe(true);
    expect(gravacao?.transcriptLanguage).toBe("pt");
    // O resto da nota fica como estava.
    expect(gravacao?.title).toBe("Ideia de domingo");
    expect(gravacao?.text).toBe("");
  });

  it("sem utterances, divide as palavras pela pausa de mais de 0,8 s", async () => {
    const nota = await notaComAudio("Sem utterances");
    const fetchMock = fetchFalso({
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: "Bom dia. Tudo certo?",
                words: [
                  { punctuated_word: "Bom", word: "bom", start: 0.1, end: 0.4 },
                  { punctuated_word: "dia.", word: "dia", start: 0.4, end: 0.9 },
                  // Pausa de 1,1 s: comeca outro trecho.
                  { punctuated_word: "Tudo", word: "tudo", start: 2.0, end: 2.3 },
                  { punctuated_word: "certo?", word: "certo", start: 2.3, end: 2.8 },
                ],
              },
            ],
          },
        ],
      },
    });

    const transcricao = await transcribeWithProvider(nota.id, {
      config: CONFIG,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(transcricao.text).toBe("Bom dia. Tudo certo?");
    expect(transcricao.segments).toEqual([
      { idx: 0, start_ms: 100, end_ms: 900, text: "Bom dia." },
      { idx: 1, start_ms: 2000, end_ms: 2800, text: "Tudo certo?" },
    ]);

    const gravacao = await getRecording(nota.id);
    expect(gravacao?.transcriptSegments).toEqual([
      { start_ms: 100, end_ms: 900, text: "Bom dia." },
      { start_ms: 2000, end_ms: 2800, text: "Tudo certo?" },
    ]);
  });

  it("monta a URL com modelo e idioma e manda a chave so no cabecalho", async () => {
    const nota = await notaComAudio("Idioma");
    const fetchMock = fetchFalso({
      results: { channels: [{ alternatives: [{ transcript: "hello" }] }] },
    });

    await transcribeWithProvider(nota.id, {
      config: CONFIG,
      language: "en",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [alvo, init] = fetchMock.mock.calls[0];
    const url = new URL(String(alvo));
    expect(`${url.origin}${url.pathname}`).toBe("https://api.deepgram.com/v1/listen");
    expect(url.searchParams.get("model")).toBe("nova-2");
    expect(url.searchParams.get("language")).toBe("en");
    expect(url.searchParams.get("smart_format")).toBe("true");
    expect(url.searchParams.get("punctuate")).toBe("true");
    expect(url.searchParams.get("utterances")).toBe("true");
    // A chave nunca pode aparecer na URL, so no cabecalho.
    expect(String(alvo)).not.toContain(CONFIG.apiKey);
    expect(init?.headers).toMatchObject({
      Authorization: `Token ${CONFIG.apiKey}`,
      "Content-Type": "audio/wav",
    });
    expect(init?.body).toBeInstanceOf(Blob);
  });

  it("sem chave pede para salvar em Configuracoes sem chamar a API", async () => {
    const nota = await notaComAudio("Sem chave");
    const fetchMock = fetchFalso({});

    await expect(
      transcribeWithProvider(nota.id, {
        config: { ...CONFIG, apiKey: "" },
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Sem chave da Deepgram. Salve a chave em Configurações para transcrever.");

    expect(fetchMock).not.toHaveBeenCalled();
    const gravacao = await getRecording(nota.id);
    expect(gravacao?.hasTranscript).toBeFalsy();
    expect(gravacao?.transcript).toBeUndefined();
  });

  it("recusa com o status numerico quando a API nega e nao grava", async () => {
    const nota = await notaComAudio("Negada");
    const fetchMock = fetchFalso({ err: "invalid" }, 401);

    let erro: unknown;
    try {
      await transcribeWithProvider(nota.id, {
        config: CONFIG,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
    } catch (falha) {
      erro = falha;
    }

    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toBe("A Deepgram recusou a transcricao (401).");
    // O corpo da resposta pode ecoar a requisicao; a mensagem nao carrega a chave.
    expect((erro as Error).message).not.toContain(CONFIG.apiKey);

    const gravacao = await getRecording(nota.id);
    expect(gravacao?.hasTranscript).toBeFalsy();
    expect(gravacao?.transcript).toBeUndefined();
  });

  it("recusa nota sem audio sem chamar a API", async () => {
    const nota = await local.createEntry({ title: "Só texto" });
    const fetchMock = fetchFalso({});

    await expect(
      transcribeWithProvider(nota.id, {
        config: CONFIG,
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow("esta nota nao tem audio");

    expect(fetchMock).not.toHaveBeenCalled();
    const gravacao = await getRecording(nota.id);
    expect(gravacao?.hasTranscript).toBeFalsy();
  });
});
