/**
 * Catalogo de provedores e de adequacao dos modelos.
 *
 * O /models de cada provedor devolve apenas identificadores; nao existe um
 * campo de qualidade na API. Por isso o rotulo da interface vem daqui: uma
 * lista curada e uma estimativa por familia. Modelo fora do catalogo aparece
 * como "Sem avaliacao" em vez de receber um rotulo inventado.
 *
 * A data abaixo e a ultima revisao deste catalogo. Quando um provedor muda a
 * linha de modelos, revise o mapa e atualize a data.
 */
export const MODEL_CATALOG_UPDATED_AT = "2026-11-05";

export interface ProviderPreset {
  id: string;
  label: string;
  /** Nome curto usado no resumo da secao e nos cartoes. */
  short: string;
  initials: string;
  baseUrl: string;
  model: string;
  /** analyze_provider value stored on the server. */
  kind: string;
  keyPlaceholder?: string;
  links?: { label: string; href: string }[];
  /** Preenchido quando o provedor roda neste servidor. */
  localRuntime?: "ollama" | "embedded";
  /** A chave e necessaria para consultar os modelos. */
  keyRequired: boolean;
  /** A lista de modelos vem do /models do provedor. */
  searchable: boolean;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  llamaLocal: {
    id: "llamaLocal",
    label: "llama.cpp",
    short: "llama.cpp",
    initials: "LL",
    baseUrl: "",
    model: "qwen2.5-0.5b-instruct-q4_k_m",
    kind: "openai",
    links: [{ label: "Modelos GGUF", href: "https://huggingface.co/models?library=gguf" }],
    localRuntime: "embedded",
    keyRequired: false,
    searchable: false,
  },
  ollama: {
    id: "ollama",
    label: "Ollama local",
    short: "Ollama",
    initials: "OL",
    baseUrl: "http://ollama:11434/v1",
    model: "qwen2.5:0.5b",
    kind: "openai",
    links: [{ label: "Modelos", href: "https://ollama.com/library" }],
    localRuntime: "ollama",
    keyRequired: false,
    searchable: false,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    short: "OpenRouter",
    initials: "OR",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemini-2.5-flash",
    kind: "openai",
    keyPlaceholder: "sk-or-v1-...",
    links: [
      { label: "Criar chave", href: "https://openrouter.ai/keys" },
      { label: "Modelos", href: "https://openrouter.ai/models" },
    ],
    keyRequired: true,
    searchable: true,
  },
  opencodeZen: {
    id: "opencodeZen",
    label: "OpenCode Zen",
    short: "OpenCode Zen",
    initials: "OZ",
    baseUrl: "https://opencode.ai/inference/openai/v1",
    model: "glm-5.3-flash-free",
    kind: "openai",
    keyPlaceholder: "chave do OpenCode Console",
    links: [
      { label: "Criar chave", href: "https://opencode.ai/auth" },
      { label: "Modelos", href: "https://opencode.ai/docs/zen/" },
    ],
    keyRequired: true,
    searchable: true,
  },
  opencodeGo: {
    id: "opencodeGo",
    label: "OpenCode Go",
    short: "OpenCode Go",
    initials: "OG",
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
    model: "glm-5.3-flash",
    kind: "openai",
    keyPlaceholder: "chave do OpenCode Console",
    links: [
      { label: "Criar chave", href: "https://opencode.ai/auth" },
      { label: "Modelos", href: "https://opencode.ai/docs/go/" },
    ],
    keyRequired: true,
    searchable: true,
  },
  opencodeLocal: {
    id: "opencodeLocal",
    label: "opencode local",
    short: "opencode local",
    initials: "OC",
    baseUrl: "http://127.0.0.1:49374",
    model: "opencode-go/qwen3.8-flash",
    kind: "opencode",
    links: [{ label: "Como conectar", href: "https://opencode.ai/docs/server/" }],
    keyRequired: false,
    searchable: true,
  },
  google: {
    id: "google",
    label: "Google Gemini",
    short: "Google Gemini",
    initials: "GG",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    kind: "openai",
    keyPlaceholder: "AIza...",
    links: [
      { label: "Criar chave", href: "https://aistudio.google.com/app/apikey" },
      { label: "Modelos", href: "https://ai.google.dev/gemini-api/docs/models" },
    ],
    keyRequired: true,
    searchable: true,
  },
  groq: {
    id: "groq",
    label: "Groq",
    short: "Groq",
    initials: "GQ",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    kind: "openai",
    keyPlaceholder: "gsk_...",
    links: [
      { label: "Criar chave", href: "https://console.groq.com/keys" },
      { label: "Modelos", href: "https://console.groq.com/docs/models" },
    ],
    keyRequired: true,
    searchable: true,
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    short: "DeepSeek",
    initials: "DS",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    kind: "openai",
    keyPlaceholder: "sk-...",
    links: [
      { label: "Criar chave", href: "https://platform.deepseek.com/api_keys" },
      { label: "Modelos", href: "https://api-docs.deepseek.com/quick_start/pricing" },
    ],
    keyRequired: true,
    searchable: true,
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    short: "Mistral",
    initials: "MI",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    kind: "openai",
    links: [
      { label: "Criar chave", href: "https://console.mistral.ai/api-keys/" },
      { label: "Modelos", href: "https://docs.mistral.ai/getting-started/models/models_overview/" },
    ],
    keyRequired: true,
    searchable: true,
  },
  xai: {
    id: "xai",
    label: "xAI Grok",
    short: "xAI Grok",
    initials: "XA",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-3-mini",
    kind: "openai",
    keyPlaceholder: "xai-...",
    links: [
      { label: "Criar chave", href: "https://console.x.ai/" },
      { label: "Modelos", href: "https://docs.x.ai/docs/models" },
    ],
    keyRequired: true,
    searchable: true,
  },
  custom: {
    id: "custom",
    label: "Personalizado",
    short: "Personalizado",
    initials: "PC",
    baseUrl: "",
    model: "",
    kind: "openai",
    keyRequired: false,
    searchable: true,
  },
};

