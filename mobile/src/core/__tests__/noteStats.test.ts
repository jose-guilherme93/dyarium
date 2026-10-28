import { utf8ByteLength } from '../format';
import { noteStats } from '../noteStats';
import { countChars, countWords, markdownToPlain } from '../richText';

describe('noteStats', () => {
  const text =
    '**ola** mundo\n\n_imagem_ ![foto](attachment:abc){w=50}\nultima linha';

  it('devolve as tres contagens da mesma conversao para texto puro', () => {
    const plain = markdownToPlain(text);
    expect(noteStats(text)).toEqual({
      words: countWords(text),
      chars: countChars(text),
      bodyBytes: utf8ByteLength(plain),
    });
  });

  it('texto vazio zera as contagens', () => {
    expect(noteStats('')).toEqual({ words: 0, chars: 0, bodyBytes: 0 });
  });

  it('texto so com espacos nao conta palavra', () => {
    expect(noteStats('   ')).toEqual({ words: 0, chars: 3, bodyBytes: 3 });
  });
});
