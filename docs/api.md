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
  "client_key": "ck_...",
  "entry_id": "en_...",
  "local_transcribe": false
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
- `local_transcribe` (bool, opcional): quando `true`, o cliente transcreve o audio no
  aparelho e o servidor **nao** enfileira a transcricao no complete; o texto chega depois
  via `PUT /api/v1/entries/{id}/transcript`. Quem transcreve primeiro informa o outro.
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
por nome, case-insensitive). Retorna resumos com id, titulo, status, duracao e data.
Com `deleted=1` lista a **lixeira**: as entradas apagadas (remocao logica) com
`deleted_at`, da mais recente para a mais antiga.
- O app reconcilia exclusoes por esta lista, e nao por ausencia: uma entrada que
  simplesmente sumiu (servidor novo, banco restaurado) nunca apaga a nota local.
- Entradas apagadas aparecem em `entries` com `status: "deleted"` e o campo
  `deleted_at` preenchido.
- `archived=0` (padrao explicito do app e do dashboard) traz so as notas da lista
  de trabalho; `archived=1` traz so as arquivadas; **sem o filtro traz as duas**,
  para nenhum cliente perder nota por omissao.
- Cada entrada traz `archived` e `versions` com a versao atual de `title`, `recorded_at` e
  `body`. E o que o cliente guarda para mandar de volta na gravacao: assim o
  servidor consegue recusar (409) o que ja foi editado em outro lugar, e o app
  pergunta ao usuario em vez de sobrescrever. As versoes sao devolvidas
  **exatamente** como estao gravadas: reformatar aqui faria a gravacao seguinte
  do proprio cliente parecer conflito consigo mesma.

## Markdown como formato da nota

O corpo da nota (`notes`) e **markdown**, o mesmo texto que o app e o dashboard
falam. Cada campo editavel tem **versao propria** (`title`, `recorded_at`,
`body`): o cliente manda a versao que leu e o servidor so grava se ela ainda for a
atual. Se nao for, responde `409` **sem escrever** e diz qual campo brigou — o
cliente pergunta ao usuario em vez de sobrescrever em silencio.

- Versoes sao RFC 3339 (UTC, com nanossegundos) devolvidas em `versions`.
- Cliente que **nao manda versao** (app antigo) continua funcionando: ultimo a
  escrever vence.
- Os clientes oficiais usam essa politica: o app grava o corpo sem `base_version` e
  o dashboard reenvia sem versao quando recebe `409`. O pull do app aplica a versao
  do servidor quando ela e mais nova que a ultima edicao local; o `409` fica
  disponivel para clientes que queiram oferecer a escolha ao usuario.
- O titulo vive na **entrada**, nao na nota. A nota nao tem mais `title` no
  caminho de escrita: era a origem de "renomear no desktop e o titulo voltar".