/** Ordem dos cartoes na secao de analise. Locais primeiro. */
export const LOCAL_PROVIDER_IDS = ["llamaLocal", "ollama"];
export const CLOUD_PROVIDER_IDS = [
  "openrouter",
  "opencodeZen",
  "opencodeGo",
  "google",
  "groq",
  "deepseek",
  "mistral",
  "xai",
  "opencodeLocal",
  "custom",
];

export const TRANSCRIBE_PROVIDERS: Record<"whisper" | "deepgram", ProviderPreset> = {
  whisper: {
    id: "whisper",
    label: "Whisper local",
    short: "Whisper",
    initials: "WH",
    baseUrl: "",
    model: "",
    kind: "whisper",
    keyRequired: false,
    searchable: false,
  },
  deepgram: {
    id: "deepgram",
    label: "Deepgram",
    short: "Deepgram",
    initials: "DG",
    baseUrl: "",
    model: "nova-3",
    kind: "deepgram",
    links: [{ label: "Modelos e precos", href: "https://developers.deepgram.com/docs/models-languages-overview" }],
    keyRequired: true,
    searchable: false,
  },
};

// A analise fala o formato /chat/completions. Google Gemini entra pelo endpoint
// compativel com OpenAI; provedores com formato proprio (Anthropic, Responses)
// so aparecem atraves de um gateway como OpenRouter ou OpenCode. Por isso a
// lista de modelos e curada onde o /models nao diz o formato de cada um.
const ZEN_MODELS = [
  "glm-5.3-flash-free",
  "glm-5.3-flash",
  "kimi-k2.7-code",
  "space-bunny-free",
  "deepseek-v4.1-flash-free",
  "deepseek-v4.1-flash",
  "qwen3.8-max",
  "minimax-m3",
];

