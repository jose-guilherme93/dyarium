-- Icone de pagina da entrada, escolhido no painel de projetos. Vazio significa
-- que o cliente decide o fallback; o servidor nao interpreta o valor (emoji ou
-- texto curto) e nao guarda significado nenhum nele.
ALTER TABLE entries ADD COLUMN icon TEXT NOT NULL DEFAULT '';
