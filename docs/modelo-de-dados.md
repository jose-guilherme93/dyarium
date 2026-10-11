# Modelo de dados

Banco: SQLite em modo WAL. Todas as tabelas usam chaves primarias TEXT opacas (ULID),
exceto as tabelas de juncao. Timestamps sao TEXT em RFC 3339 (UTC). Booleanos sao INTEGER
(0/1). Definem-se `PRAGMA foreign_keys = ON` e `journal_mode = WAL`.

As migrations sao versionadas na tabela `schema_migrations` (coluna `version`, `applied_at`).
O acesso e feito por uma interface de repositorio em `internal/store`, permitindo uma
implementacao Postgres no futuro.

## Entry

Representa um audio enviado e seu ciclo de vida.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | ULID |
| title | TEXT | opcional; editavel |
| status | TEXT | estado da maquina de estados |
| source | TEXT | `upload`, `telegram` |
| original_filename | TEXT | nome enviado |
| content_type | TEXT | MIME do original |
| size_bytes | INTEGER | tamanho do ciphertext |
| duration_seconds | REAL | medido com ffprobe |
| sha256 | TEXT | SHA-256 do conteudo em claro |
| recorded_at | TEXT | data do evento (pode diferir da criacao) |
| created_at | TEXT | |
| updated_at | TEXT | |
| deleted_at | TEXT | remocao logica |

Indices: `status`, `recorded_at`, `created_at`, `deleted_at`.

## Attachment

Objetos binarios associados a uma entrada. Distingue o original dos derivados.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| entry_id | TEXT FK -> Entry.id | |
| kind | TEXT | `original` ou `derived_16k` |
| storage_key | TEXT | caminho relativo no diretorio de dados |
| content_type | TEXT | |
| size_bytes | INTEGER | tamanho do ciphertext |
| sha256 | TEXT | hash do conteudo em claro |
| cipher | TEXT | `aes-256-gcm` |
| cipher_nonce | BLOB | nonce por objeto |
| cache_key | TEXT | chave do derivado (por exemplo `16k:trim=off:v1`) |
| created_at | TEXT | |

Indices: `entry_id`, (`entry_id`, `kind`), (`entry_id`, `cache_key`).

O derivado 16 kHz mono e cacheado cifrado. A `cache_key` incorpora a versao da configuracao
de transcricao (por exemplo, se o corte de silencio esta ligado). Mudar `trim_silence` muda
a `cache_key`, invalidando o cache de fato.

## Transcript

Transcricao de uma entrada, versionada por modelo/parametros.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| entry_id | TEXT FK -> Entry.id | |
| model | TEXT | modelo ggml usado |
| language | TEXT | idioma detectado/forcado |
| text | TEXT | texto integral concatenado |
| trim_silence | INTEGER | 0/1 no momento da transcricao |
| duration_seconds | REAL | duracao do audio derivado |
| created_at | TEXT | |

Indices: `entry_id`, (`entry_id`, `model`), unico parcial pela combinacao ativa.

## Segment

Segmentos de transcricao com marcas de tempo referentes ao audio ORIGINAL.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| transcript_id | TEXT FK -> Transcript.id | |
| idx | INTEGER | ordem |
| start_ms | INTEGER | inicio no audio original |
| end_ms | INTEGER | fim no audio original |
| text | TEXT | |
| speaker | TEXT | opcional (reservado) |
| created_at | TEXT | |

Indices: `transcript_id`, (`transcript_id`, `idx`).

Quando o corte de silencio esta ligado, os tempos sao remapeados para o audio original, de
modo que os segmentos sempre referenciam a linha do tempo completa.

## Analysis

Resultado do enriquecimento por IA, versionado por modelo.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| entry_id | TEXT FK -> Entry.id | |
| model | TEXT | modelo de analise |
| sentiment | REAL | escala de -1 a 1 |
| sentiment_label | TEXT | positivo, neutro ou negativo |
| emotions | TEXT | JSON legado: rotulos e intensidades |
| people | TEXT | JSON legado: pessoas mencionadas |
| places | TEXT | JSON legado: lugares mencionados |
| summary | TEXT | resumo curto |
| raw | TEXT | resposta bruta do provedor |
| data | TEXT | JSON completo da analise rica |
| created_at | TEXT | |

Indices: `entry_id`, (`entry_id`, `model`).

`data` guarda o resultado rico (sentimento com rotulo, emocoes com intensidade, pessoas com
contagem/relacao/sentimento, lugares, temas, momentos-chave com tempo, resumo, perguntas e
decisoes). As colunas `emotions`, `people` e `places` mantem o formato legado (mapa e listas
de nomes) para compatibilidade com entradas antigas e com o dashboard enquanto ele nao usa
apenas `data`.

## Entity

