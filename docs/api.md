# API HTTP

Convencoes gerais:

- Base: `/api/v1` para os recursos; rotas de sistema em `/healthz` e `/api/v1/version`.
- Autenticacao: header `Authorization: Bearer <token>` em todas as rotas sob `/api/v1`,
  exceto `/healthz`.
- Corpo e respostas em JSON, salvo o conteudo binario do upload.
- Erros: `{ "error": { "code": "...", "message": "..." } }` com o codigo HTTP apropriado.
- Ids sao opacos (ULID/UUID). Timestamps em RFC 3339 (UTC).
- Paginacao por cursor: parametros `limit` e `cursor`; resposta com `next_cursor`.
- Respostas JSON trazem `ETag` e `Vary: Accept-Encoding`, sao comprimidas com gzip
  quando o cliente aceita e respondem `304 Not Modified` a `If-None-Match`. Os
  binarios de midia sao imutaveis por id e usam
  `Cache-Control: private, max-age=31536000, immutable`; `Range` decifra apenas o
  trecho pedido e `HEAD` nao decifra o corpo.

## Sistema

### GET /healthz
Responde 200 com `{ "status": "ok", "version": "<versao>" }`. Sem autenticacao.

### GET /api/v1/version
Retorna `{ "version": "<versao>", "commit": "<hash>", "built_at": "<RFC3339>" }`.

## Upload resumivel

### POST /api/v1/uploads
Cria um upload. Corpo:
```json
{
  "filename": "gravacao.aac",
  "content_type": "audio/aac",
  "size_bytes": 12345678,
  "sha256": "<hex de 64 caracteres do arquivo completo, opcional>",
  "title": "10/10/2026 18:05",
  "recorded_at": "2026-10-10T21:05:00Z",
  "created_at": "2023-10-19T13:30:00Z",
  "source": "share",
  "client_key": "ck_...",
  "entry_id": "en_...",
  "local_transcribe": false,
  "author": "self"
}
```
Resposta 201:
```json
{
  "id": "up_...",
  "offset": 0,
  "expires_at": "2026-01-01T00:00:00Z"
}
```
- `sha256` e opcional. Quando informado, o servidor recomputa no complete e recusa com
  422 se divergir. Quando ausente, o servidor apenas grava o hash recomputado.
- `title` e `recorded_at` sao metadados opcionais do cliente, aplicados a `Entry` criada
  no complete (`recorded_at` em RFC 3339).
- `created_at` e a hora de criacao/importacao **original** da nota, em RFC 3339. O servidor
  grava esse valor em `Entry.created_at` no complete, em vez da hora do upload. Depois de
  criada, a entrada nunca muda esse campo (nem `PATCH`, nem um novo audio na pilha).
  Ausente significa "usar a hora do complete"; invalido responde 400 `invalid_created_at`.
- `source` registra a origem da nota. `share` identifica audio importado de outro app; o
  app usa isso para mostrar "Importada em" e manter a origem depois de um pull em outro
  aparelho. Ausente equivale a `upload`; outros valores respondem 400 `invalid_source`.
- `client_key` torna a criacao idempotente: repetir o POST com a mesma chave devolve o
  upload existente (mesmo `id` e `offset`), evitando entradas duplicadas quando a resposta
  se perde. E o que o app movel usa, uma chave por gravacao.
- `entry_id` e opcional: quando informado, o audio concluido entra nessa entrada. Se a
  entrada **ainda nao existir**, ela e criada no complete com esse mesmo id — e assim
  que o app cria uma nota offline com o id dele e o id vale igual nos dois ambientes,
  sem nenhuma requisicao extra. Se ja existir, o audio entra na pilha dela (uma nota
  pode ter varios audios, um embaixo do outro, cada um com sua transcricao).
  400 se o `entry_id` nao for um id valido.
- `duration_seconds` e aceito no corpo mas ignorado; o servidor mede a duracao com ffprobe
  no complete.
- `local_transcribe` (bool, opcional): quando `true`, o cliente se responsabiliza pela
  transcricao (transcreve no aparelho ou deixa a etapa desligada) e o servidor **nao**
  enfileira a transcricao no complete; o texto chega depois via
  `PUT /api/v1/entries/{id}/transcript`. Quem transcreve primeiro informa o outro.
- `local_analysis` (bool, opcional): quando `true`, o cliente se responsabiliza pela
  analise (roda no aparelho ou esta desligada) e o servidor **nao** enfileira `analyze`
  depois de transcrever. Serve para "transcrever no servidor, analisar no aparelho" e
  para "nao analisar". Sem a marca, o servidor segue a configuracao de analise da
  instancia.
- `author` (opcional): papel do autor da nota criada por este upload (`self`, `other` ou
  `mixed`). Vazio ou ausente segue o padrao da instancia (`all_notes_mine`). Valor
  desconhecido responde 400 `invalid_author`. O autor nao altera o audio; so a leitura da
  primeira pessoa pela IA.
- `offset` na resposta e o offset ja confirmado (0 em uploads novos).

### PUT /api/v1/uploads/{id}
Envia um pedaco do arquivo. Header obrigatorio: `Content-Range` ou `X-Upload-Offset` com o
offset em bytes onde este pedaco comeca. O corpo e o trecho binario (entre 1 byte e o
tamanho do pedaco). O servidor valida que o offset confere com o esperado, cifra em
streaming e grava. Resposta:
```json
{ "id": "up_...", "offset": 4194304, "received_bytes": 4194304 }
```
- 200: pedaco aceito; `offset` e o novo offset confirmado (proximo a enviar).
- 409: offset divergente; `offset` indica de onde retomar.
- 413: pedaco ou upload excede o tamanho maximo.

### GET /api/v1/uploads/{id}
Retoma um upload interrompido:
```json
{ "id": "up_...", "offset": 4194304, "size_bytes": 12345678, "expires_at": "..." }
```

### POST /api/v1/uploads/{id}/complete
Finaliza. O servidor verifica tamanho, formato e duracao (ffprobe sobre um derivado
temporario), recomputa o SHA-256 do conteudo recebido (decifrando em streaming) e compara
com o informado. Em caso de sucesso, cria a `Entry` (ou adiciona o audio a `entry_id`,
quando informado no inicio) e enfileira `transcribe` para o audio.
Resposta 201:
```json
{ "entry_id": "en_...", "attachment_id": "at_...", "status": "queued" }
```
- `attachment_id` identifica o audio criado (o anexo `original` da entrada).
- Idempotente: repetir o complete depois de perder a resposta devolve o mesmo
  `entry_id`/`attachment_id` (201), sem criar outro audio nem reenfileirar a transcricao.
- O mesmo conteudo de audio nunca vira dois audios da mesma nota: se o `sha256` ja existe
  (novo upload da mesma gravacao), devolve o audio existente em vez de duplicar.
- 422: integridade divergente (SHA-256), formato nao aceito ou duracao acima do limite.
- 404: upload inexistente ou expirado.

## Entries

### GET /api/v1/entries
Lista entradas. Filtros: `person`, `place` e `theme` (entradas que mencionam a entidade,
por nome, case-insensitive) e `notebook_id` (notas de um caderno). Retorna resumos com id,
titulo, status, duracao, data, `notebook_id` e, quando houver, `tags` (nomes).
Com `deleted=1` lista a **lixeira**: as entradas apagadas (remocao logica) com
`deleted_at`, da mais recente para a mais antiga.
- `notebook_id` desconhecido responde 404 `notebook_not_found`.
- O app reconcilia exclusoes por esta lista, e nao por ausencia: uma entrada que
  simplesmente sumiu (servidor novo, banco restaurado) nunca apaga a nota local.
- Entradas apagadas aparecem em `entries` com `status: "deleted"` e o campo
  `deleted_at` preenchido.
- `archived=0` (padrao explicito do app e do dashboard) traz so as notas da lista
  de trabalho; `archived=1` traz so as arquivadas; **sem o filtro traz as duas**,
  para nenhum cliente perder nota por omissao.
- Paginacao: `limit` (padrao 100, teto 5000) e `cursor` (o `next_cursor` da pagina
  anterior). A resposta traz `next_cursor` enquanto houver outra pagina; o app
  percorre todas para reconciliar a biblioteca inteira, sem parar no teto.
