/**
 * Chaves de avisos locais guardados no SQLite (`app_flags`).
 *
 * Nao entram em backup nenhum: reinstalar o app, mesmo restaurando backup,
 * faz o aviso de primeira vez voltar.
 */
export const FLAG_PROCESSING_HINT = 'processing_hint_hidden';
