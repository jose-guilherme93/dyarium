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

- Barra lateral a esquerda: a lista de notas e, no rodape, Mapa, Estatísticas, Processamento e
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
- Cada linha da transcricao completa mostra um lapis discreto a direita no hover (e
  sempre no toque). O menu do lapis edita o trecho e transforma em **Tarefa**, **Ideia**
  ou **Citacao**: a captura vira uma nota acumulada no caderno "Tarefas e ideias", com a
  tag do tipo, igual ao app. O trecho ganha um selo colorido do tipo.
- O antigo icone de IA dentro da linha saiu. **Ver texto original** (so quando a revisao
  mudou a linha) agora mora no mesmo menu do lapis; o chip de revisao que ficava acima da
  transcricao tambem saiu.
- A transcricao e um texto corrido, com a entrelinha dos paragrafos e sem buraco entre
  os trechos; o lapis fica na altura da minutagem, a direita.
- Numa transcricao longa, o player rola para fora. Um botao redondo de play/pause fica
  preso no meio da altura da tela enquanto o bloco de audio estiver visivel, para pausar
  sem voltar ao topo.
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
  `não · navegador`), permite escolher quantos nucleos a analise usa (**Todos** por
  padrao, ou **Metade**) e deixa forcar **CPU** quando o offload da GPU deixa a
  maquina lenta. A tela mostra o backend e os threads que o motor abriu de fato.
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
  A grade e densa: cada fato ocupa uma linha, com a explicacao no `title`.
- **Em uso**: mostra o backend e os threads que o motor abriu de verdade, nao os que o
  navegador promete. Com offload de GPU, o selo e **GPU**; a CPU usa **N threads**.
  Sem isolamento (COOP/COEP) a linha vira **1 thread** e o aviso explica o porquê.
- **Modelos**: cinco perfis (0 minimo a 4 maximo). Cada perfil mostra o Whisper, o LLM,
  o tamanho de cada um e o total do download; o usuario confirma antes de ligar.
  "Trocar modelo e processador" permite forcar uma combinacao, escolher **CPU** (todos
  os nucleos) ou **GPU**, e usar metade dos nucleos.
- **Processar neste PC**: registra o worker e fica ocioso; os pesos baixam na primeira
  nota de cada tipo (analise de texto nao paga o download do Whisper). A VPS continua
  processando a fila; so o **Analisar** de uma nota pede que este PC a processe.
- **Fila**: reservados, em curso, retentativas, parados, notas feitas e falhas nesta
  maquina, num bloco compacto de seis numeros. O trabalho atual mostra tipo, titulo,
  etapa, blocos lidos e tokens/s.
- **Desligar**: o interruptor no topo do cartao e a unica acao. Ligado, o PC continua
  disponivel ate o usuario desligar; desligado no meio de uma nota, termina a passada
  atual e para. Nao existe "parar depois de uma nota" escondido num botao.
- **Analise viva**: a ficha da nota mostra o documento composto a cada bloco lido
  (tom, emocoes, pessoas, lugares, temas, eventos, decisoes, tarefas, ideias,
  epifanias e momentos), com os chips entrando em cascata curta. O medidor de blocos
  continua no topo, e a cobertura marca a leitura como parcial ate o fim.
- **Notificacoes**: enquanto o worker da aba trabalha, o sino fica azul com um ponto
  pulsando, e a central mostra o nome da nota, a etapa e o progresso. Desligado o
  processamento, o sino volta ao estado normal e a lista de concluidos continua.
- Diagnostico: nenhuma frase solta; os numeros ficam na grade e a explicacao de cada
  aviso aparece no `title` do item.

### 9. Livro (modo escritor)

O seletor compacto da sidebar abre a biblioteca em dois grupos, "Cadernos"
(Todos, o padrao e os demais, com contagem) e "Livros" (ponto de status e mini
progresso quando ha meta). Depois de escolher, ele fecha e a coluna volta ao
conteudo do caderno. Num livro, a lista de capitulos ocupa exatamente o lugar
onde as notas ficariam, na mesma escala da lista de notas: titulo em 14,5 px,
linha de metadados com "Capitulo N" e palavras, sinopse em duas linhas e ponto
de status. Arrastar reordena; "+ Capitulo" fecha a lista. Nao existe tela global
de escrita: tudo vive dentro do caderno-livro.

