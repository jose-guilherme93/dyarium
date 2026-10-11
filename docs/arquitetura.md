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
- Chave mestra por variavel de ambiente: simples e suficiente para self-hosting. A chave
  nao entra no repositorio nem no banco.
- Analise por HTTP compativel com OpenAI: funciona com Ollama local ou qualquer provedor,
  e pode ser desligada sem afetar transcricao e metricas.
- Frontend embutido via `go:embed`: um unico artefato para distribuir.
- SSE para atualizacoes: unidirecional, simples, funciona atras do proxy de desenvolvimento.

## Limites e configuracoes relevantes

- Duracao maxima de audio: 50 minutos (configuravel por ambiente).
- Tamanho maximo de upload: configuravel por ambiente.
- Formatos aceitos: wav, mp3, m4a, ogg, flac, aac, adts (configuravel).
- Concorrencia de workers: padrao 1, dado o pico de memoria do whisper.
- Corte de silencio na transcricao: booleano em `Settings`, desligado por padrao.
