-- Quem gravou a nota. Vazio significa "segue o padrao do app": com
-- all_notes_mine ligado o autor efetivo e o dono; desligado, nao ha autor.
-- A escolha manual da nota (self/other/mixed) sempre vence o padrao.
ALTER TABLE entries ADD COLUMN author TEXT NOT NULL DEFAULT '';

-- O autor escolhido no aparelho antes do upload. Sem isso a nota criada
-- offline so perderia a escolha quando o audio terminasse de subir.
ALTER TABLE uploads ADD COLUMN author TEXT NOT NULL DEFAULT '';
