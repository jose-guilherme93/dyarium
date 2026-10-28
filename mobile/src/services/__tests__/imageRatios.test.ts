import { cachedImageRatio, imageRatio, rememberImageRatio } from '../imageRatios';

describe('imageRatios', () => {
  it('guarda a proporcao medida e usa fallback quando nao existe', () => {
    expect(cachedImageRatio('file:///nova.jpg')).toBeUndefined();
    rememberImageRatio('file:///nova.jpg', 2);
    expect(cachedImageRatio('file:///nova.jpg')).toBe(2);
    expect(imageRatio('file:///nova.jpg')).toBe(2);
    expect(imageRatio('file:///desconhecida.jpg')).toBeCloseTo(4 / 3);
  });
});