- Cada entrada traz `author` (papel explicito da nota: `self`, `other`, `mixed` ou vazio),
  `archived` e `versions` com a versao atual de `title`, `recorded_at` e `body`. E o que o cliente guarda para mandar de volta na gravacao: assim o
  servidor consegue recusar (409) o que ja foi editado em outro lugar, e o app
  pergunta ao usuario em vez de sobrescrever. As versoes sao devolvidas
  **exatamente** como estao gravadas: reformatar aqui faria a gravacao seguinte
  do proprio cliente parecer conflito consigo mesma.
- `primary_attachment_id` (quando a nota tem audio) aponta o primeiro audio
  original. A lista nao carrega a pilha inteira; e por este id que o app resolve o
  player de uma nota puxada do servidor.
- `analysis_at` e quando a analise mais nova foi gravada no servidor (vazio quando
  nao ha analise). E o sinal de atualizacao do app: quando o valor muda, ele busca
  a analise uma vez e guarda no banco; a ficha mostra sempre a copia local, sem
  pedir de novo a cada abertura.
- `transcript_at` faz o mesmo para a transcricao: quando muda (transcricao nova ou
  revisao feita no dashboard), o app busca uma vez e guarda. Sem o sinal, uma
  revisao feita depois do primeiro pull nunca chegava ao aparelho.
- `preview` (quando ha corpo ou transcricao) traz ate 160 caracteres em prosa: o
  markdown vira texto, imagens, marcadores de audio e escapes somem e a frase nao
  e cortada no meio de uma palavra. E so para desenhar a lista; o corpo continua
  em `notes`.

## Markdown como formato da nota

O corpo da nota (`notes`) e **markdown**, o mesmo texto que o app e o dashboard
falam. Cada campo editavel tem **versao propria** (`title`, `recorded_at`,
`body`): o cliente manda a versao que leu e o servidor so grava se ela ainda for a
atual. Se nao for, responde `409` **sem escrever** e diz qual campo brigou — o
cliente pergunta ao usuario em vez de sobrescrever em silencio.

- Versoes sao RFC 3339 (UTC, com nanossegundos) devolvidas em `versions`.
- Cliente que **nao manda versao** (app antigo) continua funcionando: ultimo a
  escrever vence.
- Os clientes oficiais usam essa politica: o app grava o corpo **sem
  `base_version`** (ultima gravacao vence, porque e uma pessoa so editando; se ela
  editou no dashboard depois, foi ela quem mudou por ultimo) e o dashboard reenvia
  sem versao quando recebe `409`. O pull do app aplica a versao do servidor quando
  ela e mais nova que a ultima edicao local; o `409` fica disponivel para clientes
  que queiram oferecer a escolha ao usuario.
- Como a ultima gravacao vence, o texto substituido **nunca se perde**: cada
  escrita grava o corpo anterior em `GET /api/v1/notes/{id}/revisions`, entao a
  comparacao (diff) e a recuperacao continuam possiveis depois.
- O titulo vive na **entrada**, nao na nota. A nota nao tem mais `title` no
  caminho de escrita: era a origem de "renomear no desktop e o titulo voltar".
- O app representa imagem e audio como nos do documento, com marcadores no
  markdown: `![alt](attachment:<id>){w=50}` (largura em percentual) e
  `!audio[attachment:<id>]{d=12.5}` (duracao em segundos). O servidor trata o
  corpo como texto opaco; clientes que nao conhecem o marcador o preservam.

### POST /api/v1/entries/{id}/notes
Cria a nota da entrada. Corpo:
```json
{ "id": "note_...", "content_markdown": "## Titulo\n\nTexto." }
```
Resposta 201 com a nota, `content_markdown` e `body_version`. `document` (JSON do
BlockNote) nao e mais aceito nem devolvido. `id` e opcional e idempotente: o app
manda o id local, e um reenvio depois de uma resposta perdida devolve a mesma
nota em vez de criar uma segunda. Sem `base_version` o corpo e gravado como
ultima-gravacao-vence, com o texto anterior guardado em revisoes.

### PUT /api/v1/notes/{id}
Grava o corpo. Corpo:
```json
{ "content_markdown": "...", "base_version": "<body_version lido>" }
```
Resposta 200: `{ "status": "ok", "versions": { "body": "<nova versao>" } }`.
- 409 com `{ "conflict": ["body"], "versions": {...} }` quando o corpo mudou
  depois da leitura: **nada e gravado**.
- Gravar o mesmo texto nao cria revisao nova (o historico so muda quando muda).
- `content_markdown` e obrigatorio, mas pode vir **vazio** (limpar o corpo e uma
  gravacao como outra qualquer): sem o campo a resposta e `400
  missing_markdown`. Nao ha mais caminho de escrita em JSON — era ele que deixava o
  app sobrescrever o markdown sem querer.

### PATCH /api/v1/entries/{id}
Atualiza campos editaveis com versao por campo.
```json
{
  "title": "...",
  "recorded_at": "...",
  "notebook_id": "nb_...",
  "archived": true,
  "author": "mixed",
  "versions": { "title": "...", "recorded_at": "..." }
}
```
Resposta 200: `{ "status": "ok", "versions": { "title": "...", "recorded_at": "..." } }`.
- `notebook_id` move a nota de caderno. E um ponteiro, nao texto: nao tem versao
  nem conflito, e a ultima gravacao vence. Caderno inexistente responde 422
  `invalid_notebook`; vazio tambem (todo caderno e obrigatorio).
- 409 com `{ "conflict": ["title"], "versions": {...} }` se aquele campo mudou
  depois da leitura; **os campos sem conflito nao sao gravados** — o cliente
  reenvia so o que o usuario escolher. O app faz esse reenvio sozinho: manda data,
  arquivamento e caderno de novo sem o campo em conflito, para nao ficarem presos.
- Gravar o **mesmo valor** de titulo ou data nao muda a versao nem `updated_at`: e
  o que impede o sync periodico do app de gerar 409 sem ter havido edicao.
- Mudar so o `status` de processamento (transcrevendo, transcrito, falhou) nao
  altera `updated_at`: concluir transcricao ou analise nao move a nota na lista
  de recentes.
- `archived` tira a nota da lista de trabalho sem apagar: ela continua existindo
  (e no aparelho), so sai da lista do dia. E um interruptor, entao nao tem versao
  nem conflito.
- `author` troca o papel do autor (`self`, `other`, `mixed` ou vazio para voltar ao
  padrao da instancia). Como `archived`, e a ultima gravacao que vence, sem versao.
  Valor desconhecido responde 400 `invalid_author`.
- 400 quando o corpo nao traz nenhum campo.
- Nao altera o audio.

### POST /api/v1/entries
Cria uma nota escrita (sem audio). Corpo:
```json
{ "title": "...", "id": "note_...", "created_at": "...", "recorded_at": "...",
  "notebook_id": "...", "author": "other" }
```
A entrada nasce com `source: "text"` e `status: "ready"`; o corpo **nao** vai
aqui: ele e gravado como nota em markdown por `POST /api/v1/entries/{id}/notes`,
igual a parte escrita de uma nota de audio. `recorded_at` (RFC 3339) e a data do
evento; sem ele vale `created_at`. `id` e opcional e idempotente, e `created_at`
preserva a hora original de criacao/importacao. Analises usam a transcricao quando
existe e, caso contrario, o texto escrito da nota. `notebook_id` e opcional; sem ele a nota
nasce em "Notas ao acaso".
- `id` e opcional (o cliente pode informar o id da nota criada offline) e o caminho e
  idempotente: se a id ja existir **viva**, devolve 200 com a entrada existente; se existir
  **na lixeira**, desfaz a remocao e devolve 200 (trazer a nota de volta sem duplicar); senao cria
  com 201.
- `created_at` (RFC 3339) posiciona a nota na linha do tempo quando ela nasceu offline.

### GET /api/v1/entries/{id}
Retorna a entrada completa: metadados, `audios`, `tags` e `metrics`. O `audios` e
uma lista; uma nota pode ter varios. Cada item traz `id`, `content_type`,
`size_bytes`, `duration_seconds`, `created_at` e, quando transcrito, `transcript`.

O `transcript` aqui e **resumido**: `model`, `language`, `text`, `trim_silence` e
`duration_seconds`, **sem `segments`**. Quando a entrada tem um unico audio e a transcricao
ficou sem `attachment_id` (salva antes de o audio existir, ou por uma versao antiga do app),
o payload mostra essa transcricao no audio — o mesmo texto de `GET /entries/{id}/transcript`.
No boot, o servidor liga a transcricao solta ao unico audio da entrada. Os segmentos sao grandes e so fazem falta
quando o usuario expande a transcricao; use `GET /entries/{id}/segments` para
busca-los em paginas. `GET /entries/{id}/transcript` continua devolvendo a
transcricao inteira com `segments`.

