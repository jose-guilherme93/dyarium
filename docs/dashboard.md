# Dashboard

## Principios visuais

- Sem emojis em nenhum lugar (interface, textos, estados vazios).
- Sem gradientes. Cores solidas e bordas discretas.
- Tipografia sobria: uma familia serifada para titulos e uma sans-serif para o corpo, com
  escala tipografica contida.
- Espacamento baseado em uma unidade de 4px; densidade media.
- Hierarquia por peso, tamanho e cor, nao por decoracao.
- Tema claro e escuro (respeitando `prefers-color-scheme`), ambos sem gradientes.
- O que ainda nao chegou aparece como skeleton no formato do conteudo (lista de notas,
  configuracoes, lixeira, notificacoes, tags, historico). Nada de "Carregando..." solto
  quando da para mostrar a forma do que vai entrar.
- Listas entram de cima para baixo, na ordem em que foram carregadas, e os itens ja
  montados nao reiniciam quando a lista atualiza.
- Movimento curto (menus, gavetas, coluna da nota) respeita `prefers-reduced-motion`.

## Layout base

- Barra lateral a esquerda: a lista de notas e, no rodape, Mapa, Escrita, Processamento e
  Configuracoes, com estado selecionado e recolhimento opcional.
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
- Clique direito na nota abre o menu do proprio dashboard: abrir, selecionar, selecionar
  todas, arquivar e apagar. A selecao multipla mostra a barra de acoes no topo da lista e
  permite arquivar ou apagar em lote, sem sair da tela.
- Estados: carregando (esqueleto), vazio (texto orientando o primeiro envio), erro.
- Envio de audio com barra de progresso baseada no upload resumivel (offset recebido).
- A coluna e o menu ficam presos a janela: so a lista rola dentro dela, e o conteudo
  central rola ate o fim com folga na borda inferior.

### 2. Entrada aberta
- Header fixo com as acoes da nota (imagem, link, audio, markdown, propriedades, mais): o
  texto rola por baixo e a barra nao sai do lugar.
- Cabecalho: titulo editavel, data, duracao, tags, status.
- Corpo: transcricao com segmentos e marcas de tempo; reprodução do audio cifrado
  (decifrado sob demanda) com sincronizacao pela marca de tempo do segmento.
- Abas: Transcricao, Analise, Notas, Anexos e Links.
- Acoes: retranscrever, adicionar tag, exportar texto.

### 3. Painel de analise
- A analise fica no topo da coluna da direita, que e fixa: rolar o texto nao move o painel.
- **Analisar** e a unica acao; ao lado, o interruptor **neste PC** liga o worker do
  navegador (sem processar nada sozinho) e a seta abre o laboratorio (`/lab`), com
  **Voltar** devolvendo a nota.
- Enquanto roda, o bloco mostra o que esta acontecendo (bloco lido, medidor, tempo, tok/s)
  e **no servidor** devolve o job para a VPS quando o PC esta lento.
- A analise feita no navegador guarda e mostra o aparelho que processou (navegador, sistema
  e placa); e o selo **neste PC**, nao uma API de terceiro.
- O laboratorio mostra por que a WebGPU falta (`não · HTTPS`, `não · driver`,
  `não · navegador`) e permite escolher quantos nucleos a analise usa: **Todos** por padrao,
  ou **Metade** para a maquina continuar respondendo.
- Sentimento: indicador simples (positivo/neutro/negativo) com valor numerico.
- Emocoes: lista com rotulos e intensidades.
- Pessoas e lugares: listas de mencoes.
- Resumo: paragrafo curto.
- Estado claro quando a analise esta desligada ou ainda nao executou.

### 4. Mapa de relacoes
- Centro fixo no dono do diario (`owner_name`; "Você" quando vazio), com pessoas,
  lugares e temas em volta. O tamanho do no e relativo ao maior da visao atual; a
  aresta engorda com o peso (notas em comum ou mencoes).
