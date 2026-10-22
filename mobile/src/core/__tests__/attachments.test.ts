import {
  attachmentIdFromUrl,
  attachmentRefId,
  isLocalAttachment,
  localAttachmentName,
  localAudioName,
  mimeFromName,
  pendingLocalAudioNames,
  resolveLocalAttachmentRefs,
  resolveLocalAudioRefs,
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

  it('extrai o nome local de um audio', () => {
    expect(localAudioName('local:audio_1.aac')).toBe('audio_1.aac');
    expect(localAudioName('attachment:abc')).toBeUndefined();
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
    expect(result.pending).toEqual(['a.jpg']);
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

describe('pendingLocalAudioNames', () => {
  it('lista os audios locais que ainda nao tem anexo no servidor', () => {
    expect(
      pendingLocalAudioNames(
        '!audio[local:a.aac]\n!audio[local:b.aac]\n!audio[attachment:at_1]',
        { 'b.aac': 'at_1' },
      ),
    ).toEqual(['a.aac']);
  });

  it('nao considera audio que ja esta no servidor', () => {
    expect(
      pendingLocalAudioNames('!audio[attachment:at_1]{d=3}', {}),
    ).toEqual([]);
  });
});

describe('resolveLocalAudioRefs', () => {
  it('sobe o audio e troca a referencia preservando a duracao', async () => {
    const upload = jest.fn(async (name: string) => `at_${name.replace(/\W/g, '')}`);
    const result = await resolveLocalAudioRefs(
      'A\n!audio[local:audio_1.aac]{d=12.5}\nB',
      {},
      upload,
    );

    expect(upload).toHaveBeenCalledWith('audio_1.aac', 12_500);
    expect(result.markdown).toBe('A\n!audio[attachment:at_audio_1aac]{d=12.5}\nB');
    expect(result.attachments).toEqual({ 'audio_1.aac': 'at_audio_1aac' });
    expect(result.pending).toEqual([]);
  });

  it('nao sobe de novo um audio ja conhecido', async () => {
    const upload = jest.fn(async (name: string) => `at_${name}`);
    const result = await resolveLocalAudioRefs(
      '!audio[local:audio_1.aac]{d=3}',
      { 'audio_1.aac': 'at_antigo' },
      upload,
    );

    expect(upload).not.toHaveBeenCalled();
    expect(result.markdown).toBe('!audio[attachment:at_antigo]{d=3}');
  });

  it('mantem local quando o upload falha', async () => {
    const upload = jest.fn(async () => {
      throw new Error('sem rede');
    });
    const result = await resolveLocalAudioRefs('!audio[local:a.aac]', {}, upload);

    expect(result.markdown).toBe('!audio[local:a.aac]');
    expect(result.attachments).toEqual({});
    expect(result.pending).toEqual(['a.aac']);
  });

  it('nao toca em audio que ja esta no servidor', async () => {
    const upload = jest.fn(async () => 'x');
    const markdown = 'A\n!audio[attachment:at_1]{d=3}\nB';
    const result = await resolveLocalAudioRefs(markdown, {}, upload);

    expect(result.markdown).toBe(markdown);
    expect(upload).not.toHaveBeenCalled();
  });
});