### DELETE /api/v1/entries/{id}
Remocao logica da entrada. A entrada fica na lixeira por uma janela de retencao
(7 dias por padrao, `DIARY_DELETED_RETENTION_HOURS`) e so depois o job de limpeza
remove os objetos cifrados e a linha. E o que permite desfazer a remocao sem
perder a midia.

### POST /api/v1/entries/{id}/restore
Desfaz a remocao logica: a entrada volta a aparecer nas listagens e em
`GET /api/v1/entries/{id}`, com audio, transcricao, notas e anexos intactos.
Resposta 200 com a entrada. Idempotente (restaurar uma entrada ja viva tambem
responde 200).
- 404: a entrada nao existe no servidor (ainda nao subiu, ou a limpeza ja a
  removeu de vez). Nesse caso o cliente recria a entrada com o mesmo id via
  `POST /api/v1/entries`.
- Uso no app: ao restaurar um backup local, antes de qualquer sincronizacao — senao
  o proximo pull veria a nota na lixeira e a apagaria de novo.

### POST /api/v1/entries/{id}/retranscribe
Enfileira um novo job de transcricao (por exemplo, apos mudar o modelo ou o corte de
silencio). O audio original permanece intacto.

## Transcricao

### GET /api/v1/entries/{id}/transcript
Retorna a transcricao atual, com `segments` e metadados do modelo.

- `text` e o que o usuario le: a revisao da IA quando existe, o texto cru do whisper
  quando nao. O original nunca e sobrescrito; `raw_text` o expoe para o app comparar antes
  de um sync e nao apagar uma revisao que so existe no servidor.
- Cada segmento traz `idx`, `start_ms`, `end_ms`, `text` (original do whisper), `edited`
  (escrito a mao) e, **so quando difere do original**, `revised` (a revisao daquele trecho).
- A transcricao traz ainda `revised` (booleano), `revised_model`, `revised_prompt_version`,
  `revised_literal` e `revised_comprehension` (0-100, `-1` quando nao medida), que o app usa
  para reaproveitar a revisao do servidor em vez de refazer no aparelho.
- `revised_through` e o indice do primeiro trecho que a passada ainda nao alcancou;
  `revised_finished` diz se ela chegou ao fim. Uma passada terminada com recusas tem
  `revised_finished: true` e `revised_rejected > 0`; so uma passada interrompida tem
  `revised_finished: false`.
- Cada segmento traz `reviewed`: a passada chegou naquele trecho, mesmo quando o texto
  ficou igual. E o que permite separar trecho recusado de trecho ainda nao alcancado.
- Grafias antigas de entidades mescladas sao resolvidas na leitura: `text`, `segments[].text`
  e `segments[].revised` mostram o nome atual da entidade sobrevivente. O texto gravado e o
  audio continuam exatamente como foram transcritos; a troca e so na resposta.
- O mesmo vale para `GET /entries/{id}/segments` (as paginas do painel) e para a previa da
  lista quando ela vem da transcricao.

### PUT /api/v1/entries/{id}/transcript
Guarda a transcricao feita no aparelho (transcricao local). O servidor passa a usa-la em
vez de transcrever, e o dashboard mostra o texto. Corpo:
```json
{
  "attachment_id": "at_...",
  "language": "pt",
  "text": "texto completo",
  "segments": [{ "start_ms": 0, "end_ms": 1000, "text": "trecho" }]
}
```
- `attachment_id` e opcional, mas o app **precisa** mandar: e ele que liga a transcricao
  ao audio certo quando a nota tem varios. Sem ele, a transcricao fica solta e some da
  lista de audios do dashboard.
- A transcricao e gravada com `model` = `local`; uma transcricao anterior daquele audio e
  substituida. Emite `transcript.ready` e marca a entrada como `transcribed`. Se o job de
  transcricao do servidor falhar depois disso (por exemplo, sem `ffmpeg`), o texto salvo
  prevalece e a entrada **nao** volta para `failed`; no boot, o servidor repara entradas
  que ficaram `failed` com transcricao local, sem tocar em falhas de analise.
- `text` deve ser o **cru do whisper** (a juncao dos segmentos), nunca o revisado: a revisao
  sobe pelo endpoint abaixo e o original fica intacto. Cada segmento aceita `edited: true`
  para marcar um trecho escrito a mao; a revisao nunca toca nele e o sync seguinte preserva a
  marca. Reenviar uma transcricao nao apaga as revisoes dos trechos cujo texto nao mudou;
  quando o texto inteiro e o mesmo, a compreensao, os recusados e o alcance da passada
  tambem sobrevivem.

### PUT /api/v1/entries/{id}/transcript/revisions
Guarda a revisao da transcricao feita no aparelho (ou por outro cliente). Corpo:
```json
{
  "attachment_id": "at_...",
  "model": "qwen3-1.7b",
  "prompt_version": 1,
  "literal": false,
  "comprehension": 78,
  "rejected": 2,
  "reviewed_through": 34,
  "segments": [{ "idx": 0, "text": "A sede do PT (Partido dos Trabalhadores)." }]
}
```
- `idx` e o indice do segmento na transcricao; indices desconhecidos e trechos
  `edited` sao ignorados.
- `reviewed_through` (opcional) e o indice do primeiro trecho que a passada ainda nao
  alcancou: o app envia a revisao janela a janela e o servidor grava so ate ali. Ausente
  significa "a transcricao inteira".
- `rejected` (opcional) conta os trechos que ficaram sem revisao porque a resposta do modelo
  nao serviu. Sem ele, "revisou e nao mudou nada" e "nao conseguiu revisar" ficavam iguais.
- O servidor aplica as mesmas travas da revisao propria (`internal/review`): numero novo ou
  trocado, tamanho fora da faixa ou mais de uma explicacao entre parenteses descartam aquele
  trecho e somam em `rejected`. A resposta traz `revised_segments` (trechos alterados) e
  `rejected` (recusados: do cliente mais as travas do servidor).
- O payload da transcricao expoe `revised_changed` (trechos alterados),
  `revised_rejected` (trechos alcancados que ficaram sem revisao), `revised_through`,
  `revised_finished` e `revised_pending` (trechos nao editados que a passada ainda nao
  alcancou). `revised_pending` nao conta recusados: eles foram alcancados.
- 404 quando a transcricao ainda nao existe; 400 para corpo invalido.
- Uma nova transcricao (retranscrever, `POST /entries/{id}/retranscribe`) descarta as revisoes
  dos trechos cujo texto mudou; as dos trechos identicos continuam valendo.

### GET /api/v1/entries/{id}/segments
Lista os segmentos com paginacao, para leitura incremental. Parametros:
`attachment_id` (opcional; sem ele usa a transcricao mais recente da entrada),
`limit` (padrao 200, teto 1000) e `cursor` (o `next_cursor` da pagina anterior).
Resposta: `{ "segments": [{ "idx", "start_ms", "end_ms", "text", "edited", "revised" }],
"next_cursor": "..." }`. `next_cursor` so aparece quando existe outra pagina. `text` e o
original do whisper; `revised` so aparece quando a IA mudou o trecho.

## Midia

### GET /api/v1/entries/{id}/audio
Transmite o audio original decifrado (para o player do dashboard), com suporte a
`Range`. O plaintext nunca e gravado em disco. O `Content-Type` e o formato do arquivo
enviado. Em notas com varios audios, este endpoint devolve um deles; use
`GET /api/v1/attachments/{id}` para um audio especifico.

### GET /api/v1/entries/{id}/attachments
Lista os anexos de midia (imagens) da entrada.

### POST /api/v1/entries/{id}/attachments
Envia uma imagem. O corpo e os bytes da imagem e o `Content-Type` deve comecar com
`image/`. Resposta 201 com `{ id, entry_id, kind, content_type, size_bytes, created_at }`.

### GET /api/v1/attachments/{id}
Transmite o anexo decifrado (imagens e audios), com suporte a `Range` para o audio.
Resposta 200 (ou 206 em requisicoes parciais). O id e imutavel, entao a resposta
pode ser cacheada por muito tempo; `HEAD` responde apenas os metadados e `Range`
nao decifra o arquivo inteiro.

