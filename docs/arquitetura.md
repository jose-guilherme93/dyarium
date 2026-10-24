# Arquitetura

## Principios

- Um unico binario Go (`diary`) com subcomandos.
- Nenhum estado em memoria que nao possa ser reconstruido a partir do banco e do diretorio
  de dados.
- Acesso a dados sempre atras de uma interface de repositorio.
- Operacoes pesadas (transcricao, analise, ffmpeg) sempre como subprocessos, isoladas do
  processo principal.
- Falhas de etapa opcional nunca quebram as etapas essenciais.

## Componentes

```
cmd/diary            Entrypoint: subcomandos serve e version.
internal/api         Servidor HTTP, roteamento, auth Bearer, SSE, go:embed do dashboard.
internal/ingest      Upload resumivel, validacao de integridade, criacao de entradas.
internal/jobs        Fila de jobs, leases, heartbeat, retries com backoff, agendador.
internal/transcribe  Orquestracao do whisper-cli: chunking, checkpoints, metricas de audio.
internal/analyze     Cliente de API compativel com OpenAI: sentimento, emocoes, pessoas, lugares, resumo.
internal/store       Repositorio: SQLite (WAL), migrations, interface de dados.
internal/crypto      AES-256-GCM: cifra/decifra em streaming, derivacao de chave.
internal/telegram    Modulo opcional (envio de audio pelo bot). Stub nesta versao.
web                  SPA React + Vite + TypeScript com BlockNote.
deploy               Dockerfile e compose de desenvolvimento.
```

Cada pacote `internal` expoe interfaces pequenas e concretiza as dependencias externas
(SQLite, ffmpeg, HTTP) na borda, para permitir testes com dublês.

## Formato do corpo da nota

O corpo da nota e **markdown** (`notes.content_markdown`), o mesmo texto nos tres
lugares: app, dashboard e servidor. O JSON de blocos do BlockNote foi removido do
contrato: cada editor falava um formato e a traducao entre eles era onde as coisas
se perdiam (linha em branco entre paragrafos, numeracao, aninhamento, imagem com
referencia local).

Consequencias que valem registrar:

- **Ultima edicao vence.** Titulo, data do evento e corpo tem versao propria no
  servidor, mas os clientes oficiais usam last-write-wins para o texto: o app grava
  o corpo sem versao de base e o dashboard reenvia sem versao quando recebe `409`.
  O pull do app sempre aplica a versao do servidor quando ela e mais nova que a
  ultima edicao local; nota com edicao pendente so perde o campo que o servidor
  gravou depois (compara a versao do campo com o horario da edicao local). O
  endpoint continua devolvendo `409` com o campo que brigou para clientes que
  queiram oferecer a escolha, mas o produto nao interrompe mais o usuario com um
  dialogo: a ultima gravacao vale.
- **O que o markdown nao sabe, o editor nao oferece.** Cor de texto, cor de fundo e
  sublinhado sairam do schema do editor: dariam para formatar algo que nao sobrevive
  a gravacao.
- **O que o app nao desenha, ele preserva.** Tabela, divisoria e mencao a outra
  nota entram no editor do celular como texto markdown editavel e voltam iguais
  ao salvar; o editor rico desenha o que tem comando nativo (enfase, listas,
  titulos, citacao, link, codigo e imagem).
- **Largura da imagem** viaja em `{w=50}` (percentual da largura da nota), que o
  markdown nao tem padrao para isso.
- **O corpo e uma lista de nos, nao um texto com anexos.** O documento e
  `[texto, imagem, texto, audio, texto, ...]`; texto e rich text, imagem e audio
  sao nos do documento. O markdown continua canonico, com marcadores explicitos:
  `![alt](local:...){w=50}` para imagem e `!audio[local:...]{d=12.5}` para audio.
  O parser/serializer fica em `mobile/src/core/noteDocument`, e puro e testado no
  nucleo. Inserir no cursor divide o no de texto na posicao exata; por isso a foto
  e o audio entram entre dois trechos, nao no fim. Remover uma midia junta os dois
  trechos de texto vizinhos. Nota antiga que ainda tem o audio da propria entrada
  em `filePath` ganha o no correspondente na primeira abertura; a pilha adicional
  criada no dashboard continua no topo, sem virar marcador no corpo. Liberar
  espaco local so apaga audio quando todos os nos ja tem anexo conhecido e a nota
  nao tem edicao pendente: sem isso, o arquivo local seria a unica copia.

