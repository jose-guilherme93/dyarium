/**
 * Catalogo de modelos de analise local (GGUF / llama.rn) e a escolha do
 * recomendado para o aparelho. Puro e testavel: nada de IO aqui.
 *
 * O trabalho do modelo e estreito: ler um bloco em pt-BR e devolver um JSON
 * curto com valores de vocabulario fechado, copiando nomes e trechos do texto.
 * Por isso o catalogo prioriza vocabulario pequeno (decodificar custa por token
 * do vocabulario) e quantizacoes que o llama.cpp faz rapido na CPU do celular.
 *
 * Cada familia tem duas quants: `fast` (Q4_0, o caminho vetorizado no ARM) e
 * `quality` (Q5_K_M). A tela mostra uma familia por cartao, com um interruptor
 * entre as duas; o usuario nao escolhe arquivo, so troca velocidade por
 * qualidade. A qualidade e o padrao sempre que a RAM permite.
 *
 * Licencas: Qwen3.5 e Apache-2.0. LFM2.5 usa a LFM Open License v1.0
 * (https://huggingface.co/LiquidAI/LFM2.5-230M-GGUF/blob/main/LICENSE): uso
 * livre enquanto a entidade nao passar de US$ 10 milhoes de receita anual;
 * acima disso exige licenca comercial da Liquid AI. A licenca e a atribuicao
 * ficam visiveis na tela de modelos, junto do arquivo.
 */

export type AnalysisModelTier = 'light' | 'balanced' | 'recommended';
export type AnalysisModelVariant = 'fast' | 'quality';