### POST /api/v1/entries/{id}/notes
Cria a nota da entrada. Corpo:
```json
{ "id": "note_...", "content_markdown": "## Titulo\n\nTexto.", "base_version": "" }
```
Resposta 201 com a nota, `content_markdown` e `body_version`. `document` (JSON do
BlockNote) nao e mais aceito nem devolvido.

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
  "archived": true,
  "versions": { "title": "...", "recorded_at": "..." }
}
```
Resposta 200: `{ "status": "ok", "versions": { "title": "...", "recorded_at": "..." } }`.
- 409 com `{ "conflict": ["title"], "versions": {...} }` se aquele campo mudou
  depois da leitura; **os campos sem conflito nao sao gravados** — o cliente
  reenvia so o que o usuario escolher.
- `archived` tira a nota da lista de trabalho sem apagar: ela continua existindo
  (e no aparelho), so sai da lista do dia. E um interruptor, entao nao tem versao
  nem conflito.
- 400 quando o corpo nao traz nenhum campo.
- Nao altera o audio.

### POST /api/v1/entries
Cria uma nota escrita (sem audio). Corpo `{ "title": "...", "id": "note_...", "created_at": "..." }`.
A entrada nasce com `source: "text"` e `status: "ready"`; o corpo e gravado como documento de nota (BlockNote),
igual a parte escrita de uma nota de audio. Analises usam a transcricao quando existe e,
caso contrario, o texto escrito da nota.
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
`duration_seconds`, **sem `segments`**. Os segmentos sao grandes e so fazem falta
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
Retorna a transcricao atual, com `segments` (inicio, fim, texto) e metadados do modelo.

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
  substituida. Emite `transcript.ready`.

### GET /api/v1/entries/{id}/segments
Lista os segmentos com paginacao, para leitura incremental. Parametros:
`attachment_id` (opcional; sem ele usa a transcricao mais recente da entrada),
`limit` (padrao 200, teto 1000) e `cursor` (o `next_cursor` da pagina anterior).
Resposta: `{ "segments": [{ "start_ms", "end_ms", "text" }], "next_cursor": "..." }`.
`next_cursor` so aparece quando existe outra pagina.

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
Remove o anexo e o objeto cifrado. Resposta 204.

## Analise

### GET /api/v1/entries/{id}/analysis
Retorna a analise da entrada. Mantem os campos legados (`sentiment` numerico, `emotions`
como mapa, `people`/`places` como lista de nomes, `summary`) e acrescenta `sentiment_label`
e os campos ricos lidos de `data`:

```json
{
  "model": "qwen3.8-flash",
  "sentiment": 0.5,
  "sentiment_label": "positivo",
  "emotions": { "alegria": 0.8 },
  "people": ["Maria"],
  "places": ["Recife"],
  "summary": "Falou da familia e da saudade de Recife.",
  "emotions_detail": [{ "name": "alegria", "intensity": 0.8 }],
  "people_detail": [{ "name": "Maria", "count": 3, "relation": "irma", "sentiment": 0.5 }],
  "places_detail": [{ "name": "Recife", "count": 2 }],
  "themes": [{ "name": "familia", "confidence": 0.9 }],
  "key_moments": [{ "start_ms": 123000, "text": "..." }],
  "questions": ["..."],
  "decisions": ["..."],
  "data": { "sentiment": { "score": 0.5, "label": "positivo" }, "...": "..." }
}
```
- Entradas analisadas antes da analise rica nao tem `data`; nesse caso apenas os campos
  legados sao retornados.

### POST /api/v1/entries/{id}/analyze
Enfileira um job `analyze`. Retorna 409 se a analise estiver desligada na configuracao.
O worker analisa a transcricao em janelas quando ela e longa, mescla os resultados e faz um
meta-resumo quando ha mais de uma janela. Pessoas, lugares e temas viram entidades
consultaveis.

### GET /api/v1/analyze/local
Estado do Ollama local (o provedor sem chave, configurado em um clique). Faz uma consulta
curta ao servidor `DIARY_OLLAMA_URL` (padrao `http://ollama:11434`):
```json
{
  "available": true,
  "base_url": "http://ollama:11434/v1",
  "models": ["qwen2.5:0.5b"],
  "model": "qwen2.5:0.5b",
  "pull": { "model": "qwen2.5:0.5b", "percent": 42, "done": false }
}
```
- `available` falso quando o Ollama nao responde (o painel mostra como subir o servico).
- `pull` so aparece quando ha (ou houve) um download iniciado por este endpoint.

### POST /api/v1/analyze/local
Configura a analise para usar o Ollama local em uma requisicao. Corpo:
```json
{ "model": "qwen2.5:0.5b" }
```
- Salva `analyze_enabled=true`, `analyze_provider=openai`, `analyze_base_url=<ollama>/v1`
  e `analyze_model` **juntos** (transacao), para a analise nunca ficar apontando para um
  provedor pela metade.
- Se o modelo ainda nao estiver instalado, dispara o download em segundo plano (o `GET`
  acima informa o progresso) e responde `{"status":"downloading", ...}`; modelo instalado
  responde `{"status":"ready", ...}`.
- `503 local_unavailable` quando o Ollama nao responde; nesse caso nada e salvo.
- Nao aceita chave: o Ollama local nao tem uma.

## Entidades e humor

### GET /api/v1/entities
Lista as entidades extraidas, ordenadas por mencoes. Filtro opcional `kind` (`person`,
`place` ou `theme`; outro valor retorna 400).
```json
{ "entities": [ { "kind": "person", "name": "Maria", "entries": 2, "mentions": 5,
  "sentiment": 0.4, "last_seen": "2026-10-10T21:05:00Z" } ] }
```

### GET /api/v1/entities/{kind}/{name}
Retorna a entidade (mesmos campos) mais a lista de entradas que a mencionam. 404 se nao
existir.
```json
{ "kind": "person", "name": "Maria", "entries": 2, "mentions": 5, "sentiment": 0.4,
  "last_seen": "...", "entry_list": [ { "id": "en_...", "title": "...", "date": "...", "count": 3 } ] }
```

### GET /api/v1/mood
Serie temporal do sentimento por dia. Filtros opcionais `from` e `to` (RFC 3339 ou
`YYYY-MM-DD`; `to` inclui o dia inteiro).
```json
{ "mood": [ { "date": "2026-10-10", "sentiment": 0.4, "entries": 2 } ] }
```

## Metricas de escrita

O app calcula as metricas da escrita **offline** (as mesmas do Painel no celular) e
envia o documento pronto. O servidor guarda o ultimo snapshot de cada aparelho e o
painel web desenha exatamente o que o aparelho calculou — sem recalcular nada.