const GO_MODELS = [
  "glm-5.3-flash",
  "kimi-k2.7-code",
  "space-bunny",
  "deepseek-v4.1-flash",
  "deepseek-v4-pro",
  "glm-5.3",
  "longcat-2.0",
  "hy3",
];

const OPENCODE_MODELS = [
  "opencode-go/qwen3.8-flash",
  "opencode-go/glm-5.3-flash",
  "opencode-go/claude-haiku-5-5",
  "opencode-go/gpt-6-luna",
  "deepseek/deepseek-chat",
];

export const FALLBACK_MODELS: Record<string, string[]> = {
  opencodeZen: ZEN_MODELS,
  opencodeGo: GO_MODELS,
  opencodeLocal: OPENCODE_MODELS,
  openrouter: [
    "google/gemini-2.5-flash",
    "openai/gpt-4.1-mini",
    "anthropic/claude-sonnet-4",
    "deepseek/deepseek-chat-v3.1",
  ],
  google: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  groq: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "qwen/qwen3-32b"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  mistral: ["mistral-small-latest", "mistral-large-latest", "open-mistral-nemo"],
  xai: ["grok-3-mini", "grok-3", "grok-4-fast"],
  llamaLocal: [],
  ollama: [],
  custom: [],
};

// Modelos que pensam antes de responder. Nao servem de padrao para analisar
// notas: gastam o teto de tokens raciocinando e demoram mais. A interface os
// marca para o usuario escolher com o custo na frente.
const REASONING_MODELS = new Set([
  "deepseek-v4.1-flash-free",
  "deepseek-v4.1-flash",
  "deepseek-v4-pro",
  "glm-5.3",
  "longcat-2.0",
  "qwen3.8-max",
  "minimax-m3",
  "hy3",
]);

const REASONING_PATTERN = /(^|[/_.-])(r1|reasoner|reasoning|thinking|o1|o3|o4)([/_.-]|$)/;

export interface ModelQuality {
  /** 0 = sem avaliacao; 1 = basico; 2 = bom; 3 = melhor. */
  score: 0 | 1 | 2 | 3;
  label: "Melhor" | "Bom" | "Básico" | "Sem avaliação";
  /** Uma linha curta sobre o ponto forte ou o custo. */
  note: string;
  cost: "" | "$" | "$$" | "$$$" | "grátis" | "local";
  speed: "" | "rápido" | "médio" | "lento";
  reasoning: boolean;
}

const UNKNOWN_QUALITY: ModelQuality = {
  score: 0,
  label: "Sem avaliação",
  note: "fora do catálogo",
  cost: "",
  speed: "",
  reasoning: false,
};

/**
 * Avaliacao curada dos modelos mais comuns. O foco e analisar notas em
 * portugues: seguir instrucoes, resumir texto longo e devolver JSON estavel.
 * Nao e um ranking geral de inteligencia.
 */
