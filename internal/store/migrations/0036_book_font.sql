-- Fonte do corpo do livro, escolhida entre as fontes de livro auto-hospedadas.
ALTER TABLE notebooks ADD COLUMN body_font TEXT NOT NULL DEFAULT 'newsreader';
