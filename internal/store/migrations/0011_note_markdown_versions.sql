-- O corpo da nota passa a ser markdown (formato canonico do app e do dashboard)
-- e cada campo editavel ganha a sua propria versao. Assim o conflito e detectado
-- campo a campo: renomear no desktop nao briga com escrever no celular.
ALTER TABLE notes ADD COLUMN content_markdown TEXT;
ALTER TABLE notes ADD COLUMN body_updated_at TEXT;
ALTER TABLE entries ADD COLUMN title_updated_at TEXT;
ALTER TABLE entries ADD COLUMN recorded_at_updated_at TEXT;

-- As notas que ja existem comecam com a versao corrente do proprio corpo.
UPDATE notes SET body_updated_at = updated_at WHERE body_updated_at IS NULL;
UPDATE entries SET title_updated_at = updated_at WHERE title_updated_at IS NULL;
UPDATE entries SET recorded_at_updated_at = updated_at WHERE recorded_at_updated_at IS NULL;