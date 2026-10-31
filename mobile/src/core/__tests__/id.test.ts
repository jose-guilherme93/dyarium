import { stableAttachmentId } from '../id';

describe('stableAttachmentId', () => {
  it('e deterministico para o mesmo dono e nome', () => {
    expect(stableAttachmentId('note_a', 'foto.png')).toBe(
      stableAttachmentId('note_a', 'foto.png'),
    );
  });

  it('separa notas e arquivos diferentes', () => {
    const base = stableAttachmentId('note_a', 'foto.png');
    expect(stableAttachmentId('note_b', 'foto.png')).not.toBe(base);
    expect(stableAttachmentId('note_a', 'outra.png')).not.toBe(base);
  });

  it('usa o formato aceito pelo servidor', () => {
    expect(stableAttachmentId('note_a', 'foto.png')).toMatch(/^att_[a-z0-9]+$/);
  });
});