### DELETE /api/v1/attachments/{id}
Remove o anexo e o objeto cifrado. Resposta 204. Quando o anexo e um audio, a
transcricao e os segmentos caem junto (FK em cascata), a analise da nota e apagada
(ela leu um texto que deixou de existir) e a duracao da nota passa a somar apenas
os audios que sobraram. E o que o menu do player chama em "Apagar
audio"; remover o marcador do corpo (no app) so tira o audio da nota, sem apagar o
anexo.

## Processos concluidos

### GET /api/v1/activities
Lista as transcricoes e analises que terminaram, da mais recente para a mais antiga.
E o que o sino do dashboard mostra; clicar em um item abre a nota. Query `limit`
opcional (padrao 30, maximo 100). Falhas e notas apagadas ficam de fora.
O dashboard usa a mesma lista no titulo da aba: o numero entre parenteses e o total de
processos concluidos ainda nao lidos, e some quando a lista e aberta.

```json
{
  "activities": [
    {
      "id": "run_01J8Z...",
      "entry_id": "en_01J8Z000000000000000000A",
      "kind": "analysis",
      "title": "Nota de exemplo",
      "finished_at": "2026-10-27T17:48:09Z"
    },
    {
      "id": "tr_01J8Z...",
      "entry_id": "en_01J8Z000000000000000000A",
      "kind": "transcription",
      "title": "Nota de exemplo",
      "finished_at": "2026-10-27T17:33:24Z"
    }
  ]
}
```

`kind` e `transcription` ou `analysis`. A lista vem do estado persistido no servidor
(transcricoes gravadas e execucoes de analise com `outcome: "ok"`), entao um processo
que terminou com o dashboard fechado aparece ao abrir de novo.

## Analise

### GET /api/v1/entries/{id}/analysis
Retorna a analise da entrada. Mantem os campos legados (`sentiment` numerico, `emotions`
como mapa, `people`/`places` como lista de nomes, `summary`) e acrescenta `sentiment_label`
e os campos ricos lidos de `data`:

```json
{
  "origin": "server",
  "device_id": "",
  "device_name": "",
  "model": "qwen3.8-flash",
  "sentiment": 0.5,
  "sentiment_label": "positivo",
  "emotions": { "alegria": 0.8 },
  "people": ["Maria"],
  "places": ["Recife"],
  "summary": "Falou da familia e da saudade de Recife.",
  "reading": "A nota liga a mudanca de cidade a uma perda que ainda nao foi nomeada...",
  "sections": [
    {
      "heading": "Primeiro dia",
      "kind": "text",
      "reading": "O primeiro dia aparece como reconhecimento e estranhamento ao mesmo tempo.",
      "summary": "Chegada a Recife.",
      "sentiment": { "score": 0.2, "label": "neutro" },
      "themes": [{ "name": "viagem", "confidence": 0.7 }]
    }
  ],
  "emotions_detail": [{ "name": "alegria", "intensity": 0.8 }],
  "people_detail": [{ "name": "Maria", "count": 3, "relation": "irma", "sentiment": 0.5 }],
  "places_detail": [{ "name": "Recife", "count": 2 }],
  "themes": [{ "name": "familia", "confidence": 0.9 }],
  "key_moments": [{ "start_ms": 123000, "text": "..." }],
  "questions": ["..."],
  "decisions": ["..."],
  "tasks": ["..."],
  "ideas": ["..."],
  "events": ["..."],
  "epiphanies": ["..."],
  "schema_version": 2,
  "sentence_source": "model",
  "coverage": {
    "blocks_read": 34,
    "blocks_total": 34,
    "chars_read": 14500,
    "chars_total": 14500,
    "audio_ms": 1320000,
    "partial": false
  },
  "comprehension": 78,
  "comprehension_source": "review",
  "stutter_rate": 1.2,
  "hesitation_rate": 3.4,
  "revised_segments": 12,
  "data": { "sentiment": { "score": 0.5, "label": "positivo" }, "...": "..." }
}
```
- `comprehension` (0-100) e a estimativa de quanto a transcricao representa a fala com
  logica, sintaxe e concordancia. `-1` quando nao foi medida. `comprehension_source` diz de
  onde veio: `review` (a passada de revisao leu o texto cru) ou `analysis` (estimativa do
  proprio modelo de analise, quando a revisao esta desligada).
- `stutter_rate` e `hesitation_rate` sao as series de gagueira e hesitacao por 100 palavras
  do texto cru; `revised_segments` conta quantos trechos a revisao mudou.
- `summary` e `reading` sao texto curto, nao relatorio: o resumo e uma frase e a leitura no
  maximo duas (280 caracteres, uma linha), cortados pelo servidor mesmo que o modelo
  devolva mais. As metricas — sentimento, emocoes, pessoas, lugares, temas, momentos-chave,
  eventos, decisoes, tarefas, ideias e epifanias — sao o que a analise entrega; `sections`
  traz a leitura de cada parte (titulos do texto escrito e a transcricao), cada uma com o
  mesmo limite.
- `tasks`, `ideas`, `events` e `epiphanies` completam o contrato: tarefa e
  obrigacao/pendencia, ideia e proposta, decisao e escolha feita, epifania e a percepcao ou
  conclusao que muda o entendimento do autor ("percebi que nunca falei o que sentia");
  evento e acontecimento objetivo ("enterro da Ana", "viagem para Minas"). Cada item
  pertence a uma lista so.
- `schema_version` diz qual contrato produziu o documento. A versao 2 e a analise por
  bloco: a nota e dividida em paragrafos (texto) e em frases entre pausas (fala), cada
  bloco devolve o mesmo conjunto de campos e o documento e composto no cliente. A analise
  antiga, sem o campo, continua valida e e exibida como esta.
- `coverage` mostra quanto da nota foi lido. `partial: true` (ou `blocks_read` menor que
  `blocks_total`) significa analise parcial: o app oferece continuar de onde parou. O
  documento de uma analise parcial e o mesmo de uma completa; o que muda e a cobertura.
- `sentence_source` diz se a frase unica veio do modelo (`model`) ou foi derivada dos
  campos pelo codigo (`derived`), quando o modelo nao devolveu uma frase aceitavel.
- Entradas analisadas antes da analise rica nao tem `data`; nesse caso apenas os campos
  legados sao retornados.
- `origin` diz quem produziu a analise: `app` (feita no aparelho e enviada), `server`
  (pipeline deste servidor, inclusive Ollama local ou llama.cpp embutido) ou `api` (provedor
  hospedado, para onde o texto saiu).

Nomes de pessoas, lugares, temas e decisoes na resposta da analise sao resolvidos pela
tabela de entidades (e pelos aliases de nomes antigos): renomear uma pessoa muda a
exibicao em todas as notas, sem reescrever o audio nem a transcricao.

### PUT /api/v1/entries/{id}/analysis
Guarda a analise feita no aparelho, no mesmo formato do GET (o app envia exatamente o que
ja guardou). Campos aceitos: `model`, `sentiment`, `sentiment_label`, `emotions`, `people`,
`places`, `summary`, `reading`, `themes`, `key_moments`, `questions`, `decisions`, `tasks`,
`ideas`, `events`, `epiphanies`, `coverage`, `schema_version`, `sentence_source`, `sections`,
`comprehension`, `comprehension_source`, `stutter_rate`, `hesitation_rate`,
`revised_segments` e `replace`.

- O app envia a analise quando ela esta completa. Parcial fica no aparelho ate o usuario
  tocar em **Continuar**: como o servidor grava a primeira analise que chega, subir uma
  parcial congelaria a nota naquela cobertura.
- `coverage` e opcional; analise de versao anterior nao tem e o servidor nao inventa.
- `people_detail` e `places_detail` levam a contagem de mencoes medida no aparelho; quando
  presentes vencem as listas de nomes (`people`/`places`), que os clientes antigos ainda
  mandam. Sem eles a contagem e 1, como antes.

- Sem `replace`, a analise so e gravada se a entrada ainda nao tiver uma: o sync nunca
  sobrescreve o trabalho do outro lado. Resposta `200` com `{ "stored": false,
  "origin": "server" }` quando ja existia.
- `replace: true` e o **refazer** explicito do usuario: grava por cima.
- A origem gravada e `app` (analise feita em um cliente), salvo `origin: "browser"`, que o
  worker opcional do dashboard envia para registrar que a nota foi processada no PC do
  usuario.
