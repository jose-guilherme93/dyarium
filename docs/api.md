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
  "client_key": "ck_..."
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
- `duration_seconds` e aceito no corpo mas ignorado; o servidor mede a duracao com ffprobe
  no complete.
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
com o informado. Em caso de sucesso, cria a `Entry` e enfileira `transcribe`.
Resposta 201:
```json
{ "entry_id": "en_...", "status": "queued" }
```
- 422: integridade divergente (SHA-256), formato nao aceito ou duracao acima do limite.
- 404: upload inexistente ou expirado.

Dedupe por conteudo: como o audio e imutavel, o SHA-256 e a identidade da gravacao. Se ja
existe uma `Entry` ativa (nao removida) com o mesmo hash, nenhuma entrada nova e criada: o
objeto recem-recebido e descartado e a resposta devolve a entrada existente com
`"duplicate": true`:
```json
{ "entry_id": "en_...", "status": "ready", "duplicate": true }
```
Nesse caso nao ha nova transcricao a enfileirar. Entradas removidas nao contam para o dedupe.

Toda `Entry` criada tem titulo e dia no calendario: se `title` nao vier, o servidor usa o
nome original do arquivo (sem diretorio e extensao) e, se ainda assim ficar vazio, a data e
hora; se `recorded_at` nao vier, usa o instante da criacao. O mesmo vale para entradas de
outras fontes (ex.: Telegram).

## Entries

### GET /api/v1/entries
Lista entradas. Filtros: `status`, `tag`, `q` (busca textual na transcricao), `from`, `to`
(intervalo de data), `mood`. Retorna resumos com id, titulo, status, duracao, data, tags e
trecho inicial da transcricao.

### GET /api/v1/entries/{id}
Retorna a entrada completa: metadados, transcricao (com segmentos), analise, tags, notas e
anexos.

### PATCH /api/v1/entries/{id}
Atualiza campos editaveis (titulo, data do evento, tags por referencia). Nao altera o audio.

### DELETE /api/v1/entries/{id}
Remocao logica da entrada; o job de limpeza remove os objetos cifrados depois.

### POST /api/v1/entries/{id}/retranscribe
Enfileira um novo job de transcricao (por exemplo, apos mudar o modelo ou o corte de
silencio). O audio original permanece intacto.

## Transcricao

### GET /api/v1/entries/{id}/transcript
Retorna a transcricao atual, com `segments` (inicio, fim, texto) e metadados do modelo.

### GET /api/v1/entries/{id}/segments
Lista os segmentos com paginacao, para leitura incremental.

## Analise

### GET /api/v1/entries/{id}/analysis
Retorna a analise: sentimento, emocoes, pessoas, lugares e resumo.

### POST /api/v1/entries/{id}/analyze
Enfileira um job `analyze`. Retorna 409 se a analise estiver desligada na configuracao.

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

## Configuracoes

### GET /api/v1/settings
Retorna as configuracoes atuais (por exemplo, `trim_silence`, modelo de transcricao, modo
de analise).

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
