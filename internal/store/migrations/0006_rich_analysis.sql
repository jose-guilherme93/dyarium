-- Analise rica: guarda o JSON completo da extracao (pessoas, lugares, temas,
-- emocoes, momentos-chave, resumo, perguntas e decisoes), o rotulo do
-- sentimento e as entidades normalizadas para consulta agregada.

ALTER TABLE analyses ADD COLUMN data TEXT;
ALTER TABLE analyses ADD COLUMN sentiment_label TEXT;

CREATE TABLE IF NOT EXISTS entities (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,          -- person | place | theme
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (kind, name)
);

CREATE TABLE IF NOT EXISTS entry_entities (
    entry_id   TEXT NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    entity_id  TEXT NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
    count      INTEGER NOT NULL DEFAULT 1,
    relation   TEXT,
    sentiment  REAL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (entry_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_entities_kind_name ON entities (kind, name);
CREATE INDEX IF NOT EXISTS idx_entry_entities_entity ON entry_entities (entity_id);
