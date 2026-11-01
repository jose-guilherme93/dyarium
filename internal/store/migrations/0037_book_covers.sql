-- Capa do livro: a imagem recortada pelo dashboard, uma por livro. O endpoint
-- entrega os bytes e a lista de cadernos so informa que existe capa.
CREATE TABLE IF NOT EXISTS book_covers (
    notebook_id  TEXT PRIMARY KEY REFERENCES notebooks (id) ON DELETE CASCADE,
    content_type TEXT NOT NULL,
    image        BLOB NOT NULL,
    updated_at   TEXT NOT NULL
);
