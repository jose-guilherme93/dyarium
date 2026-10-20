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
- **O que o app nao edita, ele mostra.** Tabela, divisoria e mencao a outra nota
  viram bloco opaco no editor do celular: somente leitura, carregando o markdown
  original, que volta intacto ao salvar.
- **Largura da imagem** viaja em `{w=50}` (percentual da largura da nota), que o
  markdown nao tem padrao para isso.

## Abertura de nota e cache

Abrir uma nota e uma operacao de leitura local; a rede so revalida. O que sustenta
isso:

- **Cliente local-first.** O app le titulo, corpo, transcricao e pilha de audios do
  SQLite na hora. O dashboard pinta a ultima copia do IndexedDB (e da memoria) e
  revalida em background com `If-None-Match`. Reabrir a mesma nota nao espera rede.
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
- **Editor de blocos, sem WebView.** A nota e um documento de blocos nativos:
  cada bloco de texto e um editor rico nativo (`EnrichedTextInput`) e cada foto
  e uma `Image` nativa no lugar. Nao existe leitor separado nem troca de view ao
  tocar: o usuario toca no bloco e digita, com a mesma fonte e o mesmo layout o
  tempo todo. A selecao vira negrito/italico/lista pelo comando nativo, sem
  mostrar markdown. O markdown continua sendo o formato salvo: o bloco vira
  markdown num debounce curto e no blur/saida. Fotos entram na hora pelo arquivo
  local e sobem no sync ao sair da nota.

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
- Editor da nota: o markdown e fatiado em blocos (`core/noteBlocks`) preservando as linhas
  exatas para o round-trip. Blocos de texto usam um `EnrichedTextInput` nativo cada, o que
  mantem o custo por tecla limitado ao tamanho do bloco (sem o O(n) da nota inteira que
  derrubava a digitacao no editor unico). Blocos de imagem sao `Image` nativas; tabela,
  divisoria e codigo ficam somente leitura e so saem com confirmacao. O editor nao tem
  `onChangeHtml` nem `getHTML` por tecla: cada bloco marca "sujo" pela selecao e so pede o
  HTML no debounce, no blur ou no `flush`. O estado `body` da tela so e materializado no
  menu/saida, para nao re-renderizar a nota durante a digitacao. A volta por gesto/tecla do
  sistema usa `beforeRemove` para esperar o flush antes de desmontar. O `react-native-enriched-html`
  voltou apenas como motor nativo por bloco; a WebView foi removida do caminho.
- Abertura sem trabalho de fundo: enquanto a nota esta aberta, upload/rede e pulls esperam
  (`noteIsOpen`), a pilha de audios so revalida depois da transicao, o audio nao e
  decodificado ate o play/seek e a busca de anexos nao lista o diretorio inteiro (checa as
  extensoes conhecidas direto). A transcricao local espera 4 s, nunca com o editor aberto, e
  o progresso so notifica quando o percentual inteiro muda.

## Limites e configuracoes relevantes

- Duracao maxima de audio: 50 minutos (configuravel por ambiente).
- O app grava um audio por nota. Nota ja sincronizada (ou com audio local) nao aceita um
  segundo audio pelo celular; a pilha do servidor e somente leitura no app.
- Tamanho maximo de upload: configuravel por ambiente.
- Formatos aceitos: wav, mp3, m4a, ogg, flac, aac, adts (configuravel).
- Concorrencia de workers: padrao 1, dado o pico de memoria do whisper.
- Corte de silencio na transcricao: booleano em `Settings`, desligado por padrao.
