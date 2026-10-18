import {
  ANALYSIS_MODELS,
  analysisModelById,
  analysisModelUrl,
  modelFitsDevice,
  recommendAnalysisModel,
} from '../analysisModels';

const GB = 1024 ** 3;

describe('recommendAnalysisModel', () => {
  it('nao recomenda nada abaixo de 3 GB', () => {
    expect(recommendAnalysisModel(2 * GB)).toBeNull();
    expect(recommendAnalysisModel(0)).toBeNull();
  });

  it('recomenda o modelo mais capaz que cabe na RAM', () => {
    expect(recommendAnalysisModel(4 * GB)?.id).toBe('gemma-3-270m');
    expect(recommendAnalysisModel(6 * GB)?.id).toBe('qwen3-0.6b');
    expect(recommendAnalysisModel(8 * GB)?.id).toBe('gemma-3-1b');
    expect(recommendAnalysisModel(10 * GB)?.id).toBe('gemma-3-1b');
    expect(recommendAnalysisModel(12 * GB)?.id).toBe('qwen3.5-2b');
    expect(recommendAnalysisModel(16 * GB)?.id).toBe('qwen3.5-4b');
    expect(recommendAnalysisModel(32 * GB)?.id).toBe('qwen3.5-4b');
  });

  it('usa o modelo leve quando a RAM nao pode ser lida', () => {
    expect(recommendAnalysisModel(null)?.id).toBe('gemma-3-270m');
    expect(recommendAnalysisModel(Number.NaN)?.id).toBe('gemma-3-270m');
  });
});

describe('modelFitsDevice', () => {
  const model = analysisModelById('qwen3.5-2b')!;

  it('compara a RAM total com o minimo do modelo', () => {
    expect(modelFitsDevice(model, 16 * GB)).toBe(true);
    expect(modelFitsDevice(model, 8 * GB)).toBe(false);
  });

  it('devolve null quando a RAM nao pode ser lida', () => {
    expect(modelFitsDevice(model, null)).toBeNull();
    expect(modelFitsDevice(model, Number.NaN)).toBeNull();
  });
});

describe('catalogo', () => {
  it('tem revisao fixa, sha256 e tamanho em todos os modelos', () => {
    for (const model of ANALYSIS_MODELS) {
      expect(model.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(model.sizeBytes).toBeGreaterThan(0);
      expect(model.minRamBytes).toBeGreaterThan(0);
    }
  });

  it('tem ids unicos e URLs com revisao fixa', () => {
    const ids = ANALYSIS_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    const model = analysisModelById('qwen3-0.6b');
    expect(model).toBeDefined();
    expect(analysisModelUrl(model!)).toContain('/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/');
    expect(analysisModelUrl(model!)).toContain('Qwen3-0.6B-Q4_K_M.gguf');
  });
});
