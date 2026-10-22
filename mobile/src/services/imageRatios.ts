import { Image } from 'react-native';

/**
 * Cache de proporcao (largura/altura) das imagens da nota. O leitor mede as
 * imagens ao abrir; o editor nativo usa a mesma medida para montar o HTML com
 * `width`/`height` numericos (o parser nativo nao entende porcentagem).
 */
const ratios = new Map<string, number>();
const pending = new Map<string, Promise<number | undefined>>();

export function cachedImageRatio(uri: string): number | undefined {
  return ratios.get(uri);
}

export function imageRatio(uri: string, fallback = 4 / 3): number {
  const ratio = ratios.get(uri);
  return ratio && Number.isFinite(ratio) && ratio > 0 ? ratio : fallback;
}

export function rememberImageRatio(uri: string, ratio: number): void {
  if (Number.isFinite(ratio) && ratio > 0) ratios.set(uri, ratio);
}

/** Mede uma imagem uma unica vez; falhas ficam sem proporcao (usa o fallback). */
export function measureImageRatio(uri: string): Promise<number | undefined> {
  const cached = ratios.get(uri);
  if (cached) return Promise.resolve(cached);
  const running = pending.get(uri);
  if (running) return running;

  const promise = new Promise<number | undefined>((resolve) => {
    try {
      Image.getSize(
        uri,
        (width, height) => {
          if (width <= 0 || height <= 0) {
            resolve(undefined);
            return;
          }
          const ratio = width / height;
          ratios.set(uri, ratio);
          resolve(ratio);
        },
        () => resolve(undefined),
      );
    } catch {
      resolve(undefined);
    }
  });
  pending.set(uri, promise);
  void promise.finally(() => pending.delete(uri));
  return promise;
}
