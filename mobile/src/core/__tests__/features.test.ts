import { localAnalysisEnabled } from '../features';

describe('localAnalysisEnabled', () => {
  it('liga com 1 ou true', () => {
    expect(localAnalysisEnabled('1')).toBe(true);
    expect(localAnalysisEnabled('true')).toBe(true);
    expect(localAnalysisEnabled(' TRUE ')).toBe(true);
  });

  it('fica desligada por padrao e com valores falsos', () => {
    expect(localAnalysisEnabled(undefined)).toBe(false);
    expect(localAnalysisEnabled('')).toBe(false);
    expect(localAnalysisEnabled('0')).toBe(false);
    expect(localAnalysisEnabled('false')).toBe(false);
  });
});
