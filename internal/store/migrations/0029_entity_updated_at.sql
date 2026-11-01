-- Momento da ultima mudanca de metadados da entidade (nome, icone, "sou eu").
-- O app guarda as mesmas colunas e usa o relogio do servidor para decidir qual
-- escrita vence quando os dois lados editam a mesma entidade. Sem esta coluna,
-- renomear no celular e renomear no painel nao teriam como se reconciliar.
ALTER TABLE entities ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE entities SET updated_at = created_at WHERE updated_at = '';

ALTER TABLE owner_aliases ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE owner_aliases SET updated_at = created_at WHERE updated_at = '';
