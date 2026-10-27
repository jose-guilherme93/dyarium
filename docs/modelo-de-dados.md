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
| source | TEXT | `upload`, `telegram`, `share`, `text` |
| parent_id | TEXT FK -> Entry.id | subnota (desativada; ver nota abaixo) |
| notebook_id | TEXT FK -> Notebook.id | caderno; obrigatorio na pratica |
| archived | INTEGER | fora da lista de trabalho, sem apagar |
| original_filename | TEXT | nome enviado |
| content_type | TEXT | MIME do original |
| size_bytes | INTEGER | tamanho do ciphertext |
| duration_seconds | REAL | medido com ffprobe |
| sha256 | TEXT | SHA-256 do conteudo em claro |
| recorded_at | TEXT | data do evento (pode diferir da criacao) |
| created_at | TEXT | |
| updated_at | TEXT | ultima edicao de conteudo/metadados; abrir a nota e mudar so o status nao alteram |
| deleted_at | TEXT | remocao logica |

Indices: `status`, `recorded_at`, `created_at`, `deleted_at`, `notebook_id`.

`parent_id` existia para a arvore de subnotas. Com cadernos e tags, subnotas
deixaram de ser necessarias: o web nao cria mais subnotas e a lista e plana. Os
dados existentes continuam no banco; a remocao da coluna fica para depois.

## Notebook

Colecao de notas. Toda nota pertence a exatamente um caderno.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | o padrao usa `notas-ao-acaso` |
| name | TEXT | unico (case-sensitive no banco; API compara sem caixa) |
| color | TEXT | opcional; vazio = neutro |
| is_default | INTEGER | 1 no caderno "Notas ao acaso" |
| created_at | TEXT | |
| updated_at | TEXT | |

Indices: unico em `name`; unico parcial em `is_default` quando 1. O caderno
padrao e criado pela migracao 0017 e nao pode ser renomeado nem excluido.

## Attachment

Objetos binarios associados a uma entrada: os audios (kind `original`), as imagens
(kind `image`) e os derivados (kind `derived_16k`). Uma nota pode ter varios audios, cada
um um anexo `original`.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| entry_id | TEXT FK -> Entry.id | |
| kind | TEXT | `original` (audio), `derived_16k` ou `image` |
| storage_key | TEXT | caminho relativo no diretorio de dados |
| content_type | TEXT | |
| size_bytes | INTEGER | tamanho do ciphertext |
| sha256 | TEXT | hash do conteudo em claro |
| cipher | TEXT | `aes-256-gcm` |
| cipher_nonce | BLOB | nonce por objeto |
| cache_key | TEXT | chave do derivado (por exemplo `16k:<audio>:v1`) |
| duration_seconds | REAL | duracao do audio (0 em imagens e derivados) |
| created_at | TEXT | |

Indices: `entry_id`, (`entry_id`, `kind`), (`entry_id`, `cache_key`).

O derivado 16 kHz mono e cacheado cifrado por audio; a `cache_key` inclui o id do audio
(`16k:<audio>:v1`). Ligar ou desligar o corte de silencio nao muda a `cache_key`, pois o
derivado nao depende disso (apenas muda quais trechos sao transcritos).

## Transcript

Transcricao de um audio de uma entrada, versionada por modelo/parametros.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| entry_id | TEXT FK -> Entry.id | |
| attachment_id | TEXT FK -> Attachment.id | audio transcrito |
| model | TEXT | modelo ggml usado |
| language | TEXT | idioma detectado/forcado |
| text | TEXT | texto integral do whisper, nunca sobrescrito |
| trim_silence | INTEGER | 0/1 no momento da transcricao |
| duration_seconds | REAL | duracao do audio derivado |
| revised_text | TEXT | juncao do derivado; vazio quando nao ha revisao |
| revised_model | TEXT | modelo que revisou |
| revised_prompt_version | INTEGER | versao do prompt/regras |
| revised_literal | INTEGER | 0/1: revisao no modo literal |
| revised_comprehension | INTEGER | 0-100; -1 quando nao medida |
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
| text | TEXT | original do whisper |
| speaker | TEXT | opcional (reservado) |
| user_edited | INTEGER | 0/1: trecho escrito a mao; a revisao nunca toca |
| created_at | TEXT | |

Indices: `transcript_id`, (`transcript_id`, `idx`).

## TranscriptRevision

Revisao por IA de um segmento, guardada ao lado do original (nunca no lugar dele).

