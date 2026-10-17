# API HTTP

Convencoes gerais:

- Base: `/api/v1` para os recursos; rotas de sistema em `/healthz` e `/api/v1/version`.
- Autenticacao: header `Authorization: Bearer <token>` em todas as rotas sob `/api/v1`,
  exceto `/healthz`.
- Corpo e respostas em JSON, salvo o conteudo binario do upload.
- Erros: `{ "error": { "code": "...", "message": "..." } }` com o codigo HTTP apropriado.
- Ids sao opacos (ULID/UUID). Timestamps em RFC 3339 (UTC).
- Paginacao por cursor: parametros `limit` e `cursor`; resposta com `next_cursor`.

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
- `entry_id` e opcional: quando informado, o audio concluido e adicionado a essa entrada
  em vez de criar uma nova (uma nota pode ter varios audios). 404 se a entrada nao existir.
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
Retorna a entrada completa: metadados, `audios` (cada audio com a sua transcricao),
analise, tags, notas e anexos. O `audios` e uma lista; uma nota pode ter varios. Cada
item traz `id`, `content_type`, `size_bytes`, `duration_seconds`, `created_at` e, quando
transcrito, `transcript` (modelo, idioma, texto e `segments`).

### PATCH /api/v1/entries/{id}
Atualiza campos editaveis (titulo, data do evento, tags por referencia). Nao altera o audio.

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
- Regexp de id: `attachment_id` e opcional; quando informado precisa pertencer a entrada.
- A transcricao e gravada com `model` = `local`; uma transcricao anterior daquele audio e
  substituida. Emite `transcript.ready`.

### GET /api/v1/entries/{id}/segments
Lista os segmentos com paginacao, para leitura incremental.

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
Resposta 200 (ou 206 em requisicoes parciais).

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

## Tags

### GET /api/v1/tags
Lista tags com contagem de entradas.

### POST /api/v1/tags
Cria uma tag (`{ "name": "...", "color": "..." }`).

### PATCH /api/v1/tags/{id} e DELETE /api/v1/tags/{id}
Atualizam e removem tags. Remover uma tag remove as associacoes (`EntryTag`).

## Notas

### GET /api/v1/entries/{id}/notes
Lista notas da entrada (conteudo do editor BlockNote em JSON).

### POST /api/v1/entries/{id}/notes
Cria uma nota (`{ "document": <json do BlockNote> }`).

### GET /api/v1/notes/{id}
Retorna uma nota.

### PUT /api/v1/notes/{id}
Atualiza a nota e cria uma `NoteRevision` com o estado anterior.

### DELETE /api/v1/notes/{id}

### GET /api/v1/notes/{id}/revisions
Lista revisoes da nota.

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
