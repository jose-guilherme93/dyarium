-- Origem do artefato de analise: "app" (feita no aparelho e enviada), "server"
-- (pipeline deste servidor) ou "api" (provedor de terceiro). Serve para a
-- interface dizer de onde veio o texto, nao para decidir quem processa.
ALTER TABLE analyses ADD COLUMN origin TEXT NOT NULL DEFAULT 'server';