- Com `origin: "browser"`, `device_id` e `device_name` identificam o aparelho que processou
  (id anonimo da instalacao do navegador e um rotulo curto, como
  `Edge 156 · Windows · Intel HD Graphics 620`). Ficam no GET; nas outras origens sao
  ignorados e voltam vazios. 404 quando a entrada nao existe (nota ainda nao subiu).

### POST /api/v1/entries/{id}/analyze
Antes de enfileirar, o servidor faz um **ping** ao provedor de IA com a configuracao salva
(chave, endpoint e modelo) e so entao cria o job `analyze`. Se o provedor nao responder, a
resposta e `502` com `{ "error": { "code": "ai_unavailable", "message": "..." } }` e a nota
**nao** muda de estado nem entra na fila: o clique nunca vira uma promessa quebrada.
Retorna 409 se a analise estiver desligada na configuracao.

Com um pedido local em andamento (worker `prefer_client: true`, ver abaixo), o ping e o 409
por analise desligada nao se aplicam: quem vai responder e o PC do usuario, e o job entra
na fila para ele. O dashboard liga essa preferencia antes de chamar esta rota.

O ping e uma completion minima, sem formato de resposta (pedir `json_object` sem a palavra
"json" no prompt faz o provedor recusar com 400). Uma resposta vazia ainda conta como
provedor saudavel: modelos de raciocinio podem gastar o teto de tokens pensando.
O worker analisa cada secao da nota (titulos do texto escrito + transcricao), mescla as
metricas e sintetiza a nota. Pessoas, lugares e temas viram entidades consultaveis. Com a revisao ligada (`review_enabled`), a analise le o texto revisado; a
passada de revisao roda antes e publica o progresso com `stage: "reviewing"`. Reexecutar a
analise nao revisa de novo quando a revisao guardada ja corresponde ao modelo, a versao do
prompt e ao modo literal.

Modelos de raciocinio gastam parte do teto de tokens pensando e podem devolver
`finish_reason: "length"` com conteudo vazio. Quando isso acontece, o cliente dobra o
`max_tokens` e tenta de novo (ate 8000) em vez de repetir com o mesmo teto — repetir igual
produzia a mesma nota falhando cinco vezes.

## Worker opcional no navegador

Estas rotas so existem quando `DIARY_BROWSER_WORKER` nao e `false`. O padrao e ligado: sem
nenhum worker registrado, o comportamento e exatamente o de hoje. O dashboard usa a fila
existente (`jobs`) com claim, lease, heartbeat, complete e fail; nao ha fila paralela.

A presenca e em memoria, com TTL de 60 s. Enquanto houver um worker `browser` com
`prefer_client: true` e heartbeat valido, os runners do servidor deixam de pegar
`transcribe` e `analyze` (so `cleanup` continua com o servidor). O dashboard liga essa
preferencia **apenas durante um pedido explicito** do botao **Analisar**: o modo local
ligado e ocioso nao pausa a VPS nem consome a fila. Quando o pedido termina, a preferencia
volta a `false`; quando a aba fecha, a presenca expira e o servidor segue sozinho.

### POST /api/v1/worker/register
```json
{
  "worker_id": "tab-<uuid>",
  "kind": "browser",
  "tier": 3,
  "prefer_client": false,
  "models": ["onnx-community/whisper-large-v3-turbo", "lfm2.5-2.6b-q5"],
  "caps": { "browser": "Edge", "gpu": "AMD Radeon RX 580", "vram_gb": 8 }
}
```
Registra ou atualiza a presenca. `prefer_client: false` e o estado normal do worker:
baixando modelos ou ocioso, ele aparece no diagnostico mas nao pausa o servidor. O
dashboard envia `prefer_client: true` so enquanto existe uma nota pedida no botao
**Analisar**. Resposta:
```json
{ "worker": { "id": "tab-...", "tier": 3, "prefer_client": false, "last_seen": "..." },
  "ttl_seconds": 60, "server_time": "..." }
```

### POST /api/v1/worker/heartbeat
```json
{ "worker_id": "tab-...", "job_id": "job_..." }
```
Renova a presenca e o lease do job. `409` com `{ "lost": true }` quando o lease ja nao
pertence ao worker: o cliente deve descartar o resultado e pedir outro job.

### POST /api/v1/worker/claim
```json
{ "worker_id": "tab-...", "lease_seconds": 120, "types": ["transcribe", "analyze"],
  "entry_id": "en_...", "only_entry": true }
```
Reserva o proximo job disponivel. `entry_id` e opcional e, sozinho, apenas ordena: o job
daquela nota passa na frente dos mais antigos. Com `only_entry: true` a reserva fica
restrita aquela nota: se ela ainda nao entrou na fila, a resposta e `{ "job": null }` e o
worker nao pega o trabalho de outra pessoa. O dashboard usa `only_entry` no **Analisar**,
para que o modo local nunca consuma a fila por conta propria. O servidor ignora qualquer
tipo fora de `transcribe` e `analyze`; `cleanup` e sempre do servidor. `prefer_client`
precisa ser `true` (senao `409` `worker_not_ready`). Resposta com o job ou
`{ "job": null }`:
```json
{ "job": { "id": "job_...", "type": "transcribe",
  "payload": { "entry_id": "en_...", "attachment_id": "at_..." },
  "attempts": 0, "max_attempts": 5, "lease_seconds": 120 } }
```
Ao reservar, a entrada muda para `transcribing`/`analyzing` e o evento `entry.status` sai,
para o painel mostrar o trabalho acontecendo no PC.

### POST /api/v1/worker/complete
```json
{ "worker_id": "tab-...", "job_id": "job_..." }
```
Conclui o job, mas so se ele ainda pertence ao worker (`409` com `{ "lost": true }` caso
contrario). Ao concluir uma transcricao, o servidor enfileira a analise (salvo quando a
nota tem `local_analysis`). Ao concluir uma analise, a entrada volta para `ready`.

### POST /api/v1/worker/fail
```json
{ "worker_id": "tab-...", "job_id": "job_...", "error": "memoria insuficiente" }
```
Registra a falha com backoff. `error` vai para o diagnostico: o cliente manda uma mensagem
curta e generica, nunca texto da nota. Na ultima tentativa a entrada vira `failed` e o
evento `entry.failed` sai.

### POST /api/v1/worker/release
```json
{ "worker_id": "tab-...", "job_id": "job_..." }
```
Devolve o job em andamento para a fila sem contar tentativa: o servidor assume a nota
na hora. E a acao **no servidor** do painel da nota, para quando o PC esta lento demais.
`409` com `{ "lost": true }` quando o job ja nao pertence ao worker.

### POST /api/v1/worker/unregister
```json
{ "worker_id": "tab-..." }
```
Remove a presenca na hora e devolve o job em andamento para a fila; o servidor reassume no
proximo ciclo. A aba manda este aviso com `keepalive` ao recarregar ou fechar.

### GET /api/v1/worker/status
```json
{ "workers": [ { "id": "tab-...", "kind": "browser", "tier": 3,
    "prefer_client": true, "models": ["..."], "current_job": "job_...",
    "last_seen": "..." } ],
  "preferred": true, "ttl_seconds": 60,
  "queue": { "queued": 4, "retrying": 0, "running": 1, "dead": 0 } }
```
Usado pelo laboratorio do dashboard para mostrar a fila e quem esta processando.

### GET /api/v1/analysis/runs/summary
Agregado das execucoes de analise do worker, para o diagnostico do app
(Configs > Avancado). Filtro `days` (padrao 30, teto 365). Nao expoe conteudo,
so medidas.
```json
{
  "days": 30,
  "since": "2026-09-19T12:00:00Z",
  "totals": { "runs": 10, "ok": 8, "failed": 1, "fallback": 1,
    "success_rate": 0.8, "simplified_rate": 0.1,
    "avg_duration_ms": 1234, "tokens_per_second": 12.3 },
  "models": [ { "runtime": "server", "provider": "openai", "model": "gpt",
    "runs": 10, "ok": 8, "failed": 1, "fallback": 1,
    "success_rate": 0.8, "simplified_rate": 0.1,
    "avg_duration_ms": 1234, "tokens_per_second": 12.3 } ]
}
```
- `ok` e sucesso; `fallback` e a leitura simplificada; `failed` inclui erro, JSON
  invalido e execucao interrompida.