### PUT /api/v1/metrics
Envia (ou substitui) o snapshot de um aparelho. Corpo:
```json
{
  "device_id": "dev_01J8Z...",
  "device_name": "android 15",
  "schema": 1,
  "generated_at": "2026-10-16T12:00:00Z",
  "writing": { "...": "metricas" },
  "history": { "...": "series para os graficos" }
}
```
Resposta 200: `{ "status": "ok", "received_at": "...", "schema": 1 }`.
- `device_id` e opaco, gerado pelo app na primeira vez e guardado no aparelho; o
  servidor guarda um snapshot por aparelho (o ultimo enviado vence).
- `schema` e a versao do contrato. O servidor so aceita a versao atual
  (`400 unsupported_schema`): assim um app mais novo nunca deixa um documento que o
  painel nao sabe ler.
- `writing` e `history` sao objetos JSON livres dentro do contrato (abaixo). O
  servidor valida que sao objetos, que o total cabe em 256 KiB e que `generated_at` e
  RFC 3339; o resto ele guarda como veio, para o app poder evoluir as metricas sem
  migracao no servidor.
- O app guarda o mesmo documento localmente mesmo sem servidor, entao um aparelho
  offline perde nada: o snapshot sobe depois.

Contrato de `writing` (versao 1), espelhado em `mobile/src/core/metricsSnapshot.ts`
e em `web/src/types.ts`:
- Volume: `notes`, `with_text`, `with_audio`, `with_transcript`, `words`, `chars`,
  `sentences`, `paragraphs`, `unique_words`, `lexical_richness` (0..1),
  `average_words_per_note`, `average_sentence_words`, `average_word_length`,
  `transcript_words`, `average_transcript_words`.
- Ranking: `top_words[]` e `longest_words[]` (`{ "label": ..., "value": ... }`).
- Marcadores: `questions`, `exclamations`, `links`, `images`, `list_items`.
- Habito: `active_days`, `average_notes_per_active_day`, `current_streak`,
  `longest_streak`, `wrote_today`, `top_weekday`, `top_hour`, `first_at`, `last_at`,
  `longest_note`, `monthly[]`, `month_comparison_pct`.
- Humor (lexico local do app): `sentiment` (`analyzed`, `average`, `positive`,
  `neutral`, `negative`, `top_positive`, `top_negative`).
- Constancia (dias escritos vs nao escritos): `consistency` (`days[]` com `key`,
  `wrote`, `notes`, `words`; `written_days`, `tracked_days`, `rate`, `longest_run`).
- Ritmo: `weekday_hour` (grade 7 x 8 faixas de 3 horas, quantas notas por celula).
- `insights[]`: frases prontas derivadas dos numeros.

Contrato de `history` (versao 1): `weekly[]` (`label`, `words`, `notes`),
`calendar[][]` (colunas de 7 dias com `key`, `words`, `notes`; `key` nulo em dia que
ainda nao aconteceu), `max_weekly` e `max_daily`.

### GET /api/v1/metrics
Ultimo snapshot de cada aparelho, do mais recente para o mais antigo.
```json
{
  "schema": 1,
  "snapshots": [ { "device_id": "...", "device_name": "android 15", "schema": 1,
    "generated_at": "...", "received_at": "...", "writing": { }, "history": { } } ]
}
```
Filtro opcional `limit` (padrao 50, teto 200).

### DELETE /api/v1/metrics/{device_id}
Remove o snapshot de um aparelho. Resposta 204, ou 404 se aquele aparelho nunca
enviou metricas.

## Tags

### GET /api/v1/tags
Lista tags com contagem de entradas.

### POST /api/v1/tags
Cria uma tag (`{ "name": "...", "color": "..." }`).

### PATCH /api/v1/tags/{id} e DELETE /api/v1/tags/{id}
Atualizam e removem tags. Remover uma tag remove as associacoes (`EntryTag`).

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
e criada quando o texto realmente mudou. (A coluna no banco se chama `document`
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
  o modelo quando falta.

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
- `job.progress`: `{ "job_id": "...", "entry_id": "...", "progress": 0.42, "stage": "..." }`
- `transcript.ready`: `{ "entry_id": "...", "segment_count": 123 }`
- `analysis.ready`: `{ "entry_id": "..." }`
- `entry.failed`: `{ "entry_id": "...", "reason": "..." }`

Cada evento tem `id` (monotonico) e `event` (nome). O cliente retoma do ultimo `id` recebido.

Nota: o SSE e especificado aqui, mas a implementacao fica para uma fase posterior ao
ambiente de desenvolvimento. A Fase 2 entrega `GET /healthz`, `/api/v1/version`, a
autenticacao Bearer e o shell do dashboard.
