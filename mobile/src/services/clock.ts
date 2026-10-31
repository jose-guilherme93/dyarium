/**
 * Relogio de versao do aparelho. A implementacao mora em `services/db`, junto de
 * `app_flags` e do `upsertRecording` que carimba as edicoes: importar daqui para
 * la criava um ciclo (`db -> clock -> db`) que o Metro acusava. Este modulo e a
 * fachada usada pelo resto do app.
 */

export { clockNode, clockNow, observeVersions as observeVersion } from './db';
