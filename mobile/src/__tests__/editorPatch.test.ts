/**
 * O editor rico vem patchado: sem o patch, o Android despacha um evento de
 * estado de estilo a cada tecla (mesmo sem mudanca de estado), e a digitacao
 * engasga. O patch e de codigo nativo, entao nao ha como testar o efeito
 * aqui - mas da para garantir que o patch continua no repositorio e na versao
 * fixada do pacote.
 */

// O projeto mobile nao traz @types/node; aqui o fs e o path servem so para
// ler o patch do editor rico.
declare function require(name: string): unknown;
declare const __dirname: string;

const { existsSync, readFileSync } = require('node:fs') as {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: string): string;
};
const { join } = require('node:path') as { join(...parts: string[]): string };

const PATCH = join(__dirname, '../../patches/react-native-enriched-html@1.1.1.patch');

describe('patch do editor rico', () => {
  it('esta no repositorio, na versao do pacote', () => {
    expect(existsSync(PATCH)).toBe(true);
  });

  it('so emite o estado de estilo quando ele muda de verdade', () => {
    const patch = readFileSync(PATCH, 'utf8');

    // Sem esses desvios, o Android monta e despacha o payload de estado a
    // cada tecla (o iOS da biblioteca ja faz o certo).
    expect(patch).toContain('getStart(name) == start');
    expect(patch).toContain('currentAlignment == value');
    expect(patch).toContain('previousPayload?.toHashMap() == payload.toHashMap()');
  });

  it('nao deixa os spans de paragrafo vazio se acumularem', () => {
    const patch = readFileSync(PATCH, 'utf8');

    // O span vazio era uma classe local: cada tecla deixava um span novo no
    // texto (o anterior nunca era removido) e o layout ficava mais lento a
    // cada tecla.
    expect(patch).toContain('EmptyParagraphSpan');
    expect(patch).toContain('EmptyParagraphSpan::class.java');
  });

  it('mede o texto com a quebra de linha simples, e nao com a otima', () => {
    const patch = readFileSync(PATCH, 'utf8');

    // A quebra "otima" resolve os melhores pontos de quebra do texto inteiro e
    // a view nativa a repete a cada tecla. A simples desenha as mesmas linhas
    // bem mais rapido - e a view e a medicao usam a mesma estrategia.
    expect(patch).toContain('BREAK_STRATEGY_SIMPLE');
    expect(patch.match(/BREAK_STRATEGY_SIMPLE/g)?.length).toBe(4);
  });
});
