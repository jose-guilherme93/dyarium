-- Tombstones sao a prova permanente de uma exclusao. O conteudo (audio, imagem,
-- corpo, transcricao, analise) pode ser purgado depois da janela de retencao,
-- mas esta linha nunca sai: um ambiente que ficou offline por mais tempo que a
-- janela ainda precisa saber que a nota foi apagada para nao ressuscita-la.
CREATE TABLE IF NOT EXISTS tombstones (
    id         TEXT NOT NULL,
    kind       TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    origin     TEXT NOT NULL DEFAULT 'server',
    PRIMARY KEY (id, kind)
);
CREATE INDEX IF NOT EXISTS idx_tombstones_deleted_at ON tombstones (deleted_at, id);

-- Banco que ja tinha notas na lixeira: a exclusao ja aconteceu, so faltava a
-- prova permanente.
INSERT OR IGNORE INTO tombstones (id, kind, deleted_at, origin)
SELECT id, 'entry', deleted_at, 'server'
FROM entries
WHERE deleted_at IS NOT NULL AND deleted_at <> '';
