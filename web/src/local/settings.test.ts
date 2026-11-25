import { beforeEach, describe, expect, it, vi } from "vitest";

const banco = new Map<string, unknown>();

vi.mock("../lib/idb", () => ({
  STORE_SETTINGS: "settings",
  storeGet: async (_store: string, key: string) => banco.get(key),
  storeSet: async (_store: string, key: string, value: unknown) => {
    banco.set(key, value);
  },
}));

import { loadLocalSettings, localAnalyzeModels, localWhisperModels, saveLocalSettings } from "./settings";

beforeEach(() => {
  banco.clear();
});

describe("ajustes do cofre local", () => {
  it("nasce com os padroes", async () => {
    const settings = await loadLocalSettings();
    expect(settings.transcribe_provider).toBe("whisper");
    expect(settings.analyze_enabled).toBe(false);
    expect(settings.deepgram_api_key_set).toBe(false);
  });

  it("guarda o provedor escolhido e devolve na proxima abertura", async () => {
    await saveLocalSettings({ transcribe_provider: "deepgram", deepgram_model: "nova-3" });
    const settings = await loadLocalSettings();
    expect(settings.transcribe_provider).toBe("deepgram");
    expect(settings.deepgram_model).toBe("nova-3");
  });

  it("guarda a chave sem expor o valor", async () => {
    await saveLocalSettings({ deepgram_api_key: "segredo-123" });
    const settings = await loadLocalSettings();
    expect(settings.deepgram_api_key_set).toBe(true);
    expect(JSON.stringify(settings)).not.toContain("segredo-123");
    expect(JSON.stringify([...banco.values()])).toContain("segredo-123");
  });

  it("chave vazia mantem a que ja existe", async () => {
    await saveLocalSettings({ analyze_api_key: "sk-1" });
    await saveLocalSettings({ analyze_api_key: "" });
    expect((await loadLocalSettings()).analyze_api_key_set).toBe(true);
  });

  it("modelos de analise seguem o provedor escolhido", async () => {
    await saveLocalSettings({
      analyze_provider: "openai",
      analyze_base_url: "https://openrouter.ai/api/v1",
    });
    const modelos = await localAnalyzeModels();
    expect(modelos).toContain("google/gemini-2.5-flash");
  });

  it("modelos de transcricao sao os que rodam no navegador", () => {
    const modelos = localWhisperModels();
    expect(modelos.length).toBeGreaterThan(0);
    expect(modelos[0]).toMatchObject({ downloaded: false, local_bytes: 0 });
  });
});
