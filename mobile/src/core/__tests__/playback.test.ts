import { isPlaybackFinished } from '../playback';

describe('isPlaybackFinished', () => {
  it('detecta o fim (com folga)', () => {
    expect(isPlaybackFinished(10, 10)).toBe(true);
    expect(isPlaybackFinished(9.9, 10)).toBe(true);
    expect(isPlaybackFinished(8, 10)).toBe(false);
  });

  it('nao considera o inicio ou duracao invalida', () => {
    expect(isPlaybackFinished(0, 10)).toBe(false);
    expect(isPlaybackFinished(5, 0)).toBe(false);
    expect(isPlaybackFinished(5, NaN)).toBe(false);
    expect(isPlaybackFinished(NaN, 10)).toBe(false);
  });
});
