-- Arvore de notas: cada nota pode ter uma nota pai (subnota). Notas sem pai
-- ficam na raiz (o root e sintetico, nao existe como linha).
ALTER TABLE entries ADD COLUMN parent_id TEXT REFERENCES entries (id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_entries_parent_id ON entries (parent_id);
