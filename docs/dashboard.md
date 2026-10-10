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

### 5. Busca
- Campo de busca textual sobre a transcricao.
- Resultados agrupados por entrada, com destaque do termo e link para o trecho.
- Filtros por data, tag e humor.

### 6. Configuracao
- Transcricao: modelo, corte de silencio (`trim_silence`).
- Analise: ligada/desligada, base URL compativel com OpenAI, modelo.
- Aparencia: tema claro/escuro/automatico.
- Observacao: nesta fase (ambiente de desenvolvimento) entrega-se o shell do dashboard;
  as telas acima sao implementadas nas fases seguintes. A tela de configuracao consome
  `GET/PUT /api/v1/settings`.

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
