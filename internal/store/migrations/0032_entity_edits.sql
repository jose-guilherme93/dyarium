-- Uma foto do que uma edicao de entidade mudou, para o "desfazer" do painel.
-- O snapshot guarda as linhas afetadas (entidade, aliases, vinculos e "sou eu"),
-- porque mesclar apaga a origem e soma os vinculos no destino: desfazer exige o
-- estado anterior, nao so o nome.
CREATE TABLE IF NOT EXISTS entity_edits (
    id         TEXT PRIMARY KEY,
    action     TEXT NOT NULL,
    label      TEXT NOT NULL,
    snapshot   TEXT NOT NULL,
    created_at TEXT NOT NULL,
    undone_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_entity_edits_created ON entity_edits (created_at DESC);
