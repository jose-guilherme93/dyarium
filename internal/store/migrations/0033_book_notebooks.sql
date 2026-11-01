-- Modo escritor: um caderno pode ser um livro e suas entradas viram capitulos.
-- A migracao e so de schema: nenhum dado existente e reescrito.

ALTER TABLE notebooks ADD COLUMN kind TEXT NOT NULL DEFAULT 'notes';
ALTER TABLE notebooks ADD COLUMN subtitle TEXT NOT NULL DEFAULT '';
ALTER TABLE notebooks ADD COLUMN author TEXT NOT NULL DEFAULT '';
ALTER TABLE notebooks ADD COLUMN synopsis TEXT NOT NULL DEFAULT '';
ALTER TABLE notebooks ADD COLUMN language TEXT NOT NULL DEFAULT '';
ALTER TABLE notebooks ADD COLUMN goal_words INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notebooks ADD COLUMN book_status TEXT NOT NULL DEFAULT 'drafting';

ALTER TABLE entries ADD COLUMN chapter_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE entries ADD COLUMN chapter_position REAL;
ALTER TABLE entries ADD COLUMN chapter_status TEXT NOT NULL DEFAULT '';
ALTER TABLE entries ADD COLUMN chapter_goal_words INTEGER NOT NULL DEFAULT 0;
ALTER TABLE entries ADD COLUMN chapter_synopsis TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_entries_chapter
  ON entries(notebook_id, chapter_position);