const MODEL_QUALITY: Record<string, Partial<ModelQuality>> = {
  "google/gemini-2.5-flash": { score: 2, label: "Bom", note: "rápido e barato", cost: "$", speed: "rápido" },
  "gemini-2.5-flash": { score: 2, label: "Bom", note: "rápido e barato", cost: "$", speed: "rápido" },
  "google/gemini-2.5-pro": { score: 3, label: "Melhor", note: "texto longo", cost: "$$$", speed: "médio" },
  "gemini-2.5-pro": { score: 3, label: "Melhor", note: "texto longo", cost: "$$$", speed: "médio" },
  "google/gemini-2.0-flash": { score: 2, label: "Bom", note: "rápido e barato", cost: "$", speed: "rápido" },
  "gemini-2.0-flash": { score: 2, label: "Bom", note: "rápido e barato", cost: "$", speed: "rápido" },
  "openai/gpt-4.1-mini": { score: 2, label: "Bom", note: "equilibrado", cost: "$$", speed: "rápido" },
  "gpt-4.1-mini": { score: 2, label: "Bom", note: "equilibrado", cost: "$$", speed: "rápido" },
  "openai/gpt-4.1": { score: 3, label: "Melhor", note: "texto longo", cost: "$$$", speed: "médio" },
  "gpt-4.1": { score: 3, label: "Melhor", note: "texto longo", cost: "$$$", speed: "médio" },
  "anthropic/claude-sonnet-4": { score: 3, label: "Melhor", note: "texto longo", cost: "$$$", speed: "médio" },
  "claude-sonnet-4": { score: 3, label: "Melhor", note: "texto longo", cost: "$$$", speed: "médio" },
  "anthropic/claude-haiku-5-5": { score: 2, label: "Bom", note: "rápido", cost: "$$", speed: "rápido" },
  "deepseek/deepseek-chat-v3.1": { score: 2, label: "Bom", note: "barato", cost: "$", speed: "rápido" },
  "deepseek-chat": { score: 2, label: "Bom", note: "barato", cost: "$", speed: "rápido" },
  "deepseek/deepseek-r1": {
    score: 3,
    label: "Melhor",
    note: "pensa antes de responder",
    cost: "$$",
    speed: "lento",
    reasoning: true,
  },
  "deepseek-reasoner": {
    score: 3,
    label: "Melhor",
    note: "pensa antes de responder",
    cost: "$$",
    speed: "lento",
    reasoning: true,
  },
  "meta-llama/llama-3.3-70b-instruct": { score: 2, label: "Bom", note: "aberto", cost: "$", speed: "médio" },
  "llama-3.3-70b-versatile": { score: 2, label: "Bom", note: "aberto e rápido", cost: "$", speed: "rápido" },
  "openai/gpt-oss-120b": { score: 2, label: "Bom", note: "aberto", cost: "$", speed: "rápido" },
  "qwen/qwen3-32b": { score: 2, label: "Bom", note: "aberto", cost: "$", speed: "médio" },
  "mistral-small-latest": { score: 2, label: "Bom", note: "rápido", cost: "$", speed: "rápido" },
  "mistral-large-latest": { score: 3, label: "Melhor", note: "texto longo", cost: "$$", speed: "médio" },
  "open-mistral-nemo": { score: 1, label: "Básico", note: "leve", cost: "$", speed: "rápido" },
  "grok-3-mini": { score: 2, label: "Bom", note: "rápido", cost: "$", speed: "rápido" },
  "grok-3": { score: 3, label: "Melhor", note: "texto longo", cost: "$$", speed: "médio" },
  "grok-4-fast": { score: 3, label: "Melhor", note: "rápido", cost: "$$", speed: "rápido" },
  "glm-5.3-flash-free": { score: 2, label: "Bom", note: "grátis", cost: "grátis", speed: "rápido" },
  "glm-5.3-flash": { score: 2, label: "Bom", note: "rápido", cost: "$", speed: "rápido" },
  "glm-5.3": {
    score: 3,
    label: "Melhor",
    note: "pensa antes de responder",
    cost: "$$",
    speed: "lento",
    reasoning: true,
  },
  "kimi-k2.7-code": { score: 2, label: "Bom", note: "texto técnico", cost: "$", speed: "médio" },
  "space-bunny-free": { score: 2, label: "Bom", note: "grátis", cost: "grátis", speed: "rápido" },
  "space-bunny": { score: 2, label: "Bom", note: "rápido", cost: "$", speed: "rápido" },
  "deepseek-v4.1-flash-free": {
    score: 3,
    label: "Melhor",
    note: "grátis, mas pensa",
    cost: "grátis",
    speed: "lento",
    reasoning: true,
  },
  "deepseek-v4.1-flash": {
    score: 3,
    label: "Melhor",
    note: "pensa antes de responder",
    cost: "$",
    speed: "lento",
    reasoning: true,
  },
  "deepseek-v4-pro": {
    score: 3,
    label: "Melhor",
    note: "pensa antes de responder",
    cost: "$$",
    speed: "lento",
    reasoning: true,
  },
  "qwen3.8-max": {
    score: 3,
    label: "Melhor",
    note: "pensa antes de responder",
    cost: "$$$",
    speed: "lento",
    reasoning: true,
  },
  "minimax-m3": {
    score: 3,
    label: "Melhor",
    note: "pensa antes de responder",
    cost: "$$",
    speed: "lento",
    reasoning: true,
  },
  "longcat-2.0": {
    score: 3,
    label: "Melhor",
    note: "pensa antes de responder",
    cost: "$$",
    speed: "lento",
    reasoning: true,
  },
  hy3: {
    score: 3,
    label: "Melhor",
    note: "pensa antes de responder",
    cost: "$$",
    speed: "lento",
    reasoning: true,
  },
  "opencode-go/qwen3.8-flash": { score: 2, label: "Bom", note: "rápido", cost: "$", speed: "rápido" },
  "opencode-go/glm-5.3-flash": { score: 2, label: "Bom", note: "rápido", cost: "$", speed: "rápido" },
  "opencode-go/claude-haiku-5-5": { score: 2, label: "Bom", note: "rápido", cost: "$$", speed: "rápido" },
  "opencode-go/gpt-6-luna": { score: 3, label: "Melhor", note: "texto longo", cost: "$$", speed: "médio" },
  "deepseek/deepseek-chat": { score: 2, label: "Bom", note: "barato", cost: "$", speed: "rápido" },
  "qwen2.5:0.5b": { score: 1, label: "Básico", note: "modelo pequeno", cost: "local", speed: "rápido" },
  "qwen2.5-0.5b-instruct-q4_k_m": {
    score: 1,
    label: "Básico",
    note: "modelo pequeno",
    cost: "local",
    speed: "rápido",
  },
};

