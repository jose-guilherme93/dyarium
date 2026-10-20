-- Metadados imutaveis da entrada que o upload vai criar: a hora de criacao
-- original (nao a hora do upload) e a origem (upload normal ou importado).
-- O `created_at` da tabela uploads continua sendo a hora em que o upload comecou.
ALTER TABLE uploads ADD COLUMN entry_created_at TEXT;
ALTER TABLE uploads ADD COLUMN entry_source TEXT;
