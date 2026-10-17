import {
  ANALYSIS_MODELS,
  analysisModelById,
  analysisModelUrl,
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
    expect(recommendAnalysisModel(8 * GB)?.id).toBe('qwen3.5-0.8b');
    expect(recommendAnalysisModel(16 * GB)?.id).toBe('qwen3.5-0.8b');
  });

  it('usa o modelo leve quando a RAM nao pode ser lida', () => {
    expect(recommendAnalysisModel(null)?.id).toBe('gemma-3-270m');
    expect(recommendAnalysisModel(Number.NaN)?.id).toBe('gemma-3-270m');
  });
});

describe('catalogo', () => {
  it('tem ids unicos e URLs com revisao fixa', () => {
    const ids = ANALYSIS_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    const model = analysisModelById('qwen3-0.6b');
    expect(model).toBeDefined();
    expect(analysisModelUrl(model!)).toContain('/resolve/50968a4468ef4233ed78cd7c3de230dd1d61a56b/');
    expect(analysisModelUrl(model!)).toContain('Qwen3-0.6B-Q4_K_M.gguf');
  });
});
