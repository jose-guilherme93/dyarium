/**
 * A janela do Android nao encolhe quando o teclado abre.
 *
 * Com `adjustResize` (o padrao), a janela muda de tamanho em etapas, conforme
 * o teclado anima: cada etapa refaz o layout da nota inteira, e o teclado
 * "danca" no meio da tela.
 *
 * Com `adjustNothing`, a janela nunca muda de tamanho: o app reserva o espaco
 * do teclado (o `paddingBottom` da barra de acoes). A nota nao rola sozinha: o
 * cursor e o do Android, e rolar o trecho inteiro para o topo a cada toque
 * fazia a nota pular sem motivo.
 */

const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withKeyboardLayout(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) return config;

    for (const activity of application.activity ?? []) {
      const name = activity.$?.['android:name'] ?? '';
      // No prebuild o nome e relativo (".MainActivity"); no manifesto
      // mergeado ele vem completo.
      if (!name.endsWith('MainActivity')) continue;
      activity.$['android:windowSoftInputMode'] = 'adjustNothing';
    }
    return config;
  });
};
