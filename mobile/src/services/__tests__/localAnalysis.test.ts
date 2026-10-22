import { analysisThreads } from '../localAnalysis';

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
