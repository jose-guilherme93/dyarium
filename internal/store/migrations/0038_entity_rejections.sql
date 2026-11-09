-- Rotulo livre editavel de uma entidade (escola, gata, personagem) e a memoria
-- de rejeicoes do dono. O rotulo e so exibicao: nao muda tipo, metrica nem
-- chave de sync. A rejeicao diz "este nome nunca e entidade deste tipo" e e
-- aplicada por script antes de persistir, para o vinculo nem chegar ao banco.
ALTER TABLE entities ADD COLUMN label TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS entity_rejections (
    kind       TEXT NOT NULL,
    name       TEXT NOT NULL,
    name_key   TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (kind, name_key)
);
CREATE INDEX IF NOT EXISTS idx_entity_rejections_kind_updated ON entity_rejections (kind, updated_at);
