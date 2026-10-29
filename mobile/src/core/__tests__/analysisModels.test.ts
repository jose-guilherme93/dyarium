import {
  ANALYSIS_MODEL_FAMILIES,
  ANALYSIS_MODELS,
  analysisModelById,
  analysisModelUrl,
  analysisVariantFor,
  modelFitsDevice,
  recommendAnalysisFamily,
  recommendAnalysisModel,
} from '../analysisModels';

const GB = 1024 ** 3;

describe('recommendAnalysisModel', () => {
  it('nao recomenda nada abaixo de 3 GB', () => {
    expect(recommendAnalysisModel(2 * GB)).toBeNull();
    expect(recommendAnalysisModel(0)).toBeNull();
  });

  it('recomenda a qualidade da melhor familia que cabe na RAM', () => {
    expect(recommendAnalysisModel(4 * GB)?.id).toBe('lfm2.5-230m-q4');
    expect(recommendAnalysisModel(5 * GB)?.id).toBe('qwen3.5-0.8b-q4');
    expect(recommendAnalysisModel(6 * GB)?.id).toBe('qwen3.5-0.8b-q5');
    expect(recommendAnalysisModel(8 * GB)?.id).toBe('qwen3.5-0.8b-q5');
    expect(recommendAnalysisModel(10 * GB)?.id).toBe('qwen3.5-2b-q4');
    expect(recommendAnalysisModel(11 * GB)?.id).toBe('qwen3.5-2b-q5');
    expect(recommendAnalysisModel(12 * GB)?.id).toBe('lfm2.5-2.6b-q4');
    expect(recommendAnalysisModel(14 * GB)?.id).toBe('lfm2.5-2.6b-q5');
    expect(recommendAnalysisModel(32 * GB)?.id).toBe('lfm2.5-2.6b-q5');
  });

  it('recomenda a familia antes da quant e so cai para a rapida sem RAM', () => {
    expect(recommendAnalysisFamily(6 * GB)?.id).toBe('qwen3.5-0.8b');
    expect(recommendAnalysisFamily(4 * GB)?.id).toBe('lfm2.5-230m');
    expect(recommendAnalysisFamily(0)).toBeNull();
  });

  it('usa a qualidade do modelo leve quando a RAM nao pode ser lida', () => {
    expect(recommendAnalysisModel(null)?.id).toBe('lfm2.5-230m-q5');
    expect(recommendAnalysisModel(Number.NaN)?.id).toBe('lfm2.5-230m-q5');
  });
});

describe('modelFitsDevice', () => {
  const model = analysisModelById('qwen3.5-2b-q4')!;

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

  it('a variante segue o id salvo e cai para qualidade sem escolha', () => {
    const family = ANALYSIS_MODEL_FAMILIES[0];
    expect(analysisVariantFor(family, family.fast.id)).toBe('fast');
    expect(analysisVariantFor(family, family.quality.id)).toBe('quality');
    expect(analysisVariantFor(family, undefined)).toBe('quality');
    expect(analysisVariantFor(family, 'modelo-removido')).toBe('quality');
  });

  it('tem uma familia com as duas quants e nomes unicos', () => {
    expect(ANALYSIS_MODEL_FAMILIES).toHaveLength(4);
    expect(ANALYSIS_MODELS).toHaveLength(8);
    for (const family of ANALYSIS_MODEL_FAMILIES) {
      expect(family.fast.family).toBe(family.id);
      expect(family.quality.family).toBe(family.id);
      expect(family.fast.variant).toBe('fast');
      expect(family.quality.variant).toBe('quality');
      expect(family.fast.fileName).toContain('Q4_0');
      expect(family.quality.fileName).toContain('Q5_K_M');
      expect(family.fast.fileName).not.toBe(family.quality.fileName);
    }
  });

  it('tem ids unicos e URLs com revisao fixa', () => {
    const ids = ANALYSIS_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    const model = analysisModelById('qwen3.5-0.8b-q4');
    expect(model).toBeDefined();
    expect(analysisModelUrl(model!)).toContain('/resolve/6ab461498e2023f6e3c1baea90a8f0fe38ab64d0/');
    expect(analysisModelUrl(model!)).toContain('Qwen3.5-0.8B-Q4_0.gguf');
  });
});
