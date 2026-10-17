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