export function isLocalProvider(providerId: string): boolean {
  return Boolean(PROVIDER_PRESETS[providerId]?.localRuntime);
}

export function providerFromSettings(kind: string, baseUrl: string, localRuntime: string): string {
  if (localRuntime === "embedded") return "llamaLocal";
  if (localRuntime === "ollama") return "ollama";
  if (kind === "opencode") return "opencodeLocal";
  if (baseUrl.includes("opencode.ai/inference/go/")) return "opencodeGo";
  if (baseUrl.includes("opencode.ai/inference/")) return "opencodeZen";
  if (baseUrl.includes("openrouter.ai")) return "openrouter";
  if (baseUrl.includes("generativelanguage.googleapis.com")) return "google";
  if (baseUrl.includes("api.groq.com")) return "groq";
  if (baseUrl.includes("deepseek")) return "deepseek";
  if (baseUrl.includes("api.mistral.ai")) return "mistral";
  if (baseUrl.includes("api.x.ai")) return "xai";
  if (baseUrl.includes("ollama") || baseUrl.includes("11434")) return "ollama";
  return "custom";
}

export function localRuntimeOf(providerId: string): "ollama" | "embedded" | null {
  return PROVIDER_PRESETS[providerId]?.localRuntime ?? null;
}

export function canSearchModels(providerId: string): boolean {
  return PROVIDER_PRESETS[providerId]?.searchable ?? false;
}

