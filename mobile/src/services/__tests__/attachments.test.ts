const mockFiles = new Set<string>();
const mockList = jest.fn();

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;

    constructor(base: string | { uri: string }, name?: string) {
      const dir = typeof base === 'string' ? base : base.uri;
      this.uri = name ? `${dir}/${name}` : dir;
    }

    get exists(): boolean {
      return mockFiles.has(this.uri);
    }
  }

  class MockDirectory {
    uri: string;

    constructor(base: string | { uri: string }, name?: string) {
      const dir = typeof base === 'string' ? base : base.uri;
      this.uri = name ? `${dir}/${name}` : dir;
    }

    get exists(): boolean {
      return true;
    }

    create(): void {
      // diretorio sempre existe no teste
    }

    list(): unknown[] {
      mockList();
      return [];
    }
  }

  return {
    File: MockFile,
    Directory: MockDirectory,
    FileMode: { Append: 1, ReadOnly: 2 },
    Paths: { cache: 'file:///cache', document: 'file:///docs' },
  };
});

jest.mock('../files', () => ({
  sessionDirectory: () => ({ uri: 'file:///docs/nota' }),
}));

jest.mock('../secure', () => ({
  loadServerConfig: jest.fn(),
}));

type AttachmentsModule = typeof import('../attachments');
let attachments: AttachmentsModule;

describe('attachments', () => {
  beforeEach(() => {
    mockFiles.clear();
    mockList.mockClear();
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    attachments = require('../attachments') as AttachmentsModule;
  });

  it('acha o anexo pelo caminho direto, sem listar a pasta inteira', () => {
    mockFiles.add('file:///cache/attachments/abc.jpg');

    expect(attachments.cachedAttachmentUri('abc')).toBe('file:///cache/attachments/abc.jpg');
    expect(attachments.cachedAttachmentUri('abc')).toBe('file:///cache/attachments/abc.jpg');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('procura as extensoes conhecidas e devolve null sem listar', () => {
    mockFiles.add('file:///cache/attachments/def.webp');

    expect(attachments.cachedAttachmentUri('def')).toBe('file:///cache/attachments/def.webp');
    expect(attachments.cachedAttachmentUri('nao-existe')).toBeNull();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('invalida o cache quando um arquivo novo chega', () => {
    expect(attachments.cachedAttachmentUri('ghi')).toBeNull();

    mockFiles.add('file:///cache/attachments/ghi.png');
    attachments.invalidateAttachmentIndex();

    expect(attachments.cachedAttachmentUri('ghi')).toBe('file:///cache/attachments/ghi.png');
    expect(mockList).not.toHaveBeenCalled();
  });

  it('acha audio no cache pela extensao', () => {
    mockFiles.add('file:///cache/attachments/audio1.aac');

    expect(attachments.cachedAttachmentUri('audio1')).toBe(
      'file:///cache/attachments/audio1.aac',
    );
    expect(mockList).not.toHaveBeenCalled();
  });

  it('estima o Content-Type do audio pela extensao', () => {
    expect(attachments.audioMimeFromName('a.aac')).toBe('audio/aac');
    expect(attachments.audioMimeFromName('a.m4a')).toBe('audio/mp4');
    expect(attachments.audioMimeFromName('a.mp3')).toBe('audio/mpeg');
    expect(attachments.audioMimeFromName('a.wav')).toBe('audio/wav');
    expect(attachments.audioMimeFromName('a.flac')).toBe('audio/flac');
    expect(attachments.audioMimeFromName('a.webm')).toBe('audio/webm');
    expect(attachments.audioMimeFromName('a.bin')).toBe('audio/aac');
  });

  it('resolve o arquivo local do audio da nota', async () => {
    mockFiles.add('file:///docs/nota/audio_1.aac');

    expect(attachments.localAudioUri('nota', 'audio_1.aac')).toBe(
      'file:///docs/nota/audio_1.aac',
    );
    await expect(
      attachments.resolveAudioSource('nota', 'local:audio_1.aac'),
    ).resolves.toBe('file:///docs/nota/audio_1.aac');
  });

  it('resolve o audio que ja esta no cache do servidor', async () => {
    mockFiles.add('file:///cache/attachments/at_audio.mp3');

    await expect(
      attachments.resolveAudioSource('nota', 'attachment:at_audio'),
    ).resolves.toBe('file:///cache/attachments/at_audio.mp3');
  });

  it('usa o arquivo local quando o anexo veio do proprio aparelho', async () => {
    mockFiles.add('file:///docs/nota/audio_1.aac');

    await expect(
      attachments.resolveAudioSource('nota', 'attachment:at_1', {
        'audio_1.aac': 'at_1',
      }),
    ).resolves.toBe('file:///docs/nota/audio_1.aac');
  });
});
