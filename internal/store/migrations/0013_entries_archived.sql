-- Nota arquivada: sai da lista de trabalho sem ser apagada.
--
-- O app ja sabia arquivar (e so no aparelho); falta o servidor saber, para o
-- arquivamento valer nos dois lugares em vez de divergir em silencio.

ALTER TABLE entries ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_entries_archived ON entries (archived, deleted_at);