**Casa do livro.** Duas abas: "Capa" e "Estrutura". O formato padrao de um livro
novo e Romance, 14 x 21 cm (o A4 fica para o manuscrito). A capa e uma ficha grande:
capa solida a esquerda e, a direita, estado, ultima escrita, medida da folha,
titulo, autor, sinopse, uma linha com capitulos, partes, palavras e paginas
estimadas, alem da barra `palavras / meta` quando ha meta. Abaixo, "Ultimos 7
dias" mostra o ritmo diario em barras e "Capitulos" mostra quantos estao em
rascunho, revisao e final, com o total de beats. "Continuar no capitulo N" abre o
primeiro capitulo nao final. A estrutura e uma grade de cartoes com numero,
titulo, status, palavras, sinopse e beats; partes viram cartao largo divisor;
arrastar reordena pela mesma rota da lista; "+ Capitulo" fecha a grade. Acoes:
Ler, Exportar, Configuracoes do livro.

**Workspace.** O topo tem voltar, titulo do livro, estado de gravacao (ponto e
palavra curta), palavras de hoje sobre a meta diaria, contagem do capitulo,
setas de capitulo anterior/proximo, Foco e Painel. Abaixo, uma barra fixa e fina
com Estilo (Corpo, Secao, Citacao), negrito, italico, link e separador de cena.
O corpo e uma folha de verdade na medida do livro (padrao 14 x 21 cm, margem de
19 mm, corpo de 18 px e entrelinha de 1,6), centralizada, com justificado,
hifenizacao e recuo de primeira linha. Cada pagina e uma folha separada, com a
margem do livro e um espaco de fundo entre uma e outra; o numero da pagina fica
na margem da folha seguinte. A divisao e calculada pelas linhas realmente
renderizadas e nao entra no texto: ela existe so como camada de editor. O mesmo
texto, com a mesma fonte e as mesmas margens, vira o PDF, entao as folhas batem
com a impressao. O topo mostra a contagem de paginas do capitulo. O titulo e a
overline ficam dentro da primeira folha.

A barra fixa e a caixa de ferramentas do escritor: desfazer, refazer, estilo do
paragrafo (corpo, secao, subtitulo, citacao), negrito, italico, sublinhado,
riscado, listas com marcadores e numerada, alinhamento, link para nota, imagem,
audio e separador de cena. Selecionar texto abre a mesma barra flutuante das
notas, com o seletor de tipo de bloco, estilos, link, cor e alinhamento. O menu
"/" continua para imagem, audio e link; as alcas de bloco ficam desligadas.
Foco esconde sidebar, gaveta e barra de formatacao; Esc sai.

**Gaveta do capitulo.** Coluna de 340 px que passa por cima da folha, como o
painel da nota: status, meta, sinopse, beats (um por linha, contados no cartao),
anotacoes, referencias externas (link e rotulo, abertas em outra aba), "Aparece
em" com as entidades que a analise ja encontrou nos capitulos e as versoes.
Sem analise, a secao oferece "Analisar capitulo" e nao dispara nada sozinha.

**Fluxo.** Ctrl+Enter cria um capitulo logo depois do atual; Ctrl+PageUp/Down
navegam entre capitulos; Ctrl+S grava na hora. O rascunho offline continua por
capitulo no IndexedDB (250 ms), com flush ao esconder a aba e reproducao ao
voltar a rede. Conflito 409 abre a folha com as duas versoes e diff por palavra;
"Manter o meu" grava sem versao base e "Usar o do servidor" guarda o texto local
por sete dias. A fila nunca resolve conflito sozinha.

**Imagens.** Preto e branco por padrao; o menu da imagem oferece "Cor original",
que grava `c=1` no markdown. A leitura, o PDF e o DOCX respeitam a marca.

**Capa.** Em "Configuracoes do livro", a secao Capa recebe uma foto; o quadro de
encaixe tem a proporcao da folha e a imagem pode ser arrastada e ampliada. O
canvas salva exatamente o que esta no quadro. A capa aparece na casa do livro e
como primeira pagina da leitura e do PDF.

**Leitura e exportacao.** A previa compila capitulos nao vazios na folha do
livro, com capa, pagina de titulo, sumario, divisoria de parte e quebra por
capitulo; o rotulo conta "Capitulo X de Y" (a paginacao real fica no PDF). A
folha da previa tem tamanho fixo na proporcao do livro, o fundo e escuro e a
barra de paginas fica fora da folha, presa; a leitura nao rola a folha junto com
o menu. O PDF usa a
impressao do navegador com a fonte escolhida do livro, medida, margem, corpo e
entrelinha do editor, entao as linhas e as quebras batem com as guias da folha.
A capa entra numa pagina propria sem margem, antes da pagina de titulo.
O DOCX sai com a medida e as margens do livro, usando o nome da fonte escolhida;
o Word cai para a reserva dele quando a fonte nao esta instalada. O Markdown
mantem o corpo e os separadores.

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