Pessoa, lugar ou tema extraido das analises, normalizado por (`kind`, `name`).

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| kind | TEXT | person, place ou theme |
| name | TEXT | nome como exibido |
| created_at | TEXT | |

Indices: unico (`kind`, `name`).

## EntryEntity

Relaciona uma entrada a uma entidade, com contagem de mencoes e metadados por entrada.

| Campo | Tipo | Notas |
|---|---|---|
| entry_id | TEXT FK -> Entry.id | chave primaria composta com entity_id |
| entity_id | TEXT FK -> Entity.id | |
| count | INTEGER | numero de mencoes na entrada |
| relation | TEXT | relacao com o autor (pessoas), opcional |
| sentiment | REAL | sentimento associado (pessoas), opcional |
| created_at | TEXT | |

Indices: `entity_id`. Ao salvar uma nova analise, os vinculos anteriores da entrada sao
substituidos.

## AudioMetrics

Medicoes de audio (ffmpeg/ffprobe) por entrada. O audio original nunca e alterado.

| Campo | Tipo | Notas |
|---|---|---|
| entry_id | TEXT PK FK -> Entry.id | |
| duration_ms | INTEGER | duracao |
| loudness_lufs | REAL | loudness integrado (EBU R128) |
| true_peak | REAL | true peak |
| silence_count | INTEGER | numero de intervalos de silencio |
| silence_total_ms | INTEGER | total de silencio |
| sample_rate | INTEGER | do original |
| channels | INTEGER | do original |
| created_at | TEXT | |

Indices: chave primaria em `entry_id`.

## Note

Notas livres por entrada, no formato do editor BlockNote (JSON).

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| entry_id | TEXT FK -> Entry.id | |
| title | TEXT | opcional |
| document | TEXT | JSON do BlockNote |
| created_at | TEXT | |
| updated_at | TEXT | |

Indices: `entry_id`.

## NoteRevision

Historico de uma nota a cada atualizacao.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| note_id | TEXT FK -> Note.id | |
| document | TEXT | JSON anterior |
| created_at | TEXT | |
| author | TEXT | reservado |

Indices: `note_id`, (`note_id`, `created_at`).

## Tag

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| name | TEXT | unico |
| color | TEXT | opcional |
| created_at | TEXT | |

Indices: unico em `name`.

## EntryTag

Juncao N:N entre entradas e tags.

| Campo | Tipo | Notas |
|---|---|---|
| entry_id | TEXT FK -> Entry.id | |
| tag_id | TEXT FK -> Tag.id | |
| created_at | TEXT | |

Chave primaria composta: (`entry_id`, `tag_id`). Indices: `tag_id`.

## Link

Relacoes entre entradas ou com URLs externas.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| from_entry_id | TEXT FK -> Entry.id | |
| to_entry_id | TEXT FK -> Entry.id | nulo se for URL |
| url | TEXT | nulo se for entrada |
| label | TEXT | opcional |
| created_at | TEXT | |

Indices: `from_entry_id`, `to_entry_id`.

## Job

Fila de trabalho com leases e retries.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| type | TEXT | `transcribe`, `analyze`, `cleanup` |
| idempotency_key | TEXT | unico |
| payload | TEXT | JSON |
| status | TEXT | `queued`, `leased`, `running`, `done`, `failed`, `retrying`, `dead` |
| attempts | INTEGER | |
| max_attempts | INTEGER | |
| available_at | TEXT | para backoff |
| lease_expires_at | TEXT | |
| worker_id | TEXT | detentor do lease |
| last_error | TEXT | |
| created_at | TEXT | |
| updated_at | TEXT | |

Indices: `status`, `available_at`, unico em `idempotency_key`, (`status`, `available_at`).

## Upload

Estado do upload resumivel.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| status | TEXT | `open`, `completed`, `expired` |
| filename | TEXT | |
| content_type | TEXT | |
| size_bytes | INTEGER | esperado |
| sha256 | TEXT | esperado |
| received_bytes | INTEGER | confirmado |
| storage_key | TEXT | ciphertext em construcao |
| prefix | BLOB | prefixo de nonce da cifra em streaming |
| next_counter | INTEGER | proximo contador de nonce |
| created_at | TEXT | |
| expires_at | TEXT | |

Indices: `status`, `expires_at`.

## Settings

Configuracoes editaveis em tempo de execucao (chave/valor).

| Campo | Tipo | Notas |
|---|---|---|
| key | TEXT PK | por exemplo `trim_silence` |
| value | TEXT | valor serializado |
| updated_at | TEXT | |

Valores iniciais vem de variaveis de ambiente (`DIARY_TRIM_SILENCE`, modelo de transcricao,
modo de analise). A tela de configuracao consome `GET/PUT /api/v1/settings`.
