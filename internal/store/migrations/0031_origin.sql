-- Quem criou a entrada. Fica gravado so na criacao e nunca muda: e o que deixa
-- um ambiente saber que a nota veio de fora (sem tornar nada somente leitura).
-- Vazio nas linhas antigas: a origem nao foi registrada na epoca.
ALTER TABLE entries ADD COLUMN origin_instance TEXT NOT NULL DEFAULT '';
ALTER TABLE entries ADD COLUMN origin_kind TEXT NOT NULL DEFAULT '';