- Filtros por tipo (pessoas, lugares, temas, decisoes), caderno, periodo e busca. Clicar
  abre o detalhe com mencoes, notas e os **trechos** que provam a entidade: o segmento da
  transcricao com o tempo do audio ou a frase do texto, com a leitura da analise logo
  acima. Cada trecho abre a nota de origem. Uma rajada de aneis sai da bola escolhida a
  cada intervalo e um anel fixo a mantem em destaque enquanto o detalhe esta aberto.
  "Expandir" abre o grafo local da entidade (notas e entidades daquelas notas).
  "Renomear" corrige a grafia e o nome antigo vira alias para as proximas analises.
- O trilho direito guarda os insights enquanto nenhuma bola esta selecionada: as abas
  Pessoas, Lugares, Temas, Decisoes e Humor listam o que a analise extraiu, com mencoes e
  notas. Clicar numa entidade acende e centraliza a bola no mapa; fechar o detalhe volta
  para a lista.
- Humor: serie do sentimento por data do evento, com o tom medio e as notas de cada dia.
- Canvas com forca local (sem dependencia nova), zoom/pan, arrastar e "Ajustar a tela".
  O grafo inclui todas as notas, inclusive as de autor "outros"; o autor nao filtra o
  mapa.

### 5. Busca
- Campo de busca textual sobre a transcricao.
- Resultados agrupados por entrada, com destaque do termo e link para o trecho.
- Filtros por data, tag e humor.

### 6. Configuracao
- Transcricao: modelo (lista ggml com atalho para o catalogo do whisper.cpp), corte
  de silencio (`trim_silence`) e Deepgram com modelo (`nova-3`, `nova-2` etc.) e
  atalho para criar a chave no console.
- Analise: ligada/desligada, base URL compativel com OpenAI e modelo. O seletor de
  provedor ja preenche base URL e modelo e mostra o estado da chave (definida ou
  ausente), o atalho para criar a chave e o link dos modelos no console
  (OpenRouter, OpenCode Zen/Go, Google Gemini, Groq, DeepSeek, Mistral, xAI, Ollama
  e llama.cpp).
- Autor: nome do dono e "todas as notas sao minhas" (padrao dos audios sem escolha).
- Aparencia: tema claro/escuro/automatico.
- Observacao: nesta fase (ambiente de desenvolvimento) entrega-se o shell do dashboard;
  as telas acima sao implementadas nas fases seguintes. A tela de configuracao consome
  `GET/PUT /api/v1/settings`.

### 7. Importação do Notion
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

### 8. Processamento no PC (`neste PC` e `/lab`)
- No painel **Insights** da nota, ao lado de **Analisar**, fica o botao **neste PC**.
  Ele mede a maquina, mostra o perfil, os modelos e o tamanho do download e liga o
  worker. Ligar nao processa nada: o PC so pega a nota que o usuario mandar analisar.
  A analise anterior e substituida quando o usuario pede explicitamente por essa nota.
- O laboratorio `/lab` continua para medir CPU/GPU/VRAM, comparar perfis, ver a
  fila e trocar o modelo. O botao da nota usa o perfil salvo pelo laboratorio.

- Pagina propria, tambem acessivel em `/lab`. O modo so existe com esta aba aberta.
- **Este computador**: navegador, GPU, VRAM, RAM, nucleos, WebGPU, threads e espaco.
  Botoes para medir CPU/GPU, testar a VRAM por alocacao e exportar o relatorio em JSON.
- **Modelos**: cinco perfis (0 minimo a 4 maximo). Cada perfil mostra o Whisper, o LLM,
  o tamanho de cada um e o total do download; o usuario confirma antes de baixar.
  "Trocar modelo" permite forcar uma combinacao no laboratorio.
- **Processar neste PC**: registra o worker, baixa o que falta com progresso e fica
  ocioso. A VPS continua processando a fila; so o **Analisar** de uma nota pede que
  este PC a processe, e apenas ela.
- **Fila**: reservados, em curso, retentativas, parados, notas feitas e falhas nesta
  maquina. O trabalho atual mostra tipo, titulo, etapa, blocos lidos e tokens/s.
- **Parar**: encerra depois da nota atual; a presenca expira e o servidor reassume.
- Diagnostico: nenhuma frase solta; os numeros ficam na grade e a explicacao de cada
  aviso aparece no `title` do item.

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
