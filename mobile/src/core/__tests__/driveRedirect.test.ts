import {
  driveRedirectUriFor,
  FALLBACK_REDIRECT,
  reverseClientScheme,
} from '../driveRedirect';

const ANDROID = '123456-abcdef.apps.googleusercontent.com';

describe('redirect do app instalado', () => {
  it('deriva o esquema do client id, como o Google espera', () => {
    expect(reverseClientScheme(ANDROID)).toBe('com.googleusercontent.apps.123456-abcdef');
    expect(driveRedirectUriFor('android', ANDROID)).toBe(
      'com.googleusercontent.apps.123456-abcdef://oauthredirect',
    );
  });

  it('e o mesmo nas duas plataformas nativas', () => {
    expect(driveRedirectUriFor('ios', ANDROID)).toBe(
      'com.googleusercontent.apps.123456-abcdef://oauthredirect',
    );
  });

  it('sem client id, ou no navegador, cai no marcador do app web', () => {
    expect(driveRedirectUriFor('android', '')).toBe(FALLBACK_REDIRECT);
    expect(driveRedirectUriFor('web', ANDROID)).toBe(FALLBACK_REDIRECT);
  });

  it('recusa um client id que nao pode virar esquema', () => {
    expect(reverseClientScheme('com/barra')).toBeNull();
    expect(reverseClientScheme('a:b')).toBeNull();
    expect(driveRedirectUriFor('android', 'a/b')).toBe(FALLBACK_REDIRECT);
  });
});