## Abertura de nota e cache

Abrir uma nota e uma operacao de leitura local; a rede so revalida. O que sustenta
isso:

- **Cliente local-first.** O app le titulo, corpo, transcricao e pilha de audios do
  SQLite na hora. O dashboard pinta a ultima copia do IndexedDB (e da memoria) e
  revalida em background com `If-None-Match`. Reabrir a mesma nota nao espera rede.
- **Custo por identidade da nota.** A biblioteca reutiliza o objeto `Recording`
  quando a nota nao mudou e cria outro a cada edicao. Sobre isso ficam caches
  `WeakMap`: texto normalizado de busca e chaves de tag (`core/notebookFilter`),
  titulo de nota sem titulo (`core/title`), corpo com o audio legado ja migrado
  (`core/noteAudio`) e os fatos do Painel (`core/writing`). Digitar na busca,
  filtrar por tag, rolar a lista e reabrir a nota leem o valor ja calculado; a
  edicao invalida so aquela nota. As contagens do menu saem de uma conversao so
  (`core/noteStats`), e a lista de cadernos e resumida numa passada
  (`notebookStats`).
- **Revalidacao sem bloquear.** A resposta revalidada substitui a copia local
  quando chega; um evento SSE invalida apenas a entrada a que se refere, nunca a
  nota aberta por causa de outra nota.
- **Payload enxuto.** `GET /entries/{id}` carrega o texto da transcricao e nao os
  segmentos; a transcricao completa vem paginada por
  `GET /entries/{id}/segments`. JSON tem `ETag` e gzip, e responde `304` quando o
  cliente ja tem a versao.
- **Midia cacheavel e barata.** Anexos sao imutaveis por id
  (`Cache-Control: immutable` + `ETag`), `HEAD` nao decifra e `Range` decifra so o
  trecho pedido, pulando os registros AES-GCM anteriores. Imagens importadas sao
  reduzidas para 2048 px no maior lado (app e dashboard) antes de subir.
- **Editor unico.** O dashboard mantem no maximo o editor da nota atual. Ao
  desmontar, scroll, painel de propriedades, modo markdown, transcricoes
  expandidas e posicao do audio ficam num store em memoria por entrada e sao
  reaplicados na volta.
