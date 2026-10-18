/**
 * Redimensiona fotos antes do upload, como o app ja faz na importacao.
 *
 * O servidor guarda o original cifrado e serve exatamente o que recebeu; sem
 * isso, uma foto de camera de 25 MiB virava o thumbnail da nota no dashboard e
 * era decifrada inteira a cada abertura. O limite de 2048 px no maior lado
 * mantem a foto nitida na largura da nota e corta a maior parte dos bytes.
 */

const MAX_SIDE = 2048;
const QUALITY = 0.85;

/** Tipos que valem a pena recomprimir. SVG/GIF ficam intactos. */
export function shouldShrink(type: string, width: number, height: number): boolean {
  if (!/^image\/(jpeg|png|webp)$/i.test(type)) {
    return false;
  }
  return Math.max(width, height) > MAX_SIDE;
}

export async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    return file;
  }
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    if (!shouldShrink(file.type, bitmap.width, bitmap.height)) {
      return file;
    }
    const scale = MAX_SIDE / Math.max(bitmap.width, bitmap.height);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return file;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", QUALITY);
    });
    if (!blob || blob.size >= file.size) {
      return file;
    }
    const base = file.name.replace(/\.[^.]+$/, "") || "foto";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}
