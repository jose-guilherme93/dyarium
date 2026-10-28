-- O cliente se responsabiliza pela analise desta entrada (analisa no aparelho
-- ou deixa a etapa desligada). O servidor transcreve, mas nao enfileira analyze.
ALTER TABLE uploads ADD COLUMN local_analysis INTEGER NOT NULL DEFAULT 0;
