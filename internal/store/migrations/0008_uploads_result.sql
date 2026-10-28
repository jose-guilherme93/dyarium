-- Guarda o anexo resultante do complete. Sem isso, repetir o complete (por
-- exemplo, quando a resposta 201 se perde na rede) devolve 409 e o audio fica
-- orfao: o cliente nunca aprende o attachment_id. Com a coluna, o complete
-- passa a ser idempotente tambem no modelo de varios audios por nota.

ALTER TABLE uploads ADD COLUMN result_attachment_id TEXT;