- Tempo medio e tokens/s consideram apenas as execucoes com `outcome=ok`.
- As execucoes locais do app nao sobem para o servidor; o app agrega as suas em
  `mobile/src/core/analysisRuns.ts`.

### GET /api/v1/analyze/local
Estado de um runtime local (o provedor sem chave, configurado em um clique). O parametro
`runtime` aceita `ollama` (padrao) ou `embedded`:

```http
GET /api/v1/analyze/local?runtime=ollama
```

Ollama: faz uma consulta curta ao servidor `DIARY_OLLAMA_URL` (padrao
`http://ollama:11434`):
```json
{
  "runtime": "ollama",
  "available": true,
  "base_url": "http://ollama:11434/v1",
  "models": ["qwen2.5:0.5b"],
  "model": "qwen2.5:0.5b",
  "downloaded": true,
  "pull": { "model": "qwen2.5:0.5b", "percent": 42, "done": false }
}
```
- `available` falso quando o Ollama nao responde (o painel mostra que o servico esta fora).
- `pull` so aparece quando ha (ou houve) um download iniciado por este endpoint.

llama.cpp embutido:
```json
{
  "runtime": "embedded",
  "available": true,
  "base_url": "http://127.0.0.1:11435/v1",
  "models": ["qwen2.5-0.5b-instruct-q4_k_m"],
  "model": "qwen2.5-0.5b-instruct-q4_k_m",
  "downloaded": true,
  "running": false,
  "size_mb": 469,
  "pull": { "model": "qwen2.5-0.5b-instruct-q4_k_m", "percent": 100, "done": true }
}
```
- `available` diz se o binario `llama-server` existe nesta imagem; `downloaded` diz se o
  GGUF esta no volume de modelos; `running` diz se o processo esta no ar agora.
- O processo so sobe na primeira analise (ou no ping) e e liberado depois de
  `DIARY_LLAMA_IDLE_SECONDS` sem uso. Nada fica residente entre analises.
- `503 local_unavailable` tambem e o codigo do `POST` quando o binario ou o modelo nao
  existem.

### POST /api/v1/analyze/local
Configura a analise para usar um runtime local em uma requisicao. Corpo:
```json
{ "runtime": "ollama", "model": "qwen2.5:0.5b" }
```
- `runtime` e opcional e vale `ollama` quando ausente; `embedded` usa o catalogo de GGUF.
- Salva `analyze_enabled=true`, `analyze_provider=openai`, `analyze_base_url=<runtime>/v1`,
  `analyze_model` e `analyze_local_runtime` **juntos** (transacao), para a analise nunca
  ficar apontando para um provedor pela metade.
- Se o modelo ainda nao estiver instalado, dispara o download em segundo plano (o `GET`
  acima informa o progresso) e responde `{"status":"downloading", ...}`; modelo instalado
  responde `{"status":"ready", ...}`.
- `503 local_unavailable` quando o Ollama nao responde, quando o binario embutido nao esta
  na imagem ou quando o runtime nao esta disponivel; nesses casos nada e salvo. Modelo
  ausente no runtime embutido dispara o download, como no Ollama.
- Nao aceita chave: nem o Ollama local nem o llama.cpp embutido tem uma.

## Entidades e humor

### GET /api/v1/entities
Lista as entidades extraidas, ordenadas por mencoes. Filtro opcional `kind` (`person`,
`place`, `theme` ou `decision`; outro valor retorna 400).
```json
{ "entities": [ { "id": "01J...", "kind": "person", "name": "Maria", "icon": "",
  "entries": 2, "mentions": 5, "sentiment": 0.4, "last_seen": "2026-10-10T21:05:00Z" } ] }
```

### GET /api/v1/entities/{kind}/{name}
Retorna a entidade (mesmos campos) mais a lista de entradas que a mencionam. Nomes antigos
de uma entidade renomeada continuam resolvendo pelo alias. 404 se nao existir.
```json
{ "kind": "person", "name": "Maria", "icon": "heart", "entries": 2, "mentions": 5,
  "sentiment": 0.4, "last_seen": "...",
  "entry_list": [ { "id": "en_...", "title": "...", "date": "...", "count": 3 } ] }
```

### GET /api/v1/entities/{kind}/{name}/mentions
Retorna os trechos que provam a entidade no mapa: segmentos da transcricao (com o tempo do
audio) e frases do texto escrito. Nomes antigos tambem sao procurados via alias. Cada
trecho carrega a leitura da analise daquela nota em `comment`.
```json
{ "mentions": [
  { "entry_id": "en_...", "title": "...", "date": "...", "source": "transcript",
    "text": "fui ao recife com maria", "term": "Maria",
    "start_ms": 65000, "end_ms": 70000, "comment": "Uma tarde no Recife." },
  { "entry_id": "en_...", "title": "...", "date": "...", "source": "text",
    "text": "Ontem encontrei Maria no Recife.", "term": "Maria", "comment": "..." }
] }
```
- `source` e `transcript` quando o trecho vem do audio e `text` quando vem do corpo da
  nota. `start_ms`/`end_ms` so aparecem na transcricao.
- `term` e a grafia que casou (nome atual ou alias), para o cliente destacar.
- Le no maximo 12 entradas, 2 trechos da transcricao e 2 do texto por entrada, e 24
  trechos no total. 404 se a entidade nao existir.

### PATCH /api/v1/entities/{kind}/{name}
Renomeia uma pessoa, lugar, tema ou decisao. Corpo:
```json
{ "name": "Marianna" }
```
- O nome antigo vira alias: uma analise futura que ainda diga "Mariana" cai na mesma
  entidade, sem criar uma segunda. O nome atual tambem resolve pelo alias em
  `GET /entities/{kind}/{name}`.
- Se o novo nome ja existir para o mesmo tipo, as duas entidades sao **mescladas**: as
  notas e mencoes passam para a sobrevivente, e o nome antigo vira alias dela.
- 400 `invalid_name` para nome vazio/longo, 404 quando o nome antigo nao existe.
- Para juntar duas grafias da mesma pessoa, lugar, tema ou decisao, basta renomear para o
  nome canonico da entidade que deve sobreviver: a mesclagem soma notas/mencoes e o nome
  antigo vira alias. O dashboard oferece essa escolha como "Mesclar em" no painel de
  renomear, com a lista do mesmo tipo. A decisao fica salva no alias: analises futuras com
  a grafia antiga caem na sobrevivente, sem repetir a mesclagem.

### PUT /api/v1/entities/{kind}/{name}/icon
Escolhe o icone monocromatico desenhado dentro da bola. Corpo:
```json
{ "icon": "heart" }
```
- A chave vem da paleta compartilhada (`person`, `home`, `hash`, `check`, `heart`, `star`,
  `book`, `briefcase`, `music`, `health`, `money`, `food`, `car`, `plane`, `tree`, `sun`,
  `moon`, `flag`, `globe`, `camera`, `document`). Vazio volta ao icone do tipo.
- 400 `invalid_icon` para chave fora da paleta/kind invalido; 404 se a entidade nao existe.
- Retorna a entidade com `icon` ja atualizado. O mapa recebe a chave em `nodes[].icon`.

### POST /api/v1/entities/person/{name}/self
Marca uma pessoa como **o dono do diario** ("sou eu"). Usado quando a IA tratou uma
grafia do nome do dono como outra pessoa.
- A entidade e removida: ela deixa de ser um no separado do mapa. O nome atual e todos os
  aliases dela passam a ser grafias do dono.
- Toda analise, antiga ou nova, resolve essas grafias para o `owner_name` das
  configuracoes na leitura (nomes estruturados e prosa); o audio, a transcricao e o corpo
  da nota continuam intactos.
- Uma analise futura que ainda extraia a grafia antiga nao recria a pessoa.
- Resposta: `{"status":"ok","owner":"<nome do dono>"}`. 404 se a pessoa nao existir.

### GET /api/v1/mood
Serie temporal do sentimento por dia. Filtros opcionais `from` e `to` (RFC 3339 ou
`YYYY-MM-DD`; `to` inclui o dia inteiro).
```json
{ "mood": [ { "date": "2026-10-10", "sentiment": 0.4, "entries": 2 } ] }
```

## Mapa de relacoes

