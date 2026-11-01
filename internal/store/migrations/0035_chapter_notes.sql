-- Anotacoes de pesquisa do capitulo: texto livre, sem imagens, fora do corpo.
-- Fica numa migration propria porque a 0034 ja pode ter sido aplicada por um
-- build de desenvolvimento; alterar migration aplicada nao cria a coluna.
ALTER TABLE entries ADD COLUMN chapter_notes TEXT NOT NULL DEFAULT '';
