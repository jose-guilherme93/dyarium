import { TRANSCRIPTION_MODELS } from '@/core/transcription';
import { installedModels, resolveTranscriptionModel } from '../transcriptionModels';

const mockFiles = new Map<string, number>();

jest.mock('expo-file-system', () => ({
  Directory: class {
    uri: string;
    exists = true;
    constructor(base: { uri: string } | string, name: string) {
      this.uri = typeof base === 'string' ? `${base}/${name}` : `${base.uri}/${name}`;
    }
    create() {}
    list() {
      return [...mockFiles.keys()].map((name) => ({ name, uri: `/doc/whisper-models/${name}` }));
    }
  },
  File: class {
    uri: string;
    exists = true;
    constructor(base: { uri: string } | string, name?: string) {
      this.uri = typeof base === 'string' ? base : `${base.uri}/${name ?? ''}`;
    }
    get size() {
      return mockFiles.get(this.uri.split('/').pop() ?? '') ?? 0;
    }
    delete() {
      mockFiles.delete(this.uri.split('/').pop() ?? '');
    }
  },
  Paths: { document: '/doc', cache: '/cache' },
}));

const tiny = TRANSCRIPTION_MODELS.find((model) => model.id === 'tiny')!;
const base = TRANSCRIPTION_MODELS.find((model) => model.id === 'base')!;

beforeEach(() => mockFiles.clear());

describe('modelos instalados', () => {
  it('aceita o arquivo real do catalogo mesmo com tamanho aproximado', () => {
    // Tamanho real do ggml-tiny-q5_1.bin, ~5% abaixo do catalogo.
    mockFiles.set(tiny.fileName, 32_152_673);
    expect(installedModels().map((model) => model.id)).toEqual(['tiny']);
  });

  it('nao conta um parcial cortado como modelo', () => {
    mockFiles.set(base.fileName, Math.floor(base.sizeBytes / 2));
    expect(installedModels()).toEqual([]);
  });

  it('preferencia apontando para modelo ausente cai no instalado', () => {
    mockFiles.set(tiny.fileName, 32_152_673);
    expect(resolveTranscriptionModel('large')?.id).toBe('tiny');
  });
});
