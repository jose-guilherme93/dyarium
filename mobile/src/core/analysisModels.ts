/**
 * Catalogo de modelos de analise local (GGUF / llama.rn) e a escolha do
 * recomendado para o aparelho. Puro e testavel: nada de IO aqui.
 *
 * Os arquivos vem do Hugging Face em uma revisao fixa e sao baixados em
 * runtime (nao entram no build). O tamanho e conferido no download; a
 * verificacao SHA-256 entra na fase de endurecimento.
 */

export type AnalysisModelTier = 'light' | 'balanced' | 'recommended';

export interface AnalysisModelInfo {
  id: string;
  label: string;
  /** Repositorio no Hugging Face. */
  repo: string;
  /** Revisao fixa (commit) para o arquivo nao mudar sem aviso. */
  revision: string;
  /** Arquivo GGUF dentro do repositorio. */
  fileName: string;
  /** Tamanho exato em bytes, conferido apos o download. */
  sizeBytes: number;
  /** SHA-256 do arquivo no Hugging Face (verificacao na fase 1). */
  sha256: string;
  /** Ordem do menor/mais leve ao maior/mais capaz. */
  rank: number;
  /** RAM total minima para recomendar o modelo. */
  minRamBytes: number;
  tier: AnalysisModelTier;
  license: string;
}

const GB = 1024 ** 3;

/** Do menor/mais leve ao maior/mais capaz. */
export const ANALYSIS_MODELS: AnalysisModelInfo[] = [
  {
    id: 'gemma-3-270m',
    label: 'Leve',
    repo: 'unsloth/gemma-3-270m-it-GGUF',
    revision: 'c90975dbd40c0c7b275fefaae758c3415c906238',
    fileName: 'gemma-3-270m-it-Q4_K_M.gguf',
    sizeBytes: 253_115_424,
    sha256: 'b1baabd6b729e4041822220d3e648e00d99cac5df86b10dffb77bcccf0688e39',
    rank: 1,
    minRamBytes: 3 * GB,
    tier: 'light',
    license: 'Gemma Terms of Use',
  },
  {
    id: 'qwen3-0.6b',
    label: 'Equilibrado',
    repo: 'unsloth/Qwen3-0.6B-GGUF',
    revision: '50968a4468ef4233ed78cd7c3de230dd1d61a56b',
    fileName: 'Qwen3-0.6B-Q4_K_M.gguf',
    sizeBytes: 396_705_472,
    sha256: 'ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a',
    rank: 2,
    minRamBytes: 5 * GB,
    tier: 'balanced',
    license: 'Apache-2.0',
  },
  {
    id: 'qwen3.5-0.8b',
    label: 'Recomendado',
    repo: 'unsloth/Qwen3.5-0.8B-GGUF',
    revision: '6ab461498e2023f6e3c1baea90a8f0fe38ab64d0',
    fileName: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    sizeBytes: 532_517_120,
    sha256: 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517',
    rank: 3,
    minRamBytes: 7 * GB,
    tier: 'recommended',
    license: 'Apache-2.0',
  },
  {
    id: 'gemma-3-1b',
    label: 'Gemma 3 1B',
    repo: 'unsloth/gemma-3-1b-it-GGUF',
    revision: 'f0b45be0aac41bd6a100a4b5734cad5f67255bfb',
    fileName: 'gemma-3-1b-it-Q4_K_M.gguf',
    sizeBytes: 806_058_272,
    sha256: '8270790f3ab69fdfe860b7b64008d9a19986d8df7e407bb018184caa08798ebd',
    rank: 4,
    minRamBytes: 8 * GB,
    tier: 'balanced',
    license: 'Gemma Terms of Use',
  },
  {
    id: 'qwen3-1.7b',
    label: 'Qwen3 1.7B',
    repo: 'unsloth/Qwen3-1.7B-GGUF',
    revision: 'd7f544eead698dbd1f15126ef60b45a1e1933222',
    fileName: 'Qwen3-1.7B-Q4_K_M.gguf',
    sizeBytes: 1_107_409_472,
    sha256: 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897',
    rank: 5,
    minRamBytes: 11 * GB,
    tier: 'recommended',
    license: 'Apache-2.0',
  },
  {
    id: 'qwen3.5-2b',
    label: 'Qwen3.5 2B',
    repo: 'unsloth/Qwen3.5-2B-GGUF',
    revision: 'f6d5376be1edb4d416d56da11e5397a961aca8ae',
    fileName: 'Qwen3.5-2B-Q4_K_M.gguf',
    sizeBytes: 1_280_835_840,
    sha256: 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
    rank: 6,
    minRamBytes: 12 * GB,
    tier: 'recommended',
    license: 'Apache-2.0',
  },
  {
    id: 'qwen3.5-4b',
    label: 'Qwen3.5 4B',
    repo: 'unsloth/Qwen3.5-4B-GGUF',
    revision: 'e87f176479d0855a907a41277aca2f8ee7a09523',
    fileName: 'Qwen3.5-4B-Q4_K_M.gguf',
    sizeBytes: 2_740_937_888,
    sha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
    rank: 7,
    minRamBytes: 16 * GB,
    tier: 'recommended',
    license: 'Apache-2.0',
  },
];

/** Modelo leve de reserva quando a RAM nao pode ser lida. */
export const DEFAULT_ANALYSIS_MODEL = 'gemma-3-270m';

export function analysisModelById(id: string | undefined): AnalysisModelInfo | undefined {
  return ANALYSIS_MODELS.find((model) => model.id === id);
}

/** URL de download do arquivo em uma revisao fixa. */
export function analysisModelUrl(model: AnalysisModelInfo): string {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.fileName}`;
}

/**
 * Modelo recomendado para a RAM total do aparelho (bytes). Sem informacao,
 * devolve o leve. Aparelhos com menos de 3 GB nao recebem recomendacao.
 */
/**
 * O aparelho tem RAM para o modelo? `null` quando a RAM nao pode ser lida (a
 * tela nao mostra aviso nesse caso).
 */
export function modelFitsDevice(
  model: AnalysisModelInfo,
  totalMemoryBytes: number | null | undefined,
): boolean | null {
  if (
    totalMemoryBytes === null ||
    totalMemoryBytes === undefined ||
    !Number.isFinite(totalMemoryBytes) ||
    totalMemoryBytes <= 0
  ) {
    return null;
  }
  return totalMemoryBytes >= model.minRamBytes;
}

export function recommendAnalysisModel(
  totalMemoryBytes: number | null | undefined,
): AnalysisModelInfo | null {
  if (totalMemoryBytes === null || totalMemoryBytes === undefined || !Number.isFinite(totalMemoryBytes)) {
    return analysisModelById(DEFAULT_ANALYSIS_MODEL) ?? ANALYSIS_MODELS[0] ?? null;
  }
  if (totalMemoryBytes <= 0) return null;
  const eligible = ANALYSIS_MODELS.filter((model) => totalMemoryBytes >= model.minRamBytes);
  if (eligible.length === 0) return null;
  return eligible.reduce((best, model) => (model.rank > best.rank ? model : best));
}
