-- Detalhe do resumo de projeto gravado pelo servidor MCP. "concise" mostra uma
-- linha por item; "full" mostra o resumo e o detalhe de cada item. O valor e uma
-- preferencia do caderno, nao do registro: vale para todo resumo novo.
ALTER TABLE notebooks ADD COLUMN summary_detail TEXT NOT NULL DEFAULT 'concise'
    CHECK (summary_detail IN ('concise', 'full'));
