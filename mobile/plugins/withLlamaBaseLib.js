/**
 * O llama.rn carrega `librnllama.so` explicitamente no Java, mesmo quando usa
 * uma variante de CPU (`librnllama_v8_2.so` etc.). O build com
 * `rnllamaVariants` reduzido deixa esse arquivo base de fora do APK, e o
 * `install()` falha com "JSI bindings not installed".
 *
 * Este plugin copia o base do node_modules para o jniLibs do app antes do
 * Gradle empacotar. Assim mantemos o build rapido e o carregamento funciona.
 */

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SOURCE = 'node_modules/llama.rn/android/src/main/jniLibs/arm64-v8a/librnllama.so';
const DEST = 'android/app/src/main/jniLibs/arm64-v8a/librnllama.so';

module.exports = function withLlamaBaseLib(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const root = config.modRequest.projectRoot;
      const source = path.join(root, SOURCE);
      const dest = path.join(root, DEST);
      if (!fs.existsSync(source)) {
        throw new Error(`librnllama.so base nao encontrado em ${source}`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(source, dest);
      return config;
    },
  ]);
};