- **Editor por nos, nativo.** Cada no de texto tem o seu `EnrichedTextInput` e
  cada imagem/audio e um componente nativo no lugar. Negrito, italico, tachado,
  codigo, titulos, listas, citacao e links sao desenhados enquanto o usuario
  digita. A insercao no cursor chama `core/noteDocument`: o no de texto e dividido
  e o no novo entra entre as duas metades. O custo por tecla fica limitado ao no
  ativo, sem trocar de motor de edicao. **O texto da nota e um no so**: um
  editor por paragrafo fazia o campo ser desmontado e remontado a cada troca
  de paragrafo (com o custo e o lag do documento inteiro), e o Enter criava um
  editor novo. As midias que cortam o texto sao os unicos pontos de divisao.
  So uma nota gigante e cortada (8000 caracteres), em fronteira de palavra (ate
  no meio de uma linha, sem quebra nenhuma), e as partes voltam coladas no
  markdown - o texto do usuario nao muda. O texto de um no e o **conteudo** que
  o editor mostra; as quebras que fecham a linha antes de uma midia ficam no
  `breakAfter` do no, fora do conteudo (misturadas com ele, as quebras que o
  usuario digita no fim do texto sumiam). Toda midia deixa um trecho de texto
  (mesmo vazio) do lado direito: e o campo onde se digita abaixo de uma foto
  ou audio, inclusive depois de reabrir a nota. A insercao e a remocao mexem
  **na lista de nos**, sem reparsear o markdown: um id recalculado por um novo
  parse apontava para outro trecho e fazia a foto mudar de lugar (e o texto
  parecer perdido). A imagem e um no proprio: ocupa uma largura em percentual
  da nota, que viaja no markdown (`{w=50}`); um unico botao de informacao no
  canto abre o menu com os tres tamanhos e, por ultimo, remover a foto. Todo
  trecho de texto e o editor rico
  nativo, montado desde a abertura: nao ha estado de leitura, nem previa, nem
  remontagem no toque. Um editor por trecho e barato porque so as midias
  cortam o texto, e o toque, o cursor e o Enter sao os do Android. O
  titulo, a data e as tags aparecem no primeiro frame, e o corpo monta junto:
  nao ha esqueleto no lugar dele nem troca de etapa, e nada de carregamento
  cobre o texto depois que a nota abriu. O markdown continua sendo o
  formato salvo: o HTML vira markdown num debounce curto e no blur/saida. Fotos e
  audios entram na hora pelo arquivo local e sobem no sync ao sair da nota; a
  referencia `local:`/`attachment:` fica no markdown, sem caminho de aparelho.
- **Editor rico sempre montado, sem previa.** Todo trecho de texto e um
  `EnrichedTextInput` desde a abertura, e o texto aparece formatado em todos
  os estados. Nao existe renderizador de leitura: o que dividia a cena em
  "previa" e "campo" era caro (duas geometrias para o mesmo texto, cursor
  calculado por posicao de toque e `setSelection`) e podia mostrar o que o
  usuario nao pediu. O corpo nao monta dezenas de campos porque um trecho de
  texto so termina onde existe uma midia; a nota inteira e um campo quando nao
  ha foto nem audio.
- **Eventos sincronos no Android.** O editor muda de tamanho a cada tecla (o
  texto cresce) e, com o evento assincrono, a atualizacao chega depois do
  quadro: o campo pisca e a digitacao engasga. O `EnrichedTextInput` recebe
  `androidExperimentalSynchronousEvents`, que e a opcao da propria biblioteca
  para esse caso.
- **HTML no formato interno do editor.** `core/noteHtml` entrega ao editor
  rico o formato que ele reconhece como proprio (`<html>...</html>`). Fora desse
  formato, a biblioteca trata o conteudo como HTML externo e roda o
  normalizador (um parse de HTML5 completo, via Gumbo) no editor. No formato
  interno, o parse e o da propria biblioteca, e a ida e volta do markdown
  continua igual (`htmlToMarkdown` tira a casca).
- **O HTML segue o que a biblioteca devolve.** Dentro do formato interno, a
  biblioteca quebra o HTML em uma linha por tag e usa um `<br>` solto na linha
  em branco. O app entrega o mesmo formato (uma quebra entre os blocos e
  `<br>` na linha em branco) e a conversao tira essas quebras: elas sao
  formatacao do HTML, nao texto. Sem isso, cada linha em branco do markdown
  voltava dobrada a cada gravacao e o texto da nota crescia sozinho. Do mesmo
  jeito, a conversao tira **uma** quebra do fim (a da tag que fecha o texto) e
  nao todas: as que sobram sao as que o usuario digitou.
- **Teclado e cursor.** A janela usa `adjustNothing` (plugin
  `withKeyboardLayout`): o app reserva a altura do teclado na barra de acoes e
  **nao rola a nota**. Quem cuida do cursor e o Android; rolar para o "inicio
  do trecho" (medido pelo bloco, nao pelo cursor) fazia a nota pular para o
  topo a cada toque perto do teclado. Fechar a nota tira o foco do editor
  antes de desmontar a view: desmontar um campo com o teclado aberto travava
  a thread de UI na transicao (tela preta/ANR).