| Campo | Tipo | Notas |
|---|---|---|
| segment_id | TEXT PK FK -> Segment.id | um derivado por trecho |
| transcript_id | TEXT FK -> Transcript.id | |
| text | TEXT | texto revisado (pode ser igual ao original) |
| model | TEXT | |
| prompt_version | INTEGER | chave de cache da revisao |
| literal | INTEGER | 0/1 |
| created_at | TEXT | |

Indices: `transcript_id`. Um trecho sem linha aqui nao foi revisado (ou foi escrito a mao).

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
| comprehension | INTEGER | compreensao logica 0-100; -1 quando nao medida |
| comprehension_source | TEXT | review (passada de revisao) ou analysis |
| stutter_rate | REAL | gagueira por 100 palavras do texto cru |
| hesitation_rate | REAL | hesitacao por 100 palavras do texto cru |
| revised_segments | INTEGER | quantos trechos a revisao mudou |
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

Corpo da entrada, canonico em markdown. O documento e uma lista ordenada de nos
de texto, imagem e audio; o markdown traz marcadores explicitos para os nos nao
textuais:

```
texto antes
![foto](attachment:abc){w=50}
texto no meio
!audio[attachment:xyz]{d=12.5}
texto depois
```

`local:<arquivo>` identifica um anexo que ainda esta so no aparelho; depois do
sync vira `attachment:<id>`. `{w=N}` e a largura da imagem em percentual da nota
e `{d=N}` e a duracao do audio em segundos. O parser/serializer do app fica em
`mobile/src/core/noteDocument`; o dashboard le o mesmo markdown e mostra imagem e
audio como blocos na posicao dos marcadores, preservando-os ao salvar.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| entry_id | TEXT FK -> Entry.id | |
| title | TEXT | opcional |
| document | TEXT | legado do BlockNote (vazio nas notas novas) |
| content_markdown | TEXT | corpo canonico em markdown |
| body_updated_at | TEXT | versao do corpo para conflito |
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
| color | TEXT | pastel; gerado da paleta quando vazio |
| created_at | TEXT | |

Indices: unico em `name`. Renomear para um nome existente mescla as tags
(move `EntryTag` e apaga a antiga); excluir remove as associacoes.

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

## AnalysisRun

Uma tentativa de analise, no servidor ou no app (o app tem a mesma tabela no
SQLite local, sem as FKs). Append-only: guarda medidas e resultado, nunca texto,
transcricao ou audio.

| Campo | Tipo | Notas |
|---|---|---|
| id | TEXT PK | |
| entry_id | TEXT FK -> Entry.id | `ON DELETE CASCADE` |
| analysis_id | TEXT FK -> Analysis.id | nulo em falha; `ON DELETE SET NULL` |
| attachment_id | TEXT | audio quando aplicavel; sem FK |
| runtime | TEXT | `server` ou `local` |
| provider | TEXT | `openai`, `opencode`, `llama.cpp`, `lexical` |
| model | TEXT | id do modelo; `local-fallback` na leitura simplificada |
| attempt | INTEGER | 1-based; 0 no fallback |
| outcome | TEXT | `ok`, `invalid_json`, `error`, `stopped`, `fallback` |
| error_class | TEXT | classe generica, sem conteudo |
| started_at | TEXT | |
| finished_at | TEXT | |
| duration_ms | INTEGER | |
| input_text_chars | INTEGER | texto escrito |
| input_transcript_chars | INTEGER | fala transcrita |
| input_images | INTEGER | |
| prompt_tokens | INTEGER | |
| completion_tokens | INTEGER | |
| tokens_per_second | REAL | sobre a duracao total |
| threads | INTEGER | so local |
| battery_delta_pct | REAL | so local; estimativa |
| created_at | TEXT | |

Indices: `started_at`, (`runtime`, `provider`, `model`), `entry_id`.

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
| title | TEXT | titulo proposto para a nota |
| recorded_at | TEXT | data do evento |
| entry_created_at | TEXT | criacao/importacao original; vira `Entry.created_at` uma vez |
| entry_source | TEXT | origem da nota (`upload`, `share`, `microphone`, `text`, `telegram`) |
| client_key | TEXT | idempotencia da criacao do upload |
| entry_id | TEXT FK -> Entry.id | quando o audio vai para uma nota existente |
| received_bytes | INTEGER | confirmado |
| storage_key | TEXT | ciphertext em construcao |
| prefix | BLOB | prefixo de nonce da cifra em streaming |
| next_counter | INTEGER | proximo contador de nonce |
| created_at | TEXT | hora em que o upload comecou |
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
