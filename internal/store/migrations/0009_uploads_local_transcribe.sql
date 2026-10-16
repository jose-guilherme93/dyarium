-- Marca o upload cujo audio sera transcrito no aparelho (transcricao local).
-- O servidor nao enfileira a transcricao nesse caso; o cliente envia o texto
-- pronto depois, via PUT /api/v1/entries/{id}/transcript.

ALTER TABLE uploads ADD COLUMN local_transcribe INTEGER NOT NULL DEFAULT 0;