- **Teclado nos modais.** Como a janela nao encolhe, todo modal com campo de
  texto precisa reservar o teclado por conta propria. `FastModal` envolve o
  conteudo num `KeyboardAvoidingView` (behavior `padding`), entao o seletor de
  tags, o campo de link e os formularios sobem acima do teclado em vez de
  ficarem atras dele.
- **Folhas do rodape.** Quem sobe do rodape (`BottomSheet`) anima so
  `translateY` e a opacidade do fundo, no driver nativo: nenhuma medida de
  conteudo entra na entrada, entao a altura nao "corta" durante a animacao. O
  seletor de tags tem altura fixa para a lista e para a faixa de selecionadas:
  filtrar, receber o banco do servidor ou marcar a primeira tag nao muda o
  tamanho do cartao no meio da interacao. A folha da nota separa o transform
  (nativo) da altura animada (JS) em dois `Animated.View`, porque misturar os
  dois drivers no mesmo no obriga a entrada a rodar na thread de JS.
- **O texto e editado no editor nativo.** Todo trecho de texto e o proprio
  `EnrichedTextInput` do app, montado desde a abertura: o toque, o cursor, a
  selecao, o Enter e a digitacao sao os do Android. Nao ha previa no meio do
  caminho, nem matematica de cursor, nem "condicoes" para o campo se comportar
  como um campo. O que o usuario ve em todos os estados e o campo de verdade,
  com o mesmo HTML que sera salvo. O editor e a nota nao trocam de aparencia
  depois de abertos: nenhum esqueleto, previa ou indicador entra na frente do
  texto enquanto algo carrega.
- **Uma leitura por trecho, por vez.** O editor nativo responde a um pedido de
  HTML por vez. Duas leituras do mesmo trecho ao mesmo tempo fazem uma delas
  falhar ("Component unmounted") - e o texto que o usuario escreveu nesse
  trecho ia embora. As leituras ficam em fila por trecho.
- **Um editor por trecho de texto, sempre montado.** So as midias cortam o
  texto, entao uma nota sem foto nem audio tem um unico campo nativo, e uma
  nota com tres audios tem quatro. Nao ha janela de visibilidade nem troca de
  campo no toque: como o texto da nota e um no so, o editor nao e remontado
  quando o cursor muda de linha; e o campo do Android que acompanha o cursor.
- **A nota so rola quando o cursor some.** A rolagem para o cursor e feita
  depois que o teclado abre e apenas se o cursor estiver fora da area visivel:
  antes, qualquer toque rolava o paragrafo inteiro para o topo da tela e o
  usuario perdia o texto que estava lendo.
- **Pausa do player fora do desmonte.** `player.pause()` do `expo-audio` e uma
  chamada sincrona que, no Android, termina em `AudioModule.runOnMain` ->
  `runBlocking(main)`. Executada durante o desmonte da nota, ela cai no dispatch
  de eventos do Fabric na thread principal e espera essa mesma thread: o app
  fica "nao responde" por 5 s (ANR reproduzido no emulador, com a pilha
  `EventBeatManager.tick -> AudioModule.runOnMain`). A pausa da saida e adiada
  para o proximo tick do JS (`usePauseOnUnmount`), onde `runOnMain` agenda na
  thread principal ja livre. Vale para qualquer chamada sincrona do
  `expo-audio` em cleanup de tela.
- **Diagnostico de digitacao.** O log de desenvolvimento separa o trabalho do
  app do quadro perdido: `[perf] typing` traz `js_ms` (o que o app fez),
  `frame_ms` (o tempo ate o proximo quadro), `chars` (o tamanho do no editado)
  e `rich` (quantos editores nativos estao montados). E o que distingue "o JS
  travou" de "a view nativa do editor e lenta".
  `[perf] note.rehydrate` marca o corpo remontando (que tira o editor do
  lugar).
