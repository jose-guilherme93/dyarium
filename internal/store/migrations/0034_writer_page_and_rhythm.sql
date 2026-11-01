-- Modo escritor: pagina do livro, ritmo de escrita e planejamento do capitulo.

-- A folha do editor, da leitura e da exportacao sai daqui. A fonte e fixa no
-- produto; tamanho de corpo e entrelinha sao ajustaveis.
ALTER TABLE notebooks ADD COLUMN page_size TEXT NOT NULL DEFAULT '6x9';
ALTER TABLE notebooks ADD COLUMN page_margin_mm INTEGER NOT NULL DEFAULT 19;
ALTER TABLE notebooks ADD COLUMN body_px INTEGER NOT NULL DEFAULT 18;
ALTER TABLE notebooks ADD COLUMN body_leading INTEGER NOT NULL DEFAULT 160;
ALTER TABLE notebooks ADD COLUMN daily_goal_words INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notebooks ADD COLUMN deadline TEXT NOT NULL DEFAULT '';

-- Beats do capitulo: uma linha por beat, planejamento que nao entra no texto.
ALTER TABLE entries ADD COLUMN chapter_beats TEXT NOT NULL DEFAULT '';

-- Palavras liquidas gravadas por livro e por dia. A data e a do servidor.
CREATE TABLE IF NOT EXISTS writing_days (
    notebook_id TEXT NOT NULL REFERENCES notebooks (id) ON DELETE CASCADE,
    day         TEXT NOT NULL,
    words       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (notebook_id, day)
);

CREATE INDEX IF NOT EXISTS idx_writing_days_day ON writing_days (day);
