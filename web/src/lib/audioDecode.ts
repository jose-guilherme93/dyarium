/**
 * Decodificacao do audio na thread principal.
 *
 * O `AudioContext` nao existe dentro de um Web Worker: o byte baixado (ou lido
 * do cofre local) vira PCM aqui e so entao atravessa para o worker de
 * inferencia, que espera mono 16 kHz.
 */

/** Decodifica o arquivo (m4a, ogg, wav...) com o decodificador do navegador. */
export async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(data.slice(0));
  } finally {
    await context.close();
  }
}

/** Audio decodificado para mono 16 kHz, o formato que o Whisper espera. */
export async function toMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  const seconds = buffer.duration * 16000;
  const length = Math.max(1, Math.ceil(seconds));
  const offline = new OfflineAudioContext(1, length, 16000);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}