- **Patch no editor rico.** `react-native-enriched-html` recalcula o estado de
  estilo do cursor a cada tecla e, no Android, emitia o evento de estado
  **mesmo quando o estado nao tinha mudado**: cada emissao monta um payload
  com todos os estilos, copia esse payload e despacha para o JS - dezenas de
  mapas nativos por tecla, na thread de UI. A comparacao que_exists no
  upstream ("nao emita se o payload for o mesmo") compara os *objetos* de
  mapa, que nunca sao iguais, entao nunca segurava o evento. O iOS da
  biblioteca ja faz o certo (so emite quando algo mudou); o Android nao.
  O mesmo arquivo tinha um segundo defeito: o span de paragrafo vazio
  (`EmptySpan`) era uma **classe local**, entao cada chamada criava uma classe
  nova e os spans anteriores nunca eram removidos - um span de paragrafo a
  mais a cada tecla, e o layout do texto ficava mais lento a cada tecla.
  O patch tambem faz o evento de **selecao** ser assincrono: o editor o
  despachava de forma sincrona (por causa de
  `androidExperimentalSynchronousEvents`), entao cada toque e cada tecla
  faziam a thread de UI esperar o JS - era o quadro perdido ao mover o cursor.
  `mobile/patches/react-native-enriched-html@1.1.1.patch` corrige os tres no
  Android. Como o patch e de codigo nativo, ele exige **rebuild** do
  development build (reload do Metro nao basta).
  Medido no aparelho antes do patch (nota de 11.852 chars, 56 nos): a tecla
  custava de 132 ms a 1.772 ms, crescendo a cada tecla, com `js_ms = 0` (o JS
  estava ocioso: o custo era todo nativo) e o corpo levando ~2 s para assentar.
- **Editor unico, 100% nativo.** O corpo da nota e uma lista de nos
  (`core/noteDocument`): texto rico, imagem e audio. Nao ha WebView no corpo:
  o texto rico vive em `EnrichedTextInput`, um campo nativo por no de texto, e a
  imagem e o audio sao componentes nativos no lugar. Isso elimina o cold start
  da WebView, o recarregamento do documento e o piscar da tela quando o texto
  muda. Todo trecho de texto e o campo rico, montado desde a abertura, com o
  texto formatado em todos os estados (negrito, titulo, lista, codigo, citacao,
  link): nao ha renderizador de leitura nem previa. O markdown continua sendo o
  formato salvo: o HTML vira markdown num debounce curto e no blur/saida, e
  nunca e mostrado. Fotos e audios entram na hora pelo arquivo local e sobem no
  sync ao sair da nota; a referencia `local:`/`attachment:` fica no markdown,
  sem caminho de aparelho.
- **Decisao: corpo nativo, sem WebView.** A alternativa era o texto rico numa
  WebView `contenteditable`, com o audio como card nativo entre os trechos. A
  alternativa foi descartada: ela nao servia ao requisito (texto rico, fotos e
  audios entre os trechos, markdown escondido e abertura rapida) e trazia cold
  start, recarga do documento e tremor na digitacao. O que existia da
  alternativa foi removido do app: `core/noteRuns`, `core/noteWebHtml`,
  `core/webviewBridge` e o seletor de editor em Opcoes nao existem mais.

## Fluxo de dados

1. Cliente inicia um upload: `POST /uploads` com metadados e o SHA-256 esperado do arquivo.
   O servidor reserva um `Upload` e responde com um id e o offset atual (0).
2. O cliente envia os bytes em partes: `PUT /uploads/{id}` com o header de offset. O servidor
   cifra o fluxo em streaming (AES-256-GCM) e grava o ciphertext no diretorio de dados.
   Nenhum byte em claro chega ao disco persistente.
3. O cliente retoma de onde parou: `GET /uploads/{id}` retorna o offset confirmado.
4. O cliente finaliza: `POST /uploads/{id}/complete`. O servidor valida tamanho, formato,
   duracao (via ffprobe, sobre um derivado temporario) e o SHA-256 do conteudo recebido.
   Em caso de sucesso, cria uma `Entry` e enfileira um job `transcribe`. Se o SHA-256 ja
   corresponde a uma `Entry` ativa, o servidor nao duplica: descarta o objeto recem-recebido
   e devolve a entrada existente (o audio e imutavel, entao o hash e a sua identidade).