### GET /api/v1/graph
Mapa centrado no dono do diario. Sem `focus`, devolve o ego de entidades: o centro e o
dono, cada pessoa/lugar/tema aparece uma vez e as arestas ligam o centro a entidade
(peso = numero de notas que a mencionam) ou duas entidades que dividem uma nota
(co-ocorrencia, peso = notas em comum). O autor da nota **nao** filtra o mapa: todas as
notas do diario entram; o papel do autor so muda a leitura da primeira pessoa pela IA.

Filtros opcionais: `notebook_id`, `from` e `to` (RFC 3339 ou `YYYY-MM-DD`; `to` inclui o
dia inteiro) e `focus` (id de um no, por exemplo `person:01J...`). `focus` devolve a
entidade, as notas dela (ate 100), as entidades dessas notas e as arestas
`note -> entidade`; o centro aparece ligado so a entidade focada, nunca as notas.

```json
{
  "center": { "id": "user", "kind": "user", "label": "João" },
  "nodes": [
    { "id": "person:01J...", "kind": "person", "label": "Maria", "icon": "heart",
      "mentions": 42, "notes": 7, "sentiment": 0.4, "last_seen": "2026-10-10T21:05:00Z" }
  ],
  "edges": [
    { "source": "user", "target": "person:01J...", "kind": "relation", "weight": 7 },
    { "source": "person:01J...", "target": "theme:01K...", "kind": "cooccurrence", "weight": 3 }
  ],
  "total_nodes": 120,
  "total_edges": 850,
  "truncated": false
}
```

- Nos de entidade: `mentions` (soma das mencoes) define o raio; `notes` e o peso da
  aresta do centro; `sentiment` so e preenchido para pessoas. Decisoes entram como
  `kind: "decision"`, com o texto da decisao como nome.
- No modo `focus`, cada nota vira um no `note:<entry_id>` com `title`, `date` e `author`
  (papel explicito) e as arestas `mention`.
- Tetos: 250 entidades e 1500 arestas; 100 notas e 1500 arestas no foco. As arestas de
  co-ocorrencia sao limitadas as mais fortes por no. `truncated` avisa quando algo ficou
  de fora; `total_nodes`/`total_edges` trazem o total antes do corte.
- `404` quando `focus` aponta para uma entidade que nao existe (ou nao aparece no filtro).

## Metricas de escrita

O app calcula as metricas da escrita **offline** (as mesmas do Painel no celular) e
envia o documento pronto. O servidor guarda o ultimo snapshot de cada aparelho e o
painel web desenha exatamente o que o aparelho calculou — sem recalcular nada.

O contrato tem duas versoes aceitas:
- **schema 1** (legado): `writing` com todas as notas + `history`.
- **schema 2** (atual): `streak` + `windows` (7d/30d/365d) + `history`. Cada janela
  tem `writing`, `voice`, `images`, `analysis`, `sentiment` e `summary`.
O app envia schema 2; o servidor continua aceitando schema 1 de aparelhos antigos.

### PUT /api/v1/metrics
Envia (ou substitui) o snapshot de um aparelho. Corpo (schema 2):
```json
{
  "device_id": "dev_01J8Z...",
  "device_name": "android 15",
  "schema": 2,
  "generated_at": "2026-10-19T12:00:00Z",
  "streak": { "current": 5, "longest": 21, "wrote_today": true },
  "windows": {
    "7d":   { "from": "2026-10-13", "to": "2026-10-19", "writing": { }, "voice": { },
              "images": { }, "analysis": { }, "sentiment": { }, "summary": [] },
    "30d":  { },
    "365d": { }
  },
  "history": { }
}
```
Resposta 200: `{ "status": "ok", "received_at": "...", "schema": 2 }`.
- `device_id` e opaco, gerado pelo app na primeira vez e guardado no aparelho; o
  servidor guarda um snapshot por aparelho (o ultimo enviado vence).
- `schema` e 1 ou 2; qualquer outra versao responde `400 unsupported_schema`.
- O servidor valida o envelope e a secao obrigatoria de cada versao (`writing` no
  schema 1; `windows` e `streak` no schema 2), que `history` seja objeto quando
  presente, que `generated_at` seja RFC 3339 e que o documento caiba em 256 KiB.
  **O documento inteiro e guardado como veio**, inclusive secoes que o servidor
  ainda nao conhece; so `device_id`/`device_name` saem do payload.
- O app guarda o mesmo documento localmente mesmo sem servidor, entao um aparelho
  offline nao perde nada: o snapshot sobe depois.

Contrato de `writing` no schema 2 (uma janela), espelhado em
`mobile/src/core/metricsSnapshot.ts` e em `web/src/types.ts`:
- Volume: `notes`, `with_text`, `with_audio`, `with_transcript`, `words`, `chars`,
  `sentences`, `paragraphs`, `unique_words`, `lexical_richness` (0..1),
  `average_words_per_note`, `average_sentence_words`, `average_word_length`,
  `reading_minutes`.
- Ranking: `top_words[]` e `longest_words[]` (`{ "label": ..., "value": ... }`).
- Marcadores: `questions`, `exclamations`, `links`, `images`, `list_items`.
- Habito: `active_days`, `average_notes_per_active_day`, `notes_per_week`,
  `top_weekday`, `top_hour`, `weekday_hour`, `longest_note`.
- Constancia: `consistency` (`days[]` com `key`, `wrote`, `notes`, `words`;
  `written_days`, `tracked_days`, `rate`, `longest_run`).

`voice`: `audio_count`, `audio_minutes`, `transcribed_minutes`, `coverage`,
`words`, `words_per_minute`, `words_per_audio`, `origin_local`, `origin_server`,
`transcript_share`.

`images`: `count`, `bytes_total`, `bytes_average`, `per_note`, `notes_with_image`,
`notes_with_image_no_text`.

`analysis`: `notes_with_content`, `notes_analyzed`, `coverage`, `stale`,
`simplified`, `last_analyzed_at`.

`topics`: `themes[]`, `people[]` e `places[]`, cada item
`{ "label": ..., "count": ... }`; sao os nomes mais citados nas analises da
janela (ate 8 por tipo).

`sentiment`: `source` (`analysis` ou `lexical`), `analyzed`, `positive`, `neutral`,
`negative`, `average`, `top_positive`, `top_negative`,
`emotions[]` (`{ "label": ..., "count": ..., "tone": "positive|neutral|negative" }`),
`series[]` (`{ "key": ..., "average": ..., "notes": ... }`) e `granularity`
(`day` ou `week`). O `tone` de cada emocao vem do sentimento das notas em que ela
apareceu; o app usa verde para cima e vermelho para baixo.

`summary[]`: frases prontas do resumo da janela.

`streak`: `current`, `longest`, `wrote_today` (global, independe da janela).

Contrato de `history` (igual nos dois schemas): `weekly[]` (`label`, `words`,
`notes`), `calendar[][]` (colunas de 7 dias com `key`, `words`, `notes`; `key` nulo
em dia que ainda nao aconteceu), `max_weekly` e `max_daily`.

O schema 1 continua com o contrato antigo de `writing` (todas as notas, com
`current_streak`, `longest_streak`, `wrote_today`, `monthly`, `month_comparison_pct`,
`transcript_words`, `average_transcript_words`, `first_at`, `last_at` e `insights`)
e `sentiment` lexico (`analyzed`, `average`, `positive`, `neutral`, `negative`,
`top_positive`, `top_negative`).

### GET /api/v1/metrics
Ultimo snapshot de cada aparelho, do mais recente para o mais antigo. Cada item
carrega o proprio `schema`; o `schema` do topo e a versao atual do servidor (2).
```json
{
  "schema": 2,
  "snapshots": [ { "device_id": "...", "device_name": "android 15", "schema": 2,
    "generated_at": "...", "received_at": "...", "streak": { }, "windows": { },
    "history": { } } ]
}
```
Snapshots antigos continuam aparecendo com `schema: 1` e o layout de todas as notas.
Filtro opcional `limit` (padrao 50, teto 200).

### DELETE /api/v1/metrics/{device_id}
Remove o snapshot de um aparelho. Resposta 204, ou 404 se aquele aparelho nunca
enviou metricas.

## Cadernos

Cada nota pertence a exatamente um caderno. O caderno padrao `notas-ao-acaso`
("Notas ao acaso") e criado pela migracao 0017, nao pode ser renomeado nem
excluido, e recebe as notas de cadernos excluidos.

