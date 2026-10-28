import { ApiError } from '../api';
import { isPermanentUploadError } from '../errors';

describe('isPermanentUploadError', () => {
  it('trata 4xx do servidor como permanente', () => {
    for (const status of [400, 404, 409, 413, 422]) {
      expect(isPermanentUploadError(new ApiError(status, 'x', 'y'))).toBe(true);
    }
  });

  it('mantem 408 e 429 como transitorios', () => {
    expect(isPermanentUploadError(new ApiError(408, 'x', 'y'))).toBe(false);
    expect(isPermanentUploadError(new ApiError(429, 'x', 'y'))).toBe(false);
  });

  it('trata 5xx como transitorio', () => {
    expect(isPermanentUploadError(new ApiError(500, 'x', 'y'))).toBe(false);
    expect(isPermanentUploadError(new ApiError(503, 'x', 'y'))).toBe(false);
    expect(isPermanentUploadError(new ApiError(422, 'invalid_notebook', 'caderno'))).toBe(false);
  });

  it('falha de rede (nao-ApiError) e transitoria', () => {
    expect(isPermanentUploadError(new Error('rede caiu'))).toBe(false);
    expect(isPermanentUploadError(undefined)).toBe(false);
  });
});
