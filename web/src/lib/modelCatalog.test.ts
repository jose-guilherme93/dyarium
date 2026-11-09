import { describe, expect, it } from "vitest";
import {
  CLOUD_PROVIDER_IDS,
  DEEPGRAM_MODELS,
  FALLBACK_MODELS,
  LOCAL_PROVIDER_IDS,
  PROVIDER_PRESETS,
  canSearchModels,
  deepgramQuality,
  isLocalProvider,
  localRuntimeOf,
  providerFromSettings,
  providerLabel,
  qualityOf,
  recommendedModel,
  whisperModelLabel,
  whisperQuality,
} from "./modelCatalog";

describe("catalogo de provedores", () => {
  it("todo preset se identifica pelo proprio id e preenche os campos do cartao", () => {
    for (const [id, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(preset.id).toBe(id);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.short.length).toBeGreaterThan(0);
      expect(preset.initials.length).toBeGreaterThan(0);
      expect(typeof preset.baseUrl).toBe("string");
      expect(typeof preset.model).toBe("string");
      expect(typeof preset.keyRequired).toBe("boolean");
      expect(typeof preset.searchable).toBe("boolean");
    }
  });

  it("ids locais e de nuvem particionam o catalogo sem repetir", () => {
    const allIds = Object.keys(PROVIDER_PRESETS);
    const local = new Set(LOCAL_PROVIDER_IDS);
    const cloud = new Set(CLOUD_PROVIDER_IDS);

    expect([...LOCAL_PROVIDER_IDS, ...CLOUD_PROVIDER_IDS].sort()).toEqual([...allIds].sort());
    for (const id of LOCAL_PROVIDER_IDS) {
      expect(cloud.has(id)).toBe(false);
      expect(PROVIDER_PRESETS[id].localRuntime).toBeDefined();
    }
    for (const id of CLOUD_PROVIDER_IDS) {
      expect(local.has(id)).toBe(false);
      expect(PROVIDER_PRESETS[id].localRuntime).toBeUndefined();
    }
  });

  it("todo link de preset tem rotulo e endereco https", () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      for (const link of preset.links ?? []) {
        expect(link.label.length).toBeGreaterThan(0);
        expect(link.href.startsWith("https://")).toBe(true);
      }
    }
  });
});

