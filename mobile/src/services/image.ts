/**
 * Escolha de imagem na galeria do aparelho, com os bytes prontos para enviar.
 *
 * Modulo nativo: so existe depois de um development build novo. O require e
 * tardio de proposito — importar `expo-image-picker` no topo quebraria o app
 * no build atual (modulo nativo ausente) ao abrir a tela da nota.
 */

import { File } from 'expo-file-system';

export interface PickedImage {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

type ImagePickerModule = typeof import('expo-image-picker');

function loadPicker(): ImagePickerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-image-picker') as ImagePickerModule;
  } catch {
    return null;
  }
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
  const buffer = await new File(asset.uri).arrayBuffer();
  return {
    name: asset.fileName ?? 'imagem',
    mimeType: asset.mimeType ?? 'image/jpeg',
    bytes: new Uint8Array(buffer),
  };
}
