import {
  checkpointPercent,
  DEFAULT_TRANSCRIPTION_MODEL,
  TRANSCRIPTION_MODELS,
  modelById,
  modelUrl,
  recommendModel,
  whisperLanguage,
} from '../transcription';

describe('catalogo de modelos', () => {
  it('esta ordenado do mais fraco ao mais forte', () => {
    const ranks = TRANSCRIPTION_MODELS.map((m) => m.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(TRANSCRIPTION_MODELS.map((m) => m.id)).size).toBe(TRANSCRIPTION_MODELS.length);
  });

  it('monta a URL do Hugging Face', () => {
    const base = modelById('base');
    expect(base).toBeDefined();
    expect(modelUrl(base!)).toBe(
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${base!.fileName}`,
    );
  });
});

describe('recommendModel', () => {
  const gb = (n: number) => n * 1024 ** 3;

  it('recomenda por RAM, do leve ao forte', () => {
    expect(recommendModel(gb(4)).id).toBe('base');
    expect(recommendModel(gb(6)).id).toBe('small');
    expect(recommendModel(gb(8)).id).toBe('medium');
    expect(recommendModel(gb(12)).id).toBe('large');
  });

  it('cai no padrao sem informacao de RAM', () => {
    expect(recommendModel(null).id).toBe(DEFAULT_TRANSCRIPTION_MODEL);
    expect(recommendModel(undefined).id).toBe(DEFAULT_TRANSCRIPTION_MODEL);
  });
});

describe('whisperLanguage', () => {
  it('fixa pt por padrao e permite detectar', () => {
    expect(whisperLanguage('pt')).toBe('pt');
    expect(whisperLanguage(undefined)).toBe('pt');
    expect(whisperLanguage('auto')).toBe('auto');
  });
});

describe('checkpointPercent', () => {
  it('converte o ponto de retomada em porcentagem', () => {
    expect(checkpointPercent({ durationMs: 600_000, transcriptCheckpointMs: 210_000 })).toBe(35);
    expect(checkpointPercent({ durationMs: 600_000, transcriptCheckpointMs: 0 })).toBe(0);
    expect(checkpointPercent({ durationMs: 0, transcriptCheckpointMs: 1000 })).toBe(0);
  });
});