### GET /api/v1/notebooks
Lista cadernos em ordem de criacao, com o padrao no fim:
```json
{ "notebooks": [ { "id": "...", "name": "Trabalho", "color": "#C7D8F2",
  "is_default": false, "entry_count": 12, "last_entry_at": "...",
  "created_at": "...", "updated_at": "..." } ] }
```
`entry_count` e `last_entry_at` consideram apenas notas ativas (nao arquivadas,
nao apagadas); `last_entry_at` usa `recorded_at` (a data real da nota).

### POST /api/v1/notebooks
Cria um caderno (`{ "name": "...", "color": "...", "id": "nb_..." }`).
- `id` e opcional: o app cria offline e preserva o mesmo id nos dois lados. Se o
  id ja existir, responde 200 com o caderno existente (idempotente).
- Nome vazio: 400 `invalid_name`; nome duplicado (case-insensitive): 409 `conflict`.

### PATCH /api/v1/notebooks/{id}
Renomeia e/ou recolore (`{ "name": "...", "color": "..." }`). O padrao responde
409 `protected`; nome duplicado responde 409 `conflict`.

### DELETE /api/v1/notebooks/{id}
Exclui o caderno e move as notas para "Notas ao acaso" na mesma transacao.
204; 409 `protected` para o padrao; 404 se nao existir.

## Tags

### GET /api/v1/tags
Lista tags com contagem de entradas e cor. A cor e pastel, gerada de forma
deterministica a partir do nome (mesma paleta no servidor, no app e no web);
tags antigas sem cor sao preenchidas no boot.

### POST /api/v1/tags
Cria uma tag (`{ "name": "...", "color": "..." }`). Sem cor, usa a paleta.

### PATCH /api/v1/tags/{id} e DELETE /api/v1/tags/{id}
`PATCH` renomeia e/ou recolore (`{ "name": "...", "color": "..." }`). Renomear
para um nome que ja existe **mescla** as duas tags: as notas passam para a tag
existente, a antiga e apagada, e a resposta traz `merged: true` com o id da tag
que ficou. Remover uma tag remove as associacoes (`EntryTag`), mas nao as notas.

## Notas

O corpo da nota e markdown, escrito e lido pelas rotas da secao
"Markdown como formato da nota" (mais acima). Aqui fica o resto.

### GET /api/v1/entries/{id}/notes
Lista notas da entrada, com `content_markdown` e `body_version`. O corpo e sempre
markdown: as notas antigas foram convertidas e o JSON do BlockNote saiu do
contrato.

### GET /api/v1/notes/{id}
Retorna uma nota (markdown + `body_version`).

### DELETE /api/v1/notes/{id}

### GET /api/v1/notes/{id}/revisions
Lista revisoes da nota, com o corpo anterior em `content_markdown`. Uma revisao so
e criada quando o texto realmente mudou. E a fonte para comparar (diff) e
recuperar o texto que a ultima-gravacao-vence substituiu. (A coluna no banco se chama `document`
por heranca do JSON antigo; o conteudo gravado e markdown.)
Pagina com `limit` (padrao 50, teto 200) e `cursor`; a resposta pode trazer
`next_cursor` quando houver mais historico.

## Links

Relacoes de uma entrada com outra entrada ou com uma URL externa.

### GET /api/v1/entries/{id}/links
Lista os links de uma entrada. Links internos trazem `title` com o titulo da
entrada de destino; links para URLs trazem `url`.
```json
{ "links": [ { "id": "ln_...", "from_entry_id": "en_...", "to_entry_id": "en_...",
  "url": "", "label": "continuacao", "title": "Conversa de domingo",
  "created_at": "2026-10-10T21:05:00Z" } ] }
```

### POST /api/v1/entries/{id}/links
Cria um link. O corpo deve informar exatamente um destino: `to_entry_id` (outra
entrada) ou `url` (externa, `http` ou `https`). `label` e opcional.
```json
{ "to_entry_id": "en_...", "label": "continuacao" }
```
- 201: link criado.
- 400: corpo invalido (nenhum destino, ambos os destinos, URL invalida ou
  `to_entry_id` igual a propria entrada).
- 404: entrada de origem inexistente.
- 422: `to_entry_id` aponta para entrada inexistente.

### DELETE /api/v1/links/{id}
Remove o link. Resposta 204.

## Configuracoes

### GET /api/v1/settings
Retorna as configuracoes atuais (por exemplo, `trim_silence`, modelo de transcricao, modo
de analise e `analysis_themes`). `analysis_themes` e a lista de temas preferidos separada
por virgulas; quando vazia, o servidor devolve a lista padrao.

`owner_name` e o nome do dono do diario (texto, no maximo 80 caracteres; vazio mostra
"Você"). Ele aparece no centro do mapa e no prompt da analise. Grafias antigas marcadas
com "sou eu" no mapa resolvem para esse nome na leitura, mesmo depois de trocar o
`owner_name`. `all_notes_mine` (padrao
ligado) resolve o autor das notas sem escolha manual: ligado, o autor efetivo e o dono;
desligado, a nota fica sem autor. A escolha da nota (`author`) sempre vence.

`review_enabled` liga a revisao da transcricao por IA antes da analise (padrao desligado;
sem ela a analise continua, so perde precisao). `literal_transcript` mantem hesitacoes e
gagueira no texto revisado. As duas sao por instancia: o app tem preferencias separadas, e
ligar em um lado nao liga no outro.

`analyze_provider` escolhe o formato da API de analise:
- `openai` (padrao): endpoint compativel com OpenAI (`/chat/completions`) autenticado por
  chave (`analyze_api_key`).
- `opencode`: conecta ao OpenCode local do usuario, reutilizando o login dele no OpenCode.
  Nesse modo `analyze_base_url` e a URL do servidor do OpenCode, `analyze_api_key` e a senha
  do servico (em `~/.config/opencode/service.json` ou a senha impressa por `opencode serve`)
  e `analyze_model` usa o formato `provedor/modelo` (ex.: `opencode-go/qwen3.8-flash`). A
  lista de modelos vem de `GET /analyze/models`.

Provedores hospedados do OpenCode usam `analyze_provider=openai` com a chave do Console
(`opencode.ai/console`), porque a analise fala `/chat/completions`:
- OpenCode Zen (paga por uso, com modelos gratuitos): `analyze_base_url` =
  `https://opencode.ai/inference/openai/v1`.
- OpenCode Go (assinatura): `analyze_base_url` = `https://opencode.ai/inference/go/openai/v1`.
- Modelos Claude, GPT, Gemini e Grok do OpenCode usam outros formatos de API e nao entram
  nessa lista.
- O Ollama local nao usa chave: `POST /api/v1/analyze/local` configura URL e modelo e baixa
  o modelo quando falta. O llama.cpp embutido usa a mesma rota com
  `{"runtime":"embedded"}` e dispensa o servico do compose.

Nota de rede: quando o dyarium roda em container e o OpenCode roda no host, o container
precisa alcancar a URL informada (o OpenCode escuta em `127.0.0.1` por padrao).

### PUT /api/v1/settings
Atualiza configuracoes. Alterar `trim_silence` invalida o artefato derivado em cache
(regenerado na proxima transcricao).

## Eventos (SSE)

### GET /api/v1/events
Fluxo Server-Sent Events. Filtro opcional `entry_id`. Reconexao via `Last-Event-ID`.

Eventos previstos:
- `entry.status`: `{ "entry_id": "...", "status": "transcribing" }`
- `job.progress`: `{ "entry_id": "...", "stage": "reviewing", "done": 4, "total": 12 }`
- `transcript.revised`: `{ "entry_id": "...", "attachment_id": "...",
  "segments": [{ "idx": 12, "text": "texto revisado" }], "done": 4, "total": 12,
  "rejected": 1 }` — publicado a cada janela revisada, com os trechos que mudaram. E o que
  deixa app e dashboard mostrarem o texto se montando sem esperar a passada inteira.
- `transcript.ready`: `{ "entry_id": "...", "segment_count": 123 }`
- `analysis.ready`: `{ "entry_id": "..." }`
- `entry.failed`: `{ "entry_id": "...", "reason": "..." }`
- `notebook.changed`: `{ "notebook_id": "..." }` (criado, renomeado, recolorido ou excluido)

Cada evento tem `id` (monotonico) e `event` (nome). O cliente retoma do ultimo `id` recebido.

O dashboard consome o fluxo desde `web/src/useEvents.ts`; o app passa a consumir no mesmo
formato (proxima fase) e hoje reconcilia por polling.
