-- O upload passa a poder apontar para uma entrada que ainda nao existe.
--
-- Antes, `uploads.entry_id` tinha chave estrangeira para `entries`: a entrada
-- precisava existir antes de comecar a gravar. Com o id gerado pelo cliente (o
-- app cria a nota offline), o upload nasce apontando para uma entrada que so vai
-- existir no complete. A tabela e refeita sem essa chave; quem garante a
-- integridade agora e o complete, que cria a entrada com esse id ou rejeita o
-- audio. O resto das chaves (attachments, transcripts) nao mudam.
--
-- DROP TABLE dentro da transacao da migracao ja desliga as chaves estrangeiras
-- do SQLite enquanto a rebuild acontece (o PRAGMA nao pega efeito aqui).

CREATE TABLE uploads_rebuild (
    id                   TEXT PRIMARY KEY,
    status               TEXT NOT NULL,
    filename             TEXT,
    content_type         TEXT,
    size_bytes           INTEGER NOT NULL DEFAULT 0,
    sha256               TEXT,
    received_bytes       INTEGER NOT NULL DEFAULT 0,
    storage_key          TEXT,
    created_at           TEXT NOT NULL,
    expires_at           TEXT,
    prefix               BLOB,
    next_counter         INTEGER NOT NULL DEFAULT 0,
    title                TEXT,
    recorded_at          TEXT,
    client_key           TEXT,
    entry_id             TEXT,
    result_attachment_id TEXT,
    local_transcribe     INTEGER NOT NULL DEFAULT 0
);

INSERT INTO uploads_rebuild (
    id, status, filename, content_type, size_bytes, sha256, received_bytes,
    storage_key, created_at, expires_at, prefix, next_counter, title, recorded_at,
    client_key, entry_id, result_attachment_id, local_transcribe
)
SELECT
    id, status, filename, content_type, size_bytes, sha256, received_bytes,
    storage_key, created_at, expires_at, prefix, next_counter, title, recorded_at,
    client_key, entry_id, result_attachment_id, local_transcribe
FROM uploads;

DROP TABLE uploads;
ALTER TABLE uploads_rebuild RENAME TO uploads;

CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads (status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_uploads_client_key
    ON uploads (client_key) WHERE client_key IS NOT NULL;