/** Uma estimativa por familia, para o /models que devolve so o identificador. */
function familyQuality(model: string): ModelQuality {
  const lower = model.toLowerCase();
  const reasoning = REASONING_MODELS.has(model) || REASONING_PATTERN.test(lower);

  let score: ModelQuality["score"] = 0;
  let label: ModelQuality["label"] = "Sem avaliação";
  if (/0\.5b|(^|[/_.-])1b|1\.5b|tiny|nano/.test(lower)) {
    score = 1;
    label = "Básico";
  } else if (/opus|sonnet|gpt-5|gemini-2\.5-pro|gemini-3|mistral-large|grok-3|grok-4|70b|120b|405b|max/.test(lower)) {
    score = 3;
    label = "Melhor";
  } else if (/flash|mini|haiku|small|7b|8b|9b|32b|nemo|air|chat|instruct|versatile/.test(lower)) {
    score = 2;
    label = "Bom";
  }

  const cost: ModelQuality["cost"] = lower.includes("free")
    ? "grátis"
    : /opus|pro|large|max/.test(lower)
      ? "$$$"
      : /flash|mini|small|haiku|nano|r1|7b|8b/.test(lower)
        ? "$"
        : "$$";
  const speed: ModelQuality["speed"] = reasoning
    ? "lento"
    : /flash|mini|haiku|nano|0\.5b|7b|8b|tiny/.test(lower)
      ? "rápido"
      : "médio";

  return {
    score,
    label,
    note: score === 0 ? "fora do catálogo" : "estimativa por família",
    cost,
    speed,
    reasoning,
  };
}

export function qualityOf(providerId: string, model: string): ModelQuality {
  const exact = MODEL_QUALITY[model.trim().toLowerCase()];
  if (exact) {
    return { ...UNKNOWN_QUALITY, ...exact };
  }
  if (isLocalProvider(providerId)) {
    const local = familyQuality(model);
    return { ...local, cost: "local" };
  }
  return familyQuality(model);
}

export function recommendedModel(providerId: string): string {
  return PROVIDER_PRESETS[providerId]?.model ?? "";
}

export function providerLabel(providerId: string): string {
  return PROVIDER_PRESETS[providerId]?.label ?? providerId;
}

/** Nome curto de um modelo ggml a partir do caminho do arquivo. */
export function whisperModelLabel(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file
    .replace(/^ggml-/, "")
    .replace(/\.bin$/, "")
    .replace(/-q\d.*$/, "");
}

export function whisperQuality(name: string): ModelQuality {
  const lower = name.toLowerCase();
  if (lower.includes("large")) {
    return { score: 3, label: "Melhor", note: "mais preciso", cost: "local", speed: "lento", reasoning: false };
  }
  if (lower.includes("medium")) {
    return { score: 2, label: "Bom", note: "equilíbrio", cost: "local", speed: "médio", reasoning: false };
  }
  if (lower.includes("small")) {
    return { score: 2, label: "Bom", note: "equilíbrio", cost: "local", speed: "rápido", reasoning: false };
  }
  if (lower.includes("base") || lower.includes("tiny")) {
    return { score: 1, label: "Básico", note: "mais leve", cost: "local", speed: "rápido", reasoning: false };
  }
  return { ...UNKNOWN_QUALITY, note: "fora do catálogo" };
}

export function deepgramQuality(model: string): ModelQuality {
  const lower = model.toLowerCase();
  if (lower === "nova-3") {
    return { score: 3, label: "Melhor", note: "mais novo", cost: "", speed: "", reasoning: false };
  }
  if (lower === "nova-2" || lower === "nova-1") {
    return { score: 2, label: "Bom", note: "geração anterior", cost: "", speed: "", reasoning: false };
  }
  if (lower === "enhanced" || lower === "base") {
    return { score: 1, label: "Básico", note: "mais leve", cost: "", speed: "", reasoning: false };
  }
  return { ...UNKNOWN_QUALITY, note: "fora do catálogo" };
}

export const DEEPGRAM_MODELS = ["nova-3", "nova-2", "nova-1", "enhanced", "base"];
export const DEEPGRAM_KEY_URL = "https://console.deepgram.com/";
export const DEEPGRAM_MODELS_URL = "https://developers.deepgram.com/docs/models-languages-overview";
export const WHISPER_CATALOG_URL = "https://huggingface.co/ggerganov/whisper.cpp/tree/main";
