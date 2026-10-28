# Dashboard

## Principios visuais

- Sem emojis em nenhum lugar (interface, textos, estados vazios).
- Sem gradientes. Cores solidas e bordas discretas.
- Tipografia sobria: uma familia serifada para titulos e uma sans-serif para o corpo, com
  escala tipografica contida.
- Espacamento baseado em uma unidade de 4px; densidade media.
- Hierarquia por peso, tamanho e cor, nao por decoracao.
- Tema claro e escuro (respeitando `prefers-color-scheme`), ambos sem gradientes.

## Layout base

- Barra lateral a esquerda: navegacao (Entradas, Tags, Humor, Busca, Configuracao), com
  estado selecionado e recolhimento opcional.
- Area central: conteudo da tela atual.
- Painel recolhivel a direita: contexto da entrada aberta (analise, metadados, notas).
- Cabecalho discreto com titulo da tela e acoes contextuais.

Layout responsivo:
- Em telas largas: tres colunas (sidebar, centro, painel).
- Em telas medias: painel recolhe automaticamente; sidebar pode virar icone.
- Em telas estreitas: navegacao colapsa em menu; painel abre como sobreposicao.

## Telas

### 1. Lista de entradas
- Cabecalho com acao primaria (Enviar audio) e filtros (status, tag, intervalo de datas).
- Itens com titulo, data do evento, duracao, status e trecho inicial da transcricao.
- Estados: carregando (esqueleto), vazio (texto orientando o primeiro envio), erro.
- Envio de audio com barra de progresso baseada no upload resumivel (offset recebido).

### 2. Entrada aberta
- Cabecalho: titulo editavel, data, duracao, tags, status.
- Corpo: transcricao com segmentos e marcas de tempo; reprodução do audio cifrado
  (decifrado sob demanda) com sincronizacao pela marca de tempo do segmento.
- Abas: Transcricao, Analise, Notas, Anexos e Links.
- Acoes: retranscrever, adicionar tag, exportar texto.

### 3. Painel de analise
- Sentimento: indicador simples (positivo/neutro/negativo) com valor numerico.
- Emocoes: lista com rotulos e intensidades.
- Pessoas e lugares: listas de mencoes.
- Resumo: paragrafo curto.
- Estado claro quando a analise esta desligada ou ainda nao executou.

### 4. Humor
- Serie temporal do sentimento por data do evento.
- Filtros por intervalo e por tag.
- Visual: linha simples e pontos; sem gradientes nem preenchimentos chamativos.
- Estado vazio quando nao ha analises suficientes.

### 5. Mapa de relacoes
- Centro fixo no dono do diario (`owner_name`; "Você" quando vazio), com pessoas,
  lugares e temas em volta. O tamanho do no e relativo ao maior da visao atual; a
  aresta engorda com o peso (notas em comum ou mencoes).
- Filtros por tipo (pessoas, lugares, temas, decisoes), caderno, periodo e busca. Clicar
  abre o detalhe com mencoes, notas e momentos-chave; "Expandir" abre o grafo local da
  entidade (notas e entidades daquelas notas). "Renomear" corrige a grafia e o nome antigo
  vira alias para as proximas analises.
- Canvas com forca local (sem dependencia nova), zoom/pan, arrastar e "Ajustar a tela".
  O grafo inclui todas as notas, inclusive as de autor "outros"; o autor nao filtra o
  mapa.

### 6. Busca
- Campo de busca textual sobre a transcricao.
- Resultados agrupados por entrada, com destaque do termo e link para o trecho.
- Filtros por data, tag e humor.

### 7. Configuracao
- Transcricao: modelo, corte de silencio (`trim_silence`).
- Analise: ligada/desligada, base URL compativel com OpenAI, modelo.
- Autor: nome do dono e "todas as notas sao minhas" (padrao dos audios sem escolha).
- Aparencia: tema claro/escuro/automatico.
- Observacao: nesta fase (ambiente de desenvolvimento) entrega-se o shell do dashboard;
  as telas acima sao implementadas nas fases seguintes. A tela de configuracao consome
  `GET/PUT /api/v1/settings`.

### 8. Importação do Notion
- Ação "Notion" no menu de nova nota. Recebe o export HTML do Notion como `.zip` ou
  como pasta descompactada; o CSV e o Markdown do Notion não são lidos.
- Uma página HTML vira uma nota. A página de lista/database do export é ignorada.
- O título vem de `h1.page-title` (ou do nome do arquivo). O corpo preserva a ordem do
  Notion: descrição, conteúdo útil das propriedades (na ordem da tabela) e corpo.
  Imagens do corpo ficam no ponto em que aparecem; imagens da propriedade `Media`
  entram no topo, junto com os links de propriedades como `Post URL`.
- A data original vem da propriedade escolhida na revisão (`Criado em`, `Data
  original` etc.) e vai para `recorded_at`. A data de importação fica em `created_at`
  e só aparece em Detalhes. Datas sem ano usam o ano da exportação, ajustável.
- Tags da propriedade `Tags` viram tags. As demais propriedades ficam no relatório
  de limitações.
- Comentários de página e de bloco do export HTML entram como citação no corpo,
  com o autor; os da página ficam no começo da nota e os de bloco no lugar do
  bloco. A propriedade `Comments` (métrica) continua fora. Reimportar acrescenta
  às notas já existentes só os comentários que faltam, no começo, com um
  interruptor para desligar; o corpo delas não é reescrito.
- O botão "Criar caderno Notion" (um clique) cria o caderno de mesmo nome na
  importação, ou reutiliza o que já existir. Todas as notas ficam nele. Se nada for
  importado, o caderno vazio é removido.
- Reimportar o mesmo export é idempotente: o id da entrada é o id da página do
  Notion. Nota já existente não tem o corpo sobrescrito; se estiver em outro
  caderno, é movida para o caderno escolhido.
- Limitações mostradas na tela: ícone e capa da página, cores, colunas, synced blocks,
  sumário automático, arquivos/PDF/vídeo/áudio anexados, imagens externas (http) e
  propriedades de metadados não entram. Imagens locais (do export) viram anexos.

## Comportamento reativo

- Atualizacoes em tempo real por SSE (`/api/v1/events`), com retomada por `Last-Event-ID`.
- A lista e o detalhe refletem mudancas de status sem recarregar a pagina.
- Otimismo controlado: acoes do usuario atualizam a interface e sao reconciliadas com a
  resposta do servidor.
- Estados de carregamento e erro sempre explicitos e sem emojis.

## Acessibilidade

- Contraste adequado em ambos os temas.
- Navegacao por teclado com foco visivel.
- Rotulos ARIA nas regioes (sidebar, main, painel) e nos controles.

## Stack e responsabilidades

- React + Vite + TypeScript.
- Editor de notas com BlockNote.
- Estilos em CSS puro/modules; sem framework utilitario.
- Testes de frontend com Vitest.
- Autenticacao: a interface solicita o token uma vez e o envia como Bearer nas chamadas;
  o token e guardado localmente no navegador.
