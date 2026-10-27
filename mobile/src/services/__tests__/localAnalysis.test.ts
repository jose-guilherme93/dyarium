import { ANALYSIS_SCHEMA } from '@/core/analysisPrompt';
import { REVIEW_SCHEMA } from '@/core/transcriptReview';

import { analysisThreads, completionRequest } from '../localAnalysis';

/**
 * A inferencia local divide os nucleos com a interface. Com 4 threads em um
 * aparelho de 4 nucleos, a nota e a navegacao ficavam travadas por dezenas de
 * segundos enquanto o modelo gerava.
 */
describe('threads da analise local', () => {
  it('deixa nucleos livres para a interface', () => {
    expect(analysisThreads()).toBe(2);
    expect(analysisThreads(true)).toBe(1);
  });
});

/**
 * A revisao pede um schema com `segments`; a analise pede o de sentiment/pessoas.
 * Fixar o schema da analise na completion fazia toda janela da revisao voltar
 * no formato errado e ser descartada em silencio — o texto nunca mudava.
 */
describe('schema pedido ao modelo local', () => {
  it('usa o schema do chamador quando existe', () => {
    const request = completionRequest([{ role: 'user', content: '{}' }], {
      schema: REVIEW_SCHEMA,
    });
    expect(request.response_format.json_schema.schema).toBe(REVIEW_SCHEMA);
    expect(request.response_format.json_schema.schema.required).toContain('segments');
  });

  it('cai no schema da analise quando o chamador nao pede outro', () => {
    const request = completionRequest([{ role: 'user', content: '{}' }]);
    expect(request.response_format.json_schema.schema).toBe(ANALYSIS_SCHEMA);
  });
});
