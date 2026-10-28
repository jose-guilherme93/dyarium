/**
 * Catalogo de modelos de transcricao local (whisper.cpp / ggml) e a escolha do
 * recomendado para o aparelho. Puro e testavel: nada de IO aqui.
 *
 * Os arquivos vem do repositorio ggerganov/whisper.cpp no Hugging Face e sao
 * baixados em runtime (nao entram no build).
 */

export type TranscriptionLanguage = 'pt' | 'auto';

export interface TranscriptionModelInfo {
  id: string;
  /** Nome curto mostrado na lista. */
  label: string;
  /** Arquivo ggml no repositorio do Hugging Face. */
  fileName: string;
  /** Tamanho aproximado em bytes (para mostrar antes de baixar). */
  sizeBytes: number;
  /** Ordem do mais fraco ao mais forte. */
  rank: number;
}

const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';

/** Do mais fraco (leve/rapido) ao mais forte (pesado/preciso). */
export const TRANSCRIPTION_MODELS: TranscriptionModelInfo[] = [
  { id: 'tiny', label: 'Tiny', fileName: 'ggml-tiny-q5_1.bin', sizeBytes: 33_800_000, rank: 1 },
  { id: 'base', label: 'Base', fileName: 'ggml-base-q5_1.bin', sizeBytes: 62_600_000, rank: 2 },
  { id: 'small', label: 'Small', fileName: 'ggml-small-q5_1.bin', sizeBytes: 199_000_000, rank: 3 },
  { id: 'medium', label: 'Medium', fileName: 'ggml-medium-q5_0.bin', sizeBytes: 565_000_000, rank: 4 },
  {
    id: 'large',
    label: 'Large v3 Turbo',
    fileName: 'ggml-large-v3-turbo-q5_0.bin',
    sizeBytes: 602_000_000,
    rank: 5,
  },
];

export const DEFAULT_TRANSCRIPTION_MODEL = 'base';

/**
 * Porcentagem ja transcrita, a partir do checkpoint salvo. Serve para a lista e
 * para a nota continuarem mostrando o progresso real depois de reabrir o app
 * (o progresso ao vivo so existe enquanto o whisper esta rodando).
 */
export function checkpointPercent(recording: {
  durationMs?: number;
  transcriptCheckpointMs?: number;
}): number {
  const total = recording.durationMs ?? 0;
  const done = recording.transcriptCheckpointMs ?? 0;
  if (total <= 0 || done <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

export function modelById(id: string | undefined): TranscriptionModelInfo | undefined {
  return TRANSCRIPTION_MODELS.find((model) => model.id === id);
}

/** URL de download do modelo. */
export function modelUrl(model: TranscriptionModelInfo): string {
  return `${HF_BASE}/${model.fileName}`;
}

/**
 * Modelo recomendado para a RAM total do aparelho (bytes). Sem informacao,
 * recomenda um modelo leve (base).
 */
export function recommendModel(totalMemoryBytes: number | null | undefined): TranscriptionModelInfo {
  const gb = (totalMemoryBytes ?? 0) / 1024 ** 3;
  const id = gb >= 11 ? 'large' : gb >= 8 ? 'medium' : gb >= 6 ? 'small' : 'base';
  return modelById(id) ?? modelById(DEFAULT_TRANSCRIPTION_MODEL) ?? TRANSCRIPTION_MODELS[0];
}

export const TRANSCRIPTION_LANGUAGES: { value: TranscriptionLanguage; label: string }[] = [
  { value: 'pt', label: 'Português' },
  { value: 'auto', label: 'Detectar' },
];

/** Idioma a passar para o whisper (fixo pt ou deteccao automatica). */
export function whisperLanguage(language: TranscriptionLanguage | undefined): string {
  return language === 'auto' ? 'auto' : 'pt';
}
