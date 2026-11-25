-- Servidor MCP: um unico caderno "Projetos" guarda um registro por projeto. As
-- entradas desse caderno sao os projetos, nao cadernos. O nivel de detalhe
-- (concise/full) e uma preferencia da entrada do projeto, nao do caderno.
ALTER TABLE entries ADD COLUMN summary_detail TEXT NOT NULL DEFAULT 'concise'
    CHECK (summary_detail IN ('concise', 'full'));

-- O caderno do MCP e interno: nasce com id fixo e nao pode ser excluido nem
-- trocar de tipo. O INSERT OR IGNORE mantem a migracao idempotente.
INSERT OR IGNORE INTO notebooks (id, name, color, is_default, kind, created_at, updated_at)
VALUES ('projetos-mcp', 'Projetos', '', 0, 'mcp',
        strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- O detalhe do resumo deixou de ser propriedade do caderno. A coluna da 0039
-- nao e mais lida; remover evita que um cliente tente grava-la.
ALTER TABLE notebooks DROP COLUMN summary_detail;