5. O worker pega o job, decifra para um diretorio temporario com permissao restrita, deriva
   a copia 16 kHz mono (e, opcionalmente, remove silencios), transcreve por trechos com
   checkpoint, grava `Transcript` e `Segment`, calcula metricas de audio e, se a analise
   estiver ligada, enfileira um job `analyze`.
6. O job `analyze` produz `Analysis` (sentimento, emocoes, pessoas, lugares, resumo).
7. A SPA consome a API REST e recebe atualizacoes por SSE.

## Maquina de estados da Entry

```
received -> validating -> stored -> queued -> transcribing -> transcribed
          -> (analyzing -> enriched) -> ready
```

- `received`: metadados registrados, upload em andamento.
- `validating`: `complete` recebido; validando formato, tamanho, duracao e SHA-256.
- `stored`: audio cifrado e integro; pronto para enfileirar.
- `queued`: job `transcribe` na fila.
- `transcribing`: worker processando.
- `transcribed`: transcricao e metricas gravadas.
- `analyzing`: job `analyze` em execucao (apenas se a analise estiver ligada).
- `enriched`: analise gravada.
- `ready`: estado terminal de sucesso (sem analise, transita direto de `transcribed`).

Estados laterais:
- `failed`: etapa essencial falhou apos esgotar as tentativas.
- `deleted`: entrada removida logicamente; dados removidos em job de limpeza.

Transicoes de estado sao persistidas com carimbo de tempo e registradas em eventos, para
auditoria e para o SSE.

## Maquina de estados do Job

```
queued -> leased -> running -> done
                          \-> failed -> (backoff) retrying -> leased ...
                                       \-> dead (apos max_attempts)
```

- `queued`: aguardando um worker.
- `leased`: reservado por um worker, com prazo (lease) e heartbeat.
- `running`: em execucao.
- `done`: concluido com sucesso.
- `failed`: falhou numa tentativa.
- `retrying`: aguardando o intervalo de backoff.
- `dead`: falhas esgotadas; requer intervencao manual.

Campos do job: tipo, payload, tentativas, max_attempts, `available_at` (para backoff),
`lease_expires_at` e o id do worker que detem o lease. Um job com lease expirado volta a
`queued` (recuperacao de worker morto).

Idempotencia: cada job deriva uma chave logica (por exemplo, `transcribe:{entry_id}` e
`analyze:{entry_id}:{model}`). Um job ja concluido para a mesma chave nao e reexecutado, e
a gravacao dos resultados e feita em transacao, com upsert por chave natural.

## Decisoes e justificativas

- SQLite em WAL: um arquivo unico, transacoes ACID, leitura concorrente. Adequado a um
  diario pessoal. O acesso fica atras de uma interface de repositorio para permitir Postgres.
- Migrations com runner proprio e `embed`: atende a preferencia por biblioteca padrao e evita
  dependencia externa; a tabela `schema_migrations` guarda a versao aplicada.
- whisper.cpp como subprocesso: isola memoria e falhas do processo Go; permite trocar de
  modelo por configuracao e medir o pico de RSS do processo filho.
- ffmpeg/ffprobe como subprocesso: ferramenta madura para duracao, loudness e deteccao de
  silencio, sem reimplementar decodificacao de audio.
- Cifra em streaming no PUT: evita qualquer janela de audio em claro no disco persistente.
- Derivados em diretorio temporario: mantem o original imutavel e simplifica a limpeza.
- Dedupe por SHA-256 no `complete`: como o audio nunca muda, o hash e a identidade do
  conteudo. Reimportar o mesmo arquivo (por exemplo, compartilhado duas vezes no app) nao
  cria entrada nem transcricao duplicadas; entradas removidas nao contam para o dedupe.
