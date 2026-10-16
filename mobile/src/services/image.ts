/**
 * Escolha de imagem na galeria, com os bytes prontos para enviar.
 *
 * Modulo nativo: so existe depois de um development build novo. O require e
 * tardio de proposito — importar `expo-image-picker`/`expo-image-manipulator` no
 * topo quebraria o app no build atual (modulo nativo ausente) ao abrir a nota.
 *
 * Toda foto e reduzida (se preciso) e recomprimida em JPEG de alta qualidade
 * antes de entrar na nota: assim o editor abre rapido, sem perda visivel.
 */

import { File } from 'expo-file-system';

import { IMAGE_QUALITY, resizeTarget } from '@/core/image';

export interface PickedImage {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
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

/** Reduz (se preciso) e recomprime a imagem; devolve um URI JPEG. */
async function optimize(
  manipulator: ImageManipulatorModule,
  uri: string,
  width: number,
  height: number,
): Promise<string> {
  const context = manipulator.ImageManipulator.manipulate(uri);
  const target = resizeTarget(width, height);
  if (target) context.resize(target);
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    compress: IMAGE_QUALITY,
    format: manipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

export async function pickImage(): Promise<PickedImage | null> {
  const picker = loadPicker();
  if (!picker) return null;

  const permission = await picker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await picker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  const manipulator = loadManipulator();
  // Sem o modulo nativo (build antigo): segue com o original para nao quebrar.
  if (!manipulator) {
    const original = await new File(asset.uri).arrayBuffer();
    return {
      name: asset.fileName ?? 'imagem',
      mimeType: asset.mimeType ?? 'image/jpeg',
      bytes: new Uint8Array(original),
    };
  }

  const optimizedUri = await optimize(manipulator, asset.uri, asset.width, asset.height).catch(
    () => asset.uri,
  );
  const buffer = await new File(optimizedUri).arrayBuffer();
  const base = (asset.fileName ?? 'imagem').replace(/\.[^.]+$/, '');
  return {
    name: `${base}.jpg`,
    mimeType: 'image/jpeg',
    bytes: new Uint8Array(buffer),
  };
}
