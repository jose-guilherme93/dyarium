import { authorLabel, authorPromptLine, effectiveAuthor } from '../author';

describe('autor da nota', () => {
  it('resolve o padrao do app', () => {
    expect(effectiveAuthor('', true)).toBe('self');
    expect(effectiveAuthor(undefined, true)).toBe('self');
    expect(effectiveAuthor('', false)).toBe('');
    expect(effectiveAuthor('other', true)).toBe('other');
  });

  it('mostra o rotulo do dono ou de outros', () => {
    expect(authorLabel('self', 'Ana', true)).toBe('Ana');
    expect(authorLabel('', 'Ana', true)).toBe('Ana');
    expect(authorLabel('', 'Ana', false)).toBe('Sem autor');
    expect(authorLabel('other', 'Ana', true)).toBe('Outros');
    expect(authorLabel('mixed', 'Ana', true)).toBe('Ana e outros');
  });

  it('monta a linha do prompt com e sem nome', () => {
    expect(authorPromptLine('self', 'Ana')).toContain('Ana');
    expect(authorPromptLine('self', '')).toContain('proprio autor do diario');
    expect(authorPromptLine('other', 'Ana')).toContain('outra pessoa');
    expect(authorPromptLine('mixed', 'Ana')).toContain('Ana');
    expect(authorPromptLine('', 'Ana', false)).toContain('nao informado');
  });
});