export interface AnalysisModelInfo {
  id: string;
  label: string;
  /** Familia a que pertence (uma familia, duas quants). */
  family: string;
  variant: AnalysisModelVariant;
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

export interface AnalysisModelFamily {
  id: string;
  label: string;
  rank: number;
  tier: AnalysisModelTier;
  license: string;
  fast: AnalysisModelInfo;
  quality: AnalysisModelInfo;
}

interface VariantSpec {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  minRamBytes: number;
}

interface FamilySpec {
  id: string;
  label: string;
  repo: string;
  revision: string;
  license: string;
  tier: AnalysisModelTier;
  rank: number;
  fast: VariantSpec;
  quality: VariantSpec;
}

const GB = 1024 ** 3;
const LFM_LICENSE = 'LFM Open License v1.0';
const APACHE = 'Apache-2.0';

/**
 * Do menor/mais leve ao maior/mais capaz. A ordem define a recomendacao; cada
 * familia entrega a quant rapida e a de qualidade do mesmo modelo.
 */
const FAMILIES: FamilySpec[] = [
  {
    id: 'lfm2.5-230m',
    label: 'LFM2.5 230M',
    repo: 'LiquidAI/LFM2.5-230M-GGUF',
    revision: '03502067c64ce32ac4fe87b0cec0310a1a13d3e9',
    license: LFM_LICENSE,
    tier: 'light',
    rank: 1,
    fast: {
      fileName: 'LFM2.5-230M-QAD-Q4_0.gguf',
      sizeBytes: 149_081_056,
      sha256: 'e75f83268de11b2a1bcfab5f3b5c5c0c97569ddbbc0990aad88437e45b8ba292',
      minRamBytes: 3 * GB,
    },
    quality: {
      fileName: 'LFM2.5-230M-Q5_K_M.gguf',
      sizeBytes: 171_625_312,
      sha256: '65bceea824d701506de53f02d7276578a64706ad9c17f00d6e8917bf491de6db',
      minRamBytes: 5 * GB,
    },
  },
  {
    id: 'qwen3.5-0.8b',
    label: 'Qwen3.5 0.8B',
    repo: 'unsloth/Qwen3.5-0.8B-GGUF',
    revision: '6ab461498e2023f6e3c1baea90a8f0fe38ab64d0',
    license: APACHE,
    tier: 'balanced',
    rank: 2,
    fast: {
      fileName: 'Qwen3.5-0.8B-Q4_0.gguf',
      sizeBytes: 507_154_688,
      sha256: '444406ddd926550c724ec18d5120a9d40ded44908a063b0e66e9a7e5464c652c',
      minRamBytes: 5 * GB,
    },
    quality: {
      fileName: 'Qwen3.5-0.8B-Q5_K_M.gguf',
      sizeBytes: 590_057_728,
      sha256: 'c3ef5827b322c4be08a3a26ce424460d8b37daf593356c2cc1f4e40a7ab0581b',
      minRamBytes: 6 * GB,
    },
  },
  {
    id: 'qwen3.5-2b',
    label: 'Qwen3.5 2B',
    repo: 'unsloth/Qwen3.5-2B-GGUF',
    revision: 'f6d5376be1edb4d416d56da11e5397a961aca8ae',
    license: APACHE,
    tier: 'recommended',
    rank: 3,
    fast: {
      fileName: 'Qwen3.5-2B-Q4_0.gguf',
      sizeBytes: 1_214_873_856,
      sha256: 'cd70221bebaee0503e0f6717e174250cd7825aa88438b3aabec9ad55731d9bb1',
      minRamBytes: 10 * GB,
    },
    quality: {
      fileName: 'Qwen3.5-2B-Q5_K_M.gguf',
      sizeBytes: 1_435_238_656,
      sha256: '1885b3a9195f8cc09da9a7a7a75afdc1e8d5cbf9fc4a499c3961dddea37098ac',
      minRamBytes: 11 * GB,
    },
  },
  {
    id: 'lfm2.5-2.6b',
    label: 'LFM2.5 2.6B',
    repo: 'LiquidAI/LFM2.5-2.6B-GGUF',
    revision: 'e7caca5d835a3901a8e0d63e94009429bafafdfc',
    license: LFM_LICENSE,
    tier: 'recommended',
    rank: 4,
    fast: {
      fileName: 'LFM2.5-2.6B-Q4_0.gguf',
      sizeBytes: 1_593_894_912,
      sha256: 'e1a61bf937bc60726e18626e97f7ee9bfd2574d95744c2ed909de98b78006fbe',
      minRamBytes: 12 * GB,
    },
    quality: {
      fileName: 'LFM2.5-2.6B-Q5_K_M.gguf',
      sizeBytes: 1_939_744_768,
      sha256: '17ce54cc676e15e572adebfeeed8da6abd12b0f68d595be19b59e662476c21b3',
      minRamBytes: 14 * GB,
    },
  },
];

function buildVariant(
  family: FamilySpec,
  variant: AnalysisModelVariant,
  spec: VariantSpec,
): AnalysisModelInfo {
  const quick = variant === 'fast';
  return {
    id: `${family.id}-${quick ? 'q4' : 'q5'}`,
    label: `${family.label} · ${quick ? 'rápida' : 'qualidade'}`,
    family: family.id,
    variant,
    repo: family.repo,
    revision: family.revision,
    fileName: spec.fileName,
    sizeBytes: spec.sizeBytes,
    sha256: spec.sha256,
    rank: family.rank * 10 + (quick ? 0 : 1),
    minRamBytes: spec.minRamBytes,
    tier: family.tier,
    license: family.license,
  };
}

export const ANALYSIS_MODEL_FAMILIES: AnalysisModelFamily[] = FAMILIES.map((family) => ({
  id: family.id,
  label: family.label,
  rank: family.rank,
  tier: family.tier,
  license: family.license,
  fast: buildVariant(family, 'fast', family.fast),
  quality: buildVariant(family, 'quality', family.quality),
}));

/** Lista plana, para download, instalacao e cache por id. */
export const ANALYSIS_MODELS: AnalysisModelInfo[] = ANALYSIS_MODEL_FAMILIES.flatMap((family) => [
  family.fast,
  family.quality,
]);

/**
 * Modelo padrao quando a RAM nao pode ser lida. A qualidade e o padrao: a
 * diferenca de 22 MB entre as quants do 230M nao compensa a perda de extracao.
 */
export const DEFAULT_ANALYSIS_MODEL = 'lfm2.5-230m-q5';

export function analysisModelById(id: string | undefined): AnalysisModelInfo | undefined {
  return ANALYSIS_MODELS.find((model) => model.id === id);
}

export function analysisFamilyById(id: string | undefined): AnalysisModelFamily | undefined {
  return ANALYSIS_MODEL_FAMILIES.find((family) => family.id === id);
}

/** Variante de uma familia a partir do id salvo (ou a de qualidade). */
export function analysisVariantFor(
  family: AnalysisModelFamily,
  id: string | undefined,
): AnalysisModelVariant {
  return id === family.fast.id ? 'fast' : 'quality';
}

/** URL de download do arquivo em uma revisao fixa. */
export function analysisModelUrl(model: AnalysisModelInfo): string {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.fileName}`;
}

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

/**
 * Familia mais capaz que cabe na RAM. A familia entra quando qualquer uma das
 * quants cabe; a escolha entre elas fica com `recommendAnalysisModel`.
 */
export function recommendAnalysisFamily(
  totalMemoryBytes: number | null | undefined,
): AnalysisModelFamily | null {
  if (
    totalMemoryBytes === null ||
    totalMemoryBytes === undefined ||
    !Number.isFinite(totalMemoryBytes)
  ) {
    return ANALYSIS_MODEL_FAMILIES[0] ?? null;
  }
  if (totalMemoryBytes <= 0) return null;
  const eligible = ANALYSIS_MODEL_FAMILIES.filter(
    (family) =>
      totalMemoryBytes >= family.fast.minRamBytes ||
      totalMemoryBytes >= family.quality.minRamBytes,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, family) => (family.rank > best.rank ? family : best));
}

/**
 * Modelo recomendado: a qualidade da melhor familia que cabe. So cai para a
 * versao rapida quando a RAM nao comporta a qualidade.
 */
export function recommendAnalysisModel(
  totalMemoryBytes: number | null | undefined,
): AnalysisModelInfo | null {
  if (
    totalMemoryBytes === null ||
    totalMemoryBytes === undefined ||
    !Number.isFinite(totalMemoryBytes)
  ) {
    return analysisModelById(DEFAULT_ANALYSIS_MODEL) ?? ANALYSIS_MODELS[0] ?? null;
  }
  if (totalMemoryBytes <= 0) return null;
  const family = recommendAnalysisFamily(totalMemoryBytes);
  if (!family) return null;
  return modelFitsDevice(family.quality, totalMemoryBytes) ? family.quality : family.fast;
}
