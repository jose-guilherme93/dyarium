-- Indice para o dedupe por conteudo: busca de uma entrada ativa pelo sha256.
-- Parcial porque so entradas nao removidas participam do dedupe.
CREATE INDEX IF NOT EXISTS idx_entries_sha256_active
    ON entries (sha256)
    WHERE deleted_at IS NULL;
