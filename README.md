# dyarium

Diario falado self-hosted e de codigo aberto (licenca MIT). Voce envia audios de
ate 50 minutos; o dyarium guarda o original cifrado, transcreve localmente com
whisper.cpp, enriquece com analises opcionais e apresenta tudo num dashboard
privado.

O sistema e um unico binario Go com o dashboard embutido (`go:embed`). Nada de
segredos, dominios ou IPs reais no codigo: tudo vem de variaveis de ambiente.

## Requisitos

- Docker e Docker Compose (desenvolvimento e imagem de producao).
- Para rodar os alvos de teste e lint diretamente na maquina: Go 1.26 ou superior
  e pnpm.
- Opcional: Tailscale, para acompanhar o desenvolvimento pela tailnet.

## Desenvolvimento

```
cp .env.example .env
make dev
```

- Frontend (Vite, com recarga automatica): http://localhost:5173
- API (Go, com recarga automatica via air): http://localhost:8080
- Verificacao rapida: `curl localhost:8080/healthz`

Se as portas 8080 ou 5173 estiverem ocupadas, sobreponha-as:

```
make dev API_PORT=18080 WEB_PORT=15173
```

O Vite faz proxy de `/api` e `/healthz` para a API, entao basta abrir a porta
5173 no navegador.

### Acompanhar pela tailnet

```
make tailscale
tailscale serve status
```

O alvo usa o nome da maquina, sem hardcode. Para remover: `make tailscale-off`.

## Build de producao

```
make build
docker run --rm -p 8080:8080 \
  -e DIARY_TOKEN=seu-token \
  -e DIARY_MASTER_KEY=$(openssl rand -hex 32) \
  -v "$PWD/data:/data" -v "$PWD/models:/models" \
  diary:dev
```

A imagem compila o frontend, o binario Go e o whisper.cpp, e empacota ffmpeg. Os
modelos ggml ficam em um volume; baixe com `make models`.

## Testes e lint

```
make test        # go test ./... e pnpm -C web test
make lint        # go vet, gofmt e eslint
make bench-transcricao   # benchmark de transcricao (pico de RSS)
```

## Variaveis de ambiente

| Variavel | Padrao | Descricao |
|---|---|---|
| DIARY_HTTP_ADDR | :8080 | Endereco de escuta da API |
| DIARY_TOKEN | (obrigatorio) | Token do header Authorization: Bearer |
| DIARY_MASTER_KEY | (obrigatorio) | Chave AES-256 (32 bytes em hex ou base64) |
| DIARY_LOG_LEVEL | info | debug, info, warn ou error |
| DIARY_DB_PATH | data/diary.db | Caminho do banco SQLite |
| DIARY_DATA_DIR | data | Diretorio dos audios cifrados |
| DIARY_MODELS_DIR | models | Diretorio dos modelos ggml |
| DIARY_MODELS_BASE_URL | (registro do whisper.cpp) | URL base para baixar modelos |
| DIARY_WHISPER_BIN | whisper-cli | Binario do whisper.cpp |
| DIARY_WHISPER_MODEL | models/ggml-small-q5_1.bin | Modelo padrao |
| DIARY_WHISPER_LANGUAGE | (vazio) | Idioma da transcricao; vazio = auto (ex.: pt) |
| DIARY_FFMPEG_BIN | ffmpeg | Binario do ffmpeg |
| DIARY_FFPROBE_BIN | ffprobe | Binario do ffprobe |
| DIARY_TRIM_SILENCE | false | Valor inicial do corte de silencio |
| DIARY_WORKER_CONCURRENCY | 1 | Workers simultaneos |
| DIARY_JOB_LEASE_SECONDS | 120 | Prazo do lease de job |
| DIARY_MAX_UPLOAD_BYTES | 2147483648 | Tamanho maximo de upload |
| DIARY_MAX_DURATION_SECONDS | 3000 | Duracao maxima (50 min) |
| DIARY_ALLOWED_FORMATS | wav,mp3,m4a,ogg,flac,aac,adts | Formatos aceitos (inclui ADTS/AAC) |
| DIARY_MAX_WHISPER_RSS_MB | 0 | Teto de RAM (MB) do whisper; 0 = sem limite |
| DIARY_ANALYZE_ENABLED | false | Liga a analise por IA |
| DIARY_ANALYZE_BASE_URL | http://localhost:11434/v1 | Base compativel com OpenAI (Ollama) |
| DIARY_ANALYZE_API_KEY | (vazio) | Chave da API de analise |
| DIARY_ANALYZE_MODEL | (vazio) | Modelo da analise |
| DIARY_TELEGRAM_ENABLED | false | Liga o modulo Telegram |
| DIARY_TELEGRAM_BOT_TOKEN | (vazio) | Token do bot |
| DIARY_TELEGRAM_API_BASE | (vazio) | Base da API do Telegram (obrigatoria se habilitado) |
| DIARY_LITESTREAM_ENABLED | false | Liga o backup com Litestream |
| DIARY_LITESTREAM_BUCKET | (vazio) | Bucket S3 de destino |
| DIARY_LITESTREAM_PATH | dyarium | Prefixo dentro do bucket |
| DIARY_LITESTREAM_ENDPOINT | (vazio) | Endpoint S3 (para provedores compativeis) |
| DIARY_LITESTREAM_ACCESS_KEY_ID | (vazio) | Chave de acesso S3 |
| DIARY_LITESTREAM_SECRET_ACCESS_KEY | (vazio) | Segredo S3 |

## Modulos opcionais

- Analise por IA: desligada por padrao. Com `DIARY_ANALYZE_ENABLED=true` e um servidor
  compativel com OpenAI (por exemplo, Ollama em `http://localhost:11434/v1`), as entradas
  recebem sentimento, emocoes, pessoas, lugares e resumo. Sem a analise, transcricao e
  metricas continuam funcionando.
- Litestream: quando `DIARY_LITESTREAM_ENABLED=true` e um bucket S3 configurado, o
  `entrypoint.sh` inicia a replicacao continua e executa o servidor sob o Litestream. Sem
  essa configuracao, nada relacionado ao Litestream e executado.
- Telegram: desligado por padrao. Com `DIARY_TELEGRAM_ENABLED=true`, o bot baixa audios
  recebidos e os ingere como novas entradas. Desligado, nenhuma conexao e iniciada.

## API

A API fica sob `/api/v1` e exige `Authorization: Bearer <token>`. O upload e resumivel:
`POST /uploads` (metadados e SHA-256), `PUT /uploads/{id}` (header `X-Upload-Offset`),
`GET /uploads/{id}` (retomar) e `POST /uploads/{id}/complete`. Ha endpoints de entradas,
transcricao, analise, notas, tags, configuracoes e um fluxo de eventos SSE em
`/api/v1/events` (o token pode ir na query `?token=`, pois o EventSource nao envia headers).

## Estrutura

```
cmd/diary            entrypoint (serve, version)
internal/api         HTTP, auth Bearer, dashboard embutido
internal/ingest      upload resumivel e integridade
internal/jobs        fila de jobs (leases, backoff, idempotencia)
internal/transcribe  whisper.cpp (chunking, checkpoints)
internal/analyze     analise por IA (OpenAI/Ollama)
internal/store       repositorio SQLite (WAL, migrations)
internal/crypto      AES-256-GCM em streaming
internal/telegram    modulo opcional (stub)
web                  dashboard React + Vite + TypeScript (BlockNote)
deploy               Dockerfile e compose de desenvolvimento
docs                 plano, arquitetura, api, modelo de dados, transcricao, dashboard, roadmap
```

## Licenca

MIT. Veja `LICENSE`.
