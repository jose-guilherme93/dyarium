/**
 * Escolha de imagem na galeria, com os bytes prontos para enviar.
 *
 * Modulo nativo: pode faltar num development build antigo. O require fica
 * dentro de um try/catch e roda na avaliacao do bundle (nao no toque), para o
 * seletor registrar o `ActivityResultLauncher` antes de o app abrir.
 *
 * Toda foto e reduzida (se preciso) e recomprimida em JPEG de alta qualidade
 * antes de entrar na nota: assim o editor abre rapido, sem perda visivel.
 */

import { File } from 'expo-file-system';

import { IMAGE_QUALITY, resizeTarget } from '@/core/image';
import { newId } from '@/core/id';

export interface PickedImagePreview {
  /** URI temporaria do seletor, exibida borrada enquanto a foto e preparada. */
  uri: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  /** Nome definitivo na pasta da nota; o no entra no documento ja com ele. */
  localName: string;
}

export interface PickedImage {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  /** Dimensoes da imagem ja otimizada, para o editor nao distorcer a foto. */
  width: number;
  height: number;
  /** Arquivo local a gravar, gerado antes da otimizacao para o no nao mudar. */
  localName: string;
}

type ImagePickerModule = typeof import('expo-image-picker');
type ImageManipulatorModule = typeof import('expo-image-manipulator');

function loadPicker(): ImagePickerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-image-picker') as ImagePickerModule;
  } catch {
    return null;
  }
}

function loadManipulator(): ImageManipulatorModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-image-manipulator') as ImageManipulatorModule;
  } catch {
    return null;
  }
}

/**
 * Os modulos nativos sao carregados na abertura do app, e nao no toque.
 *
 * O seletor de fotos registra um `ActivityResultLauncher` na Activity quando o
 * modulo nativo e criado. Criado so na hora do toque (com o app ja em
 * primeiro plano), o registro chega tarde e o Android recusa a chamada com
 * "Attempting to launch an unregistered ActivityResultLauncher". Carregar
 * aqui, na avaliacao do bundle, deixa o registro pronto antes de qualquer
 * toque; em build antigo, sem o modulo, o try/catch devolve null.
 */
const PICKER = loadPicker();
const MANIPULATOR = loadManipulator();

/** Reduz (se preciso) e recomprime a imagem; devolve um URI JPEG e dimensoes. */
async function optimize(
  manipulator: ImageManipulatorModule,
  uri: string,
  width: number,
  height: number,
): Promise<{ uri: string; width: number; height: number }> {
  const context = manipulator.ImageManipulator.manipulate(uri);
  const target = resizeTarget(width, height);
  if (target) context.resize(target);
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    compress: IMAGE_QUALITY,
    format: manipulator.SaveFormat.JPEG,
  });
  return { uri: result.uri, width: result.width, height: result.height };
}

function extensionFor(mimeType: string): string {
  const sub = mimeType.split('/')[1]?.toLowerCase() ?? '';
  if (sub === 'jpeg') return 'jpg';
  if (sub === 'svg+xml') return 'svg';
  return /^[a-z0-9]+$/.test(sub) ? sub : 'jpg';
}

export async function pickImage(
  onPreview?: (preview: PickedImagePreview) => void,
): Promise<PickedImage | null> {
  const picker = PICKER;
  if (!picker) throw new Error('seletor de imagens indisponivel neste build');

  const permission = await picker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('permissao de fotos negada');

  const result = await picker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const manipulator = MANIPULATOR;
  // A otimizacao (redimensionar e recomprimir) e o que demorava segundos. O
  // aviso com a foto original borrada sai agora; o trabalho pesado continua.
  const finalMime = manipulator ? 'image/jpeg' : asset.mimeType ?? 'image/jpeg';
  const localName = `${newId('img_')}.${extensionFor(finalMime)}`;
  onPreview?.({
    uri: asset.uri,
    name: asset.fileName ?? 'imagem',
    mimeType: finalMime,
    width: asset.width,
    height: asset.height,
    localName,
  });

  // Sem o modulo nativo (build antigo): segue com o original para nao quebrar.
  if (!manipulator) {
    const original = await new File(asset.uri).arrayBuffer();
    return {
      name: asset.fileName ?? 'imagem',
      mimeType: finalMime,
      bytes: new Uint8Array(original),
      width: asset.width,
      height: asset.height,
      localName,
    };
  }

  const optimized = await optimize(manipulator, asset.uri, asset.width, asset.height).catch(
    () => null,
  );
  const buffer = await new File(optimized?.uri ?? asset.uri).arrayBuffer();
  return {
    name: asset.fileName ?? 'imagem',
    mimeType: finalMime,
    bytes: new Uint8Array(buffer),
    width: optimized?.width ?? asset.width,
    height: optimized?.height ?? asset.height,
    localName,
  };
}