describe("provedores locais e busca de modelos", () => {
  it("isLocalProvider marca so os ids locais", () => {
    for (const id of LOCAL_PROVIDER_IDS) {
      expect(isLocalProvider(id)).toBe(true);
    }
    for (const id of CLOUD_PROVIDER_IDS) {
      expect(isLocalProvider(id)).toBe(false);
    }
    expect(isLocalProvider("nao-existe")).toBe(false);
  });

  it("localRuntimeOf devolve o runtime declarado no preset", () => {
    for (const [id, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(localRuntimeOf(id)).toBe(preset.localRuntime ?? null);
    }
    expect(localRuntimeOf("nao-existe")).toBeNull();
  });

  it("canSearchModels concorda com o campo searchable", () => {
    for (const [id, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(canSearchModels(id)).toBe(preset.searchable);
    }
    expect(canSearchModels("nao-existe")).toBe(false);
    expect(canSearchModels("whisper")).toBe(false);
  });
});

describe("providerFromSettings", () => {
  it("faz ida e volta com todo preset do catalogo", () => {
    for (const [id, preset] of Object.entries(PROVIDER_PRESETS)) {
      const mapped = providerFromSettings(preset.kind, preset.baseUrl, preset.localRuntime ?? "");
      expect(mapped).toBe(id);
      expect(localRuntimeOf(mapped)).toBe(localRuntimeOf(id));
    }
  });

  it("cai no personalizado para base vazia ou desconhecida", () => {
    expect(providerFromSettings("openai", "", "")).toBe("custom");
    expect(providerFromSettings("openai", "https://gateway.example/v1", "")).toBe("custom");
    expect(providerFromSettings("formato-estranho", "", "")).toBe("custom");
  });

  it("runtime local vence a base URL", () => {
    expect(providerFromSettings("openai", "https://openrouter.ai/api/v1", "embedded")).toBe("llamaLocal");
    expect(providerFromSettings("openai", "https://gateway.example/v1", "ollama")).toBe("ollama");
  });

  it("preset local sem runtime depende da base URL", () => {
    // llamaLocal so e reconhecido pelo runtime embedded: sem ele a base vazia cai no personalizado.
    expect(providerFromSettings("openai", "", "")).toBe("custom");
    // O preset do ollama tem base reconhecivel, entao volta mesmo sem o runtime.
    expect(providerFromSettings("openai", PROVIDER_PRESETS.ollama.baseUrl, "")).toBe("ollama");
  });

  it("distingue os provedores openai pela base URL", () => {
    const cases: Array<[string, string]> = [
      ["https://openrouter.ai/api/v1", "openrouter"],
      ["https://opencode.ai/inference/openai/v1", "opencodeZen"],
      ["https://opencode.ai/inference/go/openai/v1", "opencodeGo"],
      ["https://generativelanguage.googleapis.com/v1beta/openai", "google"],
      ["https://api.groq.com/openai/v1", "groq"],
      ["https://api.deepseek.com/v1", "deepseek"],
      ["https://api.mistral.ai/v1", "mistral"],
      ["https://api.x.ai/v1", "xai"],
      ["https://gateway.example/v1", "custom"],
    ];
    for (const [baseUrl, expected] of cases) {
      expect(providerFromSettings("openai", baseUrl, "")).toBe(expected);
    }
  });

  it("reconhece ollama pela porta mesmo sem runtime", () => {
    expect(providerFromSettings("openai", "http://localhost:11434/v1", "")).toBe("ollama");
  });
});

describe("avaliacao de modelos", () => {
  it("devolve a nota curada de um modelo conhecido", () => {
    expect(qualityOf("openrouter", "google/gemini-2.5-flash")).toEqual({
      score: 2,
      label: "Bom",
      note: "rápido e barato",
      cost: "$",
      speed: "rápido",
      reasoning: false,
    });
  });

  it("aceita espacos e maiusculas no identificador", () => {
    expect(qualityOf("openrouter", " Google/Gemini-2.5-Flash ").score).toBe(2);
    expect(qualityOf("openrouter", " Google/Gemini-2.5-Flash ").label).toBe("Bom");
  });

  it("nao inventa nota para modelo fora do catalogo", () => {
    // Sem nota, mas a estimativa por familia ainda preenche custo e velocidade padrao.
    expect(qualityOf("openrouter", "modelo-fora-do-catalogo-zzz")).toMatchObject({
      score: 0,
      label: "Sem avaliação",
      note: "fora do catálogo",
      cost: "$$",
      speed: "médio",
      reasoning: false,
    });
  });

  it("estima pela familia quando o nome traz um tamanho reconhecivel", () => {
    expect(qualityOf("openrouter", "acme/llama-8b-instruct")).toMatchObject({
      score: 2,
      label: "Bom",
      note: "estimativa por família",
      cost: "$",
      speed: "rápido",
      reasoning: false,
    });
  });

  it("modelo local desconhecido continua sem nota e com custo local", () => {
    expect(qualityOf("ollama", "modelo-fora-do-catalogo-zzz")).toMatchObject({
      score: 0,
      label: "Sem avaliação",
      note: "fora do catálogo",
      cost: "local",
      reasoning: false,
    });
    expect(qualityOf("ollama", "qwen2.5:0.5b")).toMatchObject({
      score: 1,
      label: "Básico",
      cost: "local",
      speed: "rápido",
    });
  });

  it("marca modelos que pensam antes de responder", () => {
    expect(qualityOf("deepseek", "deepseek-reasoner")).toMatchObject({
      score: 3,
      label: "Melhor",
      speed: "lento",
      reasoning: true,
    });
    expect(qualityOf("openrouter", "openai/o3-mini")).toMatchObject({
      score: 2,
      label: "Bom",
      speed: "lento",
      reasoning: true,
    });
  });

  it("todo modelo de reserva devolve nota valida e reasoning booleano", () => {
    for (const [providerId, models] of Object.entries(FALLBACK_MODELS)) {
      for (const model of models) {
        const quality = qualityOf(providerId, model);
        expect(quality.score).toBeGreaterThanOrEqual(0);
        expect(quality.score).toBeLessThanOrEqual(3);
        expect(typeof quality.reasoning).toBe("boolean");
      }
    }
  });
});

describe("modelo recomendado e rotulo", () => {
  it("recomenda um modelo do catalogo de reserva em cada nuvem", () => {
    for (const id of CLOUD_PROVIDER_IDS) {
      const model = recommendedModel(id);
      if (id === "custom") {
        expect(model).toBe("");
      } else {
        expect(FALLBACK_MODELS[id]).toContain(model);
      }
    }
  });

  it("todo preset tem modelo recomendado, exceto o personalizado", () => {
    for (const [id, preset] of Object.entries(PROVIDER_PRESETS)) {
      if (id === "custom") {
        expect(recommendedModel(id)).toBe("");
      } else {
        expect(recommendedModel(id)).toBe(preset.model);
        expect(recommendedModel(id).length).toBeGreaterThan(0);
      }
    }
  });

  it("nao lanca para provedor sem preset e cai no proprio id", () => {
    expect(recommendedModel("nao-existe")).toBe("");
    expect(providerLabel("openrouter")).toBe("OpenRouter");
    expect(providerLabel("custom")).toBe("Personalizado");
    expect(providerLabel("nao-existe")).toBe("nao-existe");
  });
});

describe("nome do modelo whisper", () => {
  it("normaliza caminho do ggml com quantizacao", () => {
    expect(whisperModelLabel("models/ggml-small-q5_1.bin")).toBe("small");
    expect(whisperModelLabel("/data/models/ggml-medium-q8_0.bin")).toBe("medium");
    expect(whisperModelLabel("ggml-large-v3-turbo-q5_0.bin")).toBe("large-v3-turbo");
  });

  it("aceita nome sem diretorio, sem prefixo e sem quantizacao", () => {
    expect(whisperModelLabel("ggml-base.bin")).toBe("base");
    expect(whisperModelLabel("small")).toBe("small");
    expect(whisperModelLabel("large-v3-turbo.bin")).toBe("large-v3-turbo");
    expect(whisperModelLabel("ggml-tiny.en.bin")).toBe("tiny.en");
  });

  it("devolve vazio para caminho vazio", () => {
    expect(whisperModelLabel("")).toBe("");
  });
});

describe("qualidade do whisper", () => {
  it("cresce com o tamanho do modelo", () => {
    expect(whisperQuality("tiny")).toMatchObject({ score: 1, label: "Básico", cost: "local" });
    expect(whisperQuality("base")).toMatchObject({ score: 1, label: "Básico", cost: "local" });
    expect(whisperQuality("small")).toMatchObject({ score: 2, label: "Bom", cost: "local" });
    expect(whisperQuality("medium")).toMatchObject({ score: 2, label: "Bom", cost: "local" });
    expect(whisperQuality("large-v3-turbo")).toMatchObject({ score: 3, label: "Melhor", cost: "local" });
    expect(whisperQuality("tiny").score).toBeLessThan(whisperQuality("small").score);
    expect(whisperQuality("small").score).toBeLessThan(whisperQuality("large-v3-turbo").score);
    expect(whisperQuality("medium").score).toBeLessThanOrEqual(whisperQuality("large-v3-turbo").score);
    for (const name of ["tiny", "base", "small", "medium", "large-v3-turbo"]) {
      expect(whisperQuality(name).reasoning).toBe(false);
    }
  });

  it("fora do catalogo fica sem avaliacao", () => {
    expect(whisperQuality("ggml-xyz")).toMatchObject({
      score: 0,
      label: "Sem avaliação",
      note: "fora do catálogo",
      cost: "",
      speed: "",
      reasoning: false,
    });
  });
});

describe("qualidade do deepgram", () => {
  it("classifica cada modelo oferecido", () => {
    expect(deepgramQuality("nova-3")).toMatchObject({ score: 3, label: "Melhor", reasoning: false });
    expect(deepgramQuality("nova-2")).toMatchObject({ score: 2, label: "Bom", reasoning: false });
    expect(deepgramQuality("nova-1")).toMatchObject({ score: 2, label: "Bom", reasoning: false });
    expect(deepgramQuality("enhanced")).toMatchObject({ score: 1, label: "Básico", reasoning: false });
    expect(deepgramQuality("base")).toMatchObject({ score: 1, label: "Básico", reasoning: false });
    for (const model of DEEPGRAM_MODELS) {
      const quality = deepgramQuality(model);
      expect(quality.label).not.toBe("Sem avaliação");
      expect(quality.score).toBeGreaterThanOrEqual(1);
      expect(quality.score).toBeLessThanOrEqual(3);
    }
  });

  it("aceita maiusculas", () => {
    expect(deepgramQuality("NOVA-3")).toMatchObject({ score: 3, label: "Melhor" });
  });

  it("fora do catalogo fica sem avaliacao", () => {
    expect(deepgramQuality("nova-4")).toMatchObject({
      score: 0,
      label: "Sem avaliação",
      note: "fora do catálogo",
      cost: "",
      speed: "",
      reasoning: false,
    });
  });
});
