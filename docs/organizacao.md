# Organizacao: cadernos e tags

Este documento registra as decisoes de produto da organizacao da biblioteca. O
contrato HTTP esta em `api.md`; o modelo de dados, em `modelo-de-dados.md`.

## Modelo mental

- **Caderno** e a colecao onde a nota mora. Toda nota tem exatamente um, e o
  padrao "Notas ao acaso" existe sempre.
- **Tag** e o assunto transversal: uma nota pode ter varias, e a mesma tag
  atravessa cadernos.
- Nao ha subnotas. O web nao cria mais subnotas e a lista e plana; os dados
  antigos continuam no banco ate uma remocao futura.

## App

- A abertura fria entra no **ultimo caderno** (preferencia local, nao
  sincronizada). O voltar do Android sai do app; a lista de cadernos e aberta
  pelo nome do caderno no cabecalho (tela cheia).
- Com um unico caderno, ele abre direto; o botao de cadernos continua acessivel
  para criar outro.
- A lista de cadernos usa a ordem de criacao, com "Notas ao acaso" no fim e um
  toggle A-Z local. Cada item mostra cor, contagem de notas ativas e a data da
  ultima nota (`recorded_at`).
- Excluir um caderno move as notas para "Notas ao acaso", com confirmacao. O
  padrao nao pode ser renomeado nem excluido.
- No caderno aberto ha um toggle grande de duas visoes:
  - **Recentes** (padrao, esquerda): todas as notas ativas, de qualquer caderno,
    ordenadas por `updated_at` decrescente; cada card mostra o caderno. Abrir
    uma nota nao muda a ordem: so uma edicao real conta como atividade.
  - **Caderno** (direita): notas do caderno atual na ordem temporal
    (`recorded_at` decrescente, agrupadas por ano), com arquivadas no fim.
  O toggle troca a lista inteira; nao existe uma secao "Paginas recentes" acima
  da linha do tempo. Busca e tags acompanham a visao: globais em Recentes,
  restritas ao caderno em Caderno.
- A busca de "Cadernos" e global (todos os cadernos, inclusive arquivadas);
  abrir um resultado nao troca o caderno selecionado.
- O FAB de criar nota so existe dentro de um caderno. Compartilhamento, audio
  rapido e deep link vao para o ultimo caderno aberto; a revisao do import
  permite trocar.
- Filtro de tags: multiplo com **E**, contadores contextuais, "Todas" para
  limpar, reset ao entrar no caderno. A faixa rola na horizontal com fade nas
  bordas; so aparecem tags usadas no caderno.
- Cards mostram ate 2 tags + "+N". Na nota, a linha abaixo da data tem o caderno
  (toque troca) e as tags (toque remove, "+ tag" abre o seletor).
- "Gerenciar tags" fica no fim da faixa: renomear (mesclando se o nome ja
  existir) e excluir. A cor e automatica; a edicao manual de cor fica para
  depois.

## Web

- Sidebar estritamente por caderno: seletor no topo, toggle Recentes/Caderno,
  filtro de tags e gerenciador de tags. Recentes e o padrao e mostra todos os
  cadernos por `updated_at`; Caderno mostra o caderno ativo por `recorded_at`.
  Sem "Todas as notas" permanente.
- O aside da nota tem um seletor de caderno; o `TagEditor` usa as cores pastel
  do servidor.
- Subnotas estao desativadas: sem botao de nova subnota e sem aninhamento na
  lista.

## Sincronizacao

- O app e o servidor sao espelhos bidirecionais. Alteracoes de caderno e tags
  feitas offline entram na fila e sobem quando houver rede.
- Conflito: a ultima gravacao vence para caderno e para o conjunto de tags; o
  tratamento de titulo/data/corpo continua com versao por campo.
- O ultimo caderno aberto e ordenacao A-Z sao preferencias locais de cada
  dispositivo; nao sao propriedades da nota e nao sincronizam.
