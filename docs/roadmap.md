# Roadmap

Cada fase termina com criterios de aceite verificaveis. O trabalho para ao final de cada
fase para revisao.

## Fase 1 - Documentacao

Entregaveis:
- `docs/plano.md`, `docs/arquitetura.md`, `docs/api.md`, `docs/modelo-de-dados.md`,
  `docs/transcricao.md`, `docs/dashboard.md`, `docs/roadmap.md`.

Criterios de aceite:
- Os sete documentos existem e sao coerentes entre si.
- Tudo em portugues (pt-BR); identificadores de codigo em ingles.
- Nenhum emoji e nenhum segredo, dominio ou IP real.
- Decisoes em aberto listadas explicitamente.
- Audio original tratado como imutavel em toda a documentacao.

## Fase 2 - Ambiente de desenvolvimento

Entregaveis:
- Estrutura de pacotes: `cmd/diary` (subcomandos `serve` e `version`),
  `internal/{api,ingest,jobs,transcribe,analyze,store,crypto,telegram}`.
- `web/` (React + Vite + TypeScript, BlockNote instalado, pagina inicial vazia).
- `deploy/Dockerfile` multi-stage e `deploy/compose.dev.yml` com hot reload (`air`) e Vite
  em modo dev com proxy para a API.
- `Makefile` com `dev`, `build`, `test`, `lint`, `bench-transcricao`, `down`, `clean`,
  `models` e `tailscale`.
- `README.md`, `.env.example`, `.gitignore`, `LICENSE` (MIT) e pipeline de CI.

Funcionalidades:
- `GET /healthz` retornando 200 com a versao.
- Migrations iniciais do SQLite aplicadas na subida.
- Autenticacao por token Bearer (`DIARY_TOKEN`).
- Pagina inicial do dashboard servida pelo binario, com o layout base
  (barra lateral, area central, painel recolhivel).
- Ao menos um teste automatizado no Go e um no frontend.

Criterios de aceite:
- `make dev` sobe sem erros e `curl localhost:8080/healthz` responde 200.
- `make build` gera a imagem local `diary:dev` sem erros.
- `make test` e `make lint` passam.
- Nenhum emoji no codigo, na interface ou na documentacao.
- O site de desenvolvimento acessivel em `localhost:5173` e, opcionalmente, na tailnet via
  `make tailscale`, sem qualquer dominio ou IP real no codigo.

## Fase 3 - Ingestao, criptografia, fila e transcricao

Entregaveis:
- Upload resumivel completo (`POST/PUT/GET /uploads`, `/complete`) com cifra em streaming.
- Migrations de todas as tabelas do modelo de dados.
- Fila de jobs com leases, heartbeat, backoff e idempotencia.
- Pipeline de transcricao com whisper-cli: derivado 16 kHz mono, chunking, checkpoints e
  remapeamento de marcas de tempo.
- Metricas de audio via ffmpeg/ffprobe.
- Benchmark `make bench-transcricao`.

Criterios de aceite:
- Um audio de 50 minutos pode ser enviado, retomado apos interrupcao e validado por SHA-256.
- Nenhum audio em claro e persistido no disco.
- A transcricao e retomavel (matar o worker no meio e reiniciar retoma sem reprocessar).
- O corte de silencio ligado/desligado preserva marcas de tempo corretas em relacao ao
  original.
- O benchmark imprime o pico de RSS para `small-q5_1` e `medium-q5_0`.

## Fase 4 - Analise, dashboard completo e integracoes

Entregaveis:
- Modulo de analise (sentimento, emocoes, pessoas, lugares, resumo) com base compativel com
  OpenAI/Ollama e desligavel.
- Dashboard completo: lista, entrada aberta (com editor BlockNote), painel de analise,
  humor, busca e configuracao.
- SSE (`/api/v1/events`) implementado e consumido pelo dashboard.
- Tags, notas e revisoes.
- Backup opcional com Litestream.
- Modulo Telegram opcional para envio de audio.

Criterios de aceite:
- Com a analise desligada, transcricao e metricas continuam funcionando.
- Ligando a analise com Ollama local, entradas recebem sentimento, emocoes, pessoas, lugares
  e resumo.
- O dashboard reflete mudancas de status em tempo real via SSE.
- Notas persistem com historico de revisoes.
- Com Litestream configurado, o banco e replicado; sem configuracao, nada e executado.
- Com o Telegram desligado (padrao), nenhum processo ou conexao relacionada e iniciada.
- Nenhum emoji e nenhum segredo/dominio/IP real em codigo, interface ou documentacao.
