-- Quantos trechos ficaram sem revisao porque a resposta do modelo nao serviu
-- (formato inaceitavel, janela que falhou ou trava de aceitacao). Sem esta
-- coluna o painel nao distingue "revisou e nao mudou nada" de "a revisao nao
-- chegou a ser aplicada" — que foi exatamente o defeito que passou despercebido.
--
-- Append-only: a 0018 nao se edita. A revisao tambem passa a ser gravada por
-- janela (transcript_revisions ja existe desde a 0018).
ALTER TABLE transcripts ADD COLUMN revised_rejected INTEGER NOT NULL DEFAULT 0;
