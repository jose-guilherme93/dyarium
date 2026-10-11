-- Metadados opcionais vindos do cliente no inicio do upload (app movel) e a
-- chave de idempotencia por gravacao, que evita notas duplicadas quando a
-- resposta do POST se perde e o cliente reenvia.

ALTER TABLE uploads ADD COLUMN title TEXT;
ALTER TABLE uploads ADD COLUMN recorded_at TEXT;
ALTER TABLE uploads ADD COLUMN client_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_uploads_client_key
    ON uploads (client_key) WHERE client_key IS NOT NULL;
