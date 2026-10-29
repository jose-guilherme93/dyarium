-- Dispositivo que processou a analise quando ela veio do navegador ("browser").
-- O id e um identificador anonimo da instalacao do navegador; o nome e o rotulo
-- curto (navegador, sistema e placa). Serve para o painel dizer "neste PC" com o
-- nome do computador, e nao para decidir nada no processamento.
ALTER TABLE analyses ADD COLUMN device_id TEXT NOT NULL DEFAULT '';
ALTER TABLE analyses ADD COLUMN device_name TEXT NOT NULL DEFAULT '';
