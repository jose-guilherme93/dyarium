-- Nomes alternativos de uma entidade. Renomear "Mariana" para "Marianna"
-- mantem o id da entidade e guarda o nome antigo aqui, para toda analise futura
-- que mencionar "Mariana" cair na mesma pessoa/lugar/decisao.
CREATE TABLE IF NOT EXISTS entity_aliases (
    id         TEXT PRIMARY KEY,
    entity_id  TEXT NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    name       TEXT NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL,
    UNIQUE (kind, name)
);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_entity_id ON entity_aliases (entity_id);
