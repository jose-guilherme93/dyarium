/**
 * Catalogo dos modelos que rodam no navegador.
 *
 * O worker do dashboard usa os mesmos GGUFs do app (llama.cpp via wllama) para a
 * analise e o Whisper em ONNX via transformers.js para a transcricao. Os
 * tamanhos sao os do arquivo real no Hugging Face: a tela mostra o total antes
 * de baixar, porque o download e do usuario, nao do servidor.
 *
 * Nada aqui chama API de terceiros. O Hugging Face entrega apenas pesos
 * publicos; o texto da nota nunca sai do computador.
 */

export type ProcessingTier = 0 | 1 | 2 | 3 | 4;

export interface WhisperModel {
  id: string;
  label: string;
  /** Repositorio ONNX consumido pelo transformers.js. */
  repo: string;
  /** Revisao fixa: pesos e arquivos nao mudam sem o catalogo mudar junto. */
  revision: string;
  /** Soma dos arquivos que o runtime baixa (encoder, decoder, tokenizer). */
  sizeBytes: number;
  license: string;
  note: string;
}

export interface LlmShard {
  file: string;
  sizeBytes: number;
  sha256: string;
}

export interface LlmModel {
  id: string;
  label: string;
  repo: string;
  /** Revisao fixa: o arquivo nao muda sem o catalogo mudar junto. */
  revision: string;
  /** Primeiro arquivo do GGUF (o wllama acha os demais shards sozinho). */
  file: string;
  sizeBytes: number;
  shards: LlmShard[];
  license: string;
  note: string;
}

export interface BrowserPlan {
  tier: ProcessingTier;
  label: string;
  /** Perfil de hardware que o tier atende. */
  hardware: string;
  whisper: WhisperModel;
  llm: LlmModel;
  /** Contexto do llama.cpp. O bloco e pequeno; o contexto cobre o prompt. */
  contextSize: number;
}

const GB = 1024 ** 3;

export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: "whisper-base",
    label: "Whisper base",
    repo: "onnx-community/whisper-base",
    revision: "1846881b6b3a3024392c1eea3ad983695bc23925",
    sizeBytes: 80 * 1024 * 1024,
    license: "MIT",
    note: "Rápido em CPU. Prefira um modelo maior quando a máquina permitir.",
  },
  {
    id: "whisper-small",
    label: "Whisper small",
    repo: "onnx-community/whisper-small",
    revision: "36050c46d777d46dc4b5f43f6d90574fc38f8732",
    sizeBytes: 252 * 1024 * 1024,
    license: "MIT",
    note: "Bom equilíbrio entre qualidade e tempo em GPU integrada.",
  },
  {
    id: "whisper-large-v3-turbo",
    label: "Whisper large v3 turbo",
    repo: "onnx-community/whisper-large-v3-turbo",
    revision: "360ebcde2559d60bb474678be3c1de9ef347d01a",
    sizeBytes: 1_087 * 1024 * 1024,
    license: "MIT",
    note: "A melhor transcrição do catálogo. Precisa de GPU com memória.",
  },
];

