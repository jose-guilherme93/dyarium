import {
  attachmentIdFromUrl,
  attachmentRefId,
  isLocalAttachment,
  localAttachmentName,
  mimeFromName,
  resolveLocalAttachmentRefs,
} from '../attachments';

describe('referencias de anexo', () => {
  it('identifica e extrai as referencias', () => {
    expect(isLocalAttachment('local:a.png')).toBe(true);
    expect(isLocalAttachment('attachment:x')).toBe(false);
    expect(localAttachmentName('local:a.png')).toBe('a.png');
    expect(attachmentRefId('attachment:abc')).toBe('abc');
    expect(attachmentIdFromUrl('http://host/api/v1/attachments/abc123')).toBe('abc123');
    expect(attachmentIdFromUrl('https://host/foto.png')).toBeUndefined();
  });

  it('estima o Content-Type pela extensao', () => {
    expect(mimeFromName('a.PNG')).toBe('image/png');
    expect(mimeFromName('a.webp')).toBe('image/webp');
    expect(mimeFromName('a.heic')).toBe('image/heic');
    expect(mimeFromName('a.jpg')).toBe('image/jpeg');
    expect(mimeFromName('sem-extensao')).toBe('image/jpeg');
  });
});

describe('resolveLocalAttachmentRefs', () => {
  it('sobe a imagem e troca a referencia local pelo id', async () => {
    const upload = jest.fn(async (name: string) => `at_${name.replace(/\W/g, '')}`);
    const result = await resolveLocalAttachmentRefs('texto\n![foto](local:img_1.jpg)', {}, upload);
    expect(upload).toHaveBeenCalledWith('img_1.jpg');
    expect(result.markdown).toBe('texto\n![foto](attachment:at_img_1jpg)');
    expect(result.attachments).toEqual({ 'img_1.jpg': 'at_img_1jpg' });
  });

  it('nao sobe de novo um anexo ja conhecido', async () => {
    const upload = jest.fn(async (name: string) => `at_${name}`);
    const result = await resolveLocalAttachmentRefs(
      '![foto](local:img_1.jpg)',
      { 'img_1.jpg': 'at_antigo' },
      upload,
    );
    expect(upload).not.toHaveBeenCalled();
    expect(result.markdown).toBe('![foto](attachment:at_antigo)');
    expect(result.attachments).toEqual({ 'img_1.jpg': 'at_antigo' });
  });

  it('mantem local quando o upload falha', async () => {
    const upload = jest.fn(async () => {
      throw new Error('sem rede');
    });
    const result = await resolveLocalAttachmentRefs('![foto](local:a.jpg)', {}, upload);
    expect(result.markdown).toBe('![foto](local:a.jpg)');
    expect(result.attachments).toEqual({});
  });

  it('preserva o markdown sem imagem local', async () => {
    const upload = jest.fn(async (name: string) => `at_${name}`);
    const result = await resolveLocalAttachmentRefs('so texto **forte**', {}, upload);
    expect(result.markdown).toBe('so texto **forte**');
    expect(upload).not.toHaveBeenCalled();
  });

  it('resolve varias imagens na mesma passada', async () => {
    const upload = jest.fn(async (name: string) => `at_${name.replace(/\W/g, '')}`);
    const { markdown, attachments } = await resolveLocalAttachmentRefs(
      '![a](local:1.jpg)\n![b](local:2.png)',
      {},
      upload,
    );
    expect(markdown).toBe('![a](attachment:at_1jpg)\n![b](attachment:at_2png)');
    expect(attachments).toEqual({ '1.jpg': 'at_1jpg', '2.png': 'at_2png' });
  });
});