- Toda `Entry` tem titulo e dia: quando o cliente nao informa, o servidor deriva o titulo do
  nome original do arquivo (ou da data/hora) e usa a hora de criacao como `recorded_at`.
  Isso mantem a linha do tempo e o calendario do dashboard sempre preenchidos, inclusive
  para fontes como o Telegram.
- Chave mestra e token sem configuracao manual: no primeiro boot, se nao vierem do
  ambiente, a chave mestra e gerada e persistida em `/data/master.key` (0600) e a instancia
  entra em modo setup ate o operador definir o token em `/setup` (persistido em
  `/data/token`). Mantem o self-hosting simples sem abrir mao de override por ambiente.
- Analise por HTTP compativel com OpenAI: funciona com Ollama local ou qualquer provedor,
  e pode ser desligada sem afetar transcricao e metricas.
- Frontend embutido via `go:embed`: um unico artefato para distribuir.
- SSE para atualizacoes: unidirecional, simples, funciona atras do proxy de desenvolvimento.
- Caderno obrigatorio por nota, com o padrao "Notas ao acaso" criado por migracao: separa
  trabalho, estudo e outros conjuntos sem permitir nota orfa. O app abre no ultimo caderno
  (preferencia local), o web usa a mesma ideia na sidebar. As notas sao ordenadas pela data
  real (`recorded_at`), nao pela data de importacao.
- Tags como eixo transversal (N:N) e cadernos como colecao (1:N): as duas coisas respondem
  perguntas diferentes. A cor pastel e deterministica a partir do nome, para a tag criada
  offline ja aparecer igual no servidor e no dashboard.
- Subnotas desativadas: a arvore `parent_id` nao e mais criada nem exibida; os dados
  existentes ficam no banco ate uma remocao futura. Cadernos e tags cobrem a organizacao
  que as subnotas tentavam resolver.
- Editor da nota: o corpo e uma lista ordenada de nos (`core/noteDocument`).
  Texto, imagem e audio sao o mesmo tipo de coisa: um no do documento. Cada no de
  texto tem o seu editor rico nativo; a insercao no cursor divide o no na posicao
  visivel exata, fechando e reabrindo enfase/codigo quando necessario. O HTML do
  no vira markdown no debounce (800 ms), no blur e no `flush`; `core/noteHtml`
  preserva enfase, listas, titulos, citacao, link e codigo. O audio guarda a
  referencia (`local:`/`attachment:`), a duracao no marcador e a transcricao no
  cache da pilha; o player e um card entre os paragrafos, nao um campo da nota.
- Abertura sem trabalho de fundo: enquanto a nota esta aberta, upload/rede e pulls esperam
  (`noteIsOpen`), a pilha de audios so revalida depois da transicao, o audio nao e
  decodificado ate o play/seek e a busca de anexos nao lista o diretorio inteiro (checa as
  extensoes conhecidas direto). A transcricao local usa no maximo 2 threads (o app continua
  respondendo), mostra a porcentagem no card do audio e na notificacao (barra de progresso)
  e o progresso so notifica quando o percentual inteiro muda. A analise local usa 2 threads
  (1 no modo de economia) e para quando a nota perde o foco: antes eram 4 threads rodando
  em segundo plano, e entrar/sair de qualquer tela custava dezenas de segundos.

## Limites e configuracoes relevantes

- Duracao maxima de audio: 50 minutos (configuravel por ambiente).
- O app grava um audio por nota. Nota ja sincronizada (ou com audio local) nao aceita um
  segundo audio pelo celular; a pilha do servidor e somente leitura no app.
- Tamanho maximo de upload: configuravel por ambiente.
- Formatos aceitos: wav, mp3, m4a, ogg, flac, aac, adts (configuravel).
- Concorrencia de workers: padrao 1, dado o pico de memoria do whisper.
- Corte de silencio na transcricao: booleano em `Settings`, desligado por padrao.