export const LLM_MODELS: LlmModel[] = [
  {
    id: "lfm2.5-230m-q5",
    label: "LFM2.5 230M qualidade",
    repo: "LiquidAI/LFM2.5-230M-GGUF",
    revision: "03502067c64ce32ac4fe87b0cec0310a1a13d3e9",
    file: "LFM2.5-230M-Q5_K_M.gguf",
    sizeBytes: 171_625_312,
    shards: [
      {
        file: "LFM2.5-230M-Q5_K_M.gguf",
        sizeBytes: 171_625_312,
        sha256: "65bceea824d701506de53f02d7276578a64706ad9c17f00d6e8917bf491de6db",
      },
    ],
    license: "LFM Open License v1.0",
    note: "O mais leve do catálogo. A extração fica limitada; prefira um perfil maior quando a máquina permitir.",
  },
  {
    id: "qwen3.5-0.8b-q5",
    label: "Qwen3.5 0.8B qualidade",
    repo: "unsloth/Qwen3.5-0.8B-GGUF",
    revision: "6ab461498e2023f6e3c1baea90a8f0fe38ab64d0",
    file: "Qwen3.5-0.8B-Q5_K_M.gguf",
    sizeBytes: 590_057_728,
    shards: [
      {
        file: "Qwen3.5-0.8B-Q5_K_M.gguf",
        sizeBytes: 590_057_728,
        sha256: "c3ef5827b322c4be08a3a26ce424460d8b37daf593356c2cc1f4e40a7ab0581b",
      },
    ],
    license: "Apache-2.0",
    note: "Um passo acima do 230M sem exigir GPU dedicada.",
  },
  {
    id: "qwen3.5-2b-q4",
    label: "Qwen3.5 2B rápida",
    repo: "unsloth/Qwen3.5-2B-GGUF",
    revision: "f6d5376be1edb4d416d56da11e5397a961aca8ae",
    file: "Qwen3.5-2B-Q4_0.gguf",
    sizeBytes: 1_214_873_856,
    shards: [
      {
        file: "Qwen3.5-2B-Q4_0.gguf",
        sizeBytes: 1_214_873_856,
        sha256: "cd70221bebaee0503e0f6717e174250cd7825aa88438b3aabec9ad55731d9bb1",
      },
    ],
    license: "Apache-2.0",
    note: "Mais leitura por bloco em PCs com 3 GB de VRAM ou 8 GB de RAM.",
  },
  {
    id: "lfm2.5-2.6b-q5",
    label: "LFM2.5 2.6B qualidade",
    repo: "LiquidAI/LFM2.5-2.6B-GGUF",
    revision: "e7caca5d835a3901a8e0d63e94009429bafafdfc",
    file: "LFM2.5-2.6B-Q5_K_M.gguf",
    sizeBytes: 1_939_744_768,
    shards: [
      {
        file: "LFM2.5-2.6B-Q5_K_M.gguf",
        sizeBytes: 1_939_744_768,
        sha256: "17ce54cc676e15e572adebfeeed8da6abd12b0f68d595be19b59e662476c21b3",
      },
    ],
    license: "LFM Open License v1.0",
    note: "Leitura densa com download abaixo de 2 GB. A melhor opção em GPU de 8 GB.",
  },
  {
    id: "qwen2.5-7b-q4",
    label: "Qwen2.5 7B qualidade máxima",
    repo: "Qwen/Qwen2.5-7B-Instruct-GGUF",
    revision: "bb5d59e06d9551d752d08b292a50eb208b07ab1f",
    file: "qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf",
    sizeBytes: 4_683_073_632,
    shards: [
      {
        file: "qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf",
        sizeBytes: 3_993_201_344,
        sha256: "dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db",
      },
      {
        file: "qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf",
        sizeBytes: 689_872_288,
        sha256: "539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a",
      },
    ],
    license: "Apache-2.0",
    note: "O mais profundo do catálogo. Download grande e precisa de 12 GB de RAM.",
  },
];

function whisperById(id: string): WhisperModel {
  const model = WHISPER_MODELS.find((item) => item.id === id);
  if (!model) throw new Error(`modelo de transcricao desconhecido: ${id}`);
  return model;
}

function llmById(id: string): LlmModel {
  const model = LLM_MODELS.find((item) => item.id === id);
  if (!model) throw new Error(`modelo de analise desconhecido: ${id}`);
  return model;
}

/**
 * Perfis por faixa de hardware. A escolha e sempre a maior qualidade que a
 * maquina comporta; o usuario pode descer de tier no laboratorio, mas o padrao
 * nao sacrifica a analise por velocidade.
 */
export const BROWSER_PLANS: BrowserPlan[] = [
  {
    tier: 0,
    label: "Mínimo",
    hardware: "Sem WebGPU, CPU fraca ou menos de 6 GB de RAM",
    whisper: whisperById("whisper-base"),
    llm: llmById("lfm2.5-230m-q5"),
    contextSize: 2048,
  },
  {
    tier: 1,
    label: "Leve",
    hardware: "Intel HD/UHD, GPU integrada, 6-8 GB de RAM",
    whisper: whisperById("whisper-small"),
    llm: llmById("qwen3.5-0.8b-q5"),
    contextSize: 3072,
  },
  {
    tier: 2,
    label: "Equilibrado",
    hardware: "Cerca de 3-4 GB de VRAM",
    whisper: whisperById("whisper-small"),
    llm: llmById("qwen3.5-2b-q4"),
    contextSize: 3072,
  },
  {
    tier: 3,
    label: "Alto",
    hardware: "AMD RX 580 8 GB, 16 GB de RAM",
    whisper: whisperById("whisper-large-v3-turbo"),
    llm: llmById("lfm2.5-2.6b-q5"),
    contextSize: 4096,
  },
  {
    tier: 4,
    label: "Máximo",
    hardware: "PC gamer com 12 GB+ de VRAM e 16 GB+ de RAM",
    whisper: whisperById("whisper-large-v3-turbo"),
    llm: llmById("qwen2.5-7b-q4"),
    contextSize: 4096,
  },
];

export function planForTier(tier: ProcessingTier): BrowserPlan {
  return BROWSER_PLANS.find((plan) => plan.tier === tier) ?? BROWSER_PLANS[0];
}

/** Total que sera baixado para o tier, em bytes. */
export function planDownloadBytes(plan: BrowserPlan): number {
  return plan.whisper.sizeBytes + plan.llm.sizeBytes;
}

/** Formata bytes para a tela; sempre em GB/MB decimais arredondados. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes >= GB) {
    const gb = bytes / GB;
    return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1).replace(".", ",")} GB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(0)} MB`;
}

/** URL que o wllama recebe: o primeiro shard; ele descobre os demais. */
export function llmModelUrl(model: LlmModel): string {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.file}`;
}

