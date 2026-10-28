-- Cadernos: cada nota pertence a exatamente um caderno. O caderno padrao
-- ("Notas ao acaso") e criado aqui, recebe as notas que ja existiam e nao pode
-- ser renomeado nem excluido. As cores das tags ficam para o backfill em Go
-- (`backfillTagColors`), que usa a mesma paleta do app e do dashboard.

CREATE TABLE IF NOT EXISTS notebooks (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notebooks_name ON notebooks (name COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notebooks_default
    ON notebooks (is_default) WHERE is_default = 1;

ALTER TABLE entries ADD COLUMN notebook_id TEXT REFERENCES notebooks (id);

INSERT INTO notebooks (id, name, color, is_default, created_at, updated_at)
SELECT 'notas-ao-acaso', 'Notas ao acaso', '', 1,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM notebooks WHERE is_default = 1);

UPDATE entries SET notebook_id = 'notas-ao-acaso' WHERE notebook_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_entries_notebook_id ON entries (notebook_id);
