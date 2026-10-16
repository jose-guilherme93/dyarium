# dyarium

[![CI](https://github.com/jose-guilherme93/dyarium/actions/workflows/ci.yml/badge.svg)](https://github.com/jose-guilherme93/dyarium/actions/workflows/ci.yml)
[![Release](https://github.com/jose-guilherme93/dyarium/actions/workflows/release.yml/badge.svg)](https://github.com/jose-guilherme93/dyarium/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Diario falado self-hosted e de codigo aberto. Voce grava notas de voz, o
dyarium guarda o audio original cifrado, transcreve localmente com whisper.cpp,
enriquece com analises opcionais e mostra tudo num dashboard privado.

Um unico container. Um banco SQLite. Um diretorio de dados. Sem conta, sem
nuvem de terceiros e sem variavel de ambiente obrigatoria para subir.

## Por que

- **Privacidade por padrao**: transcricao local (whisper.cpp). Nada sai da sua
  maquina, a nao ser que voce ligue a analise por IA apontando para onde quiser.
- **Audio original imutavel**: o arquivo enviado nunca e alterado; derivados
  (16 kHz mono, corte de silencio) sao artefatos separados.
- **Cifrado em repouso**: AES-256-GCM em streaming, sem audio em claro no disco
  persistente.
- **Deploy trivial**: uma imagem multi-arch no GHCR, um `docker compose up -d`.

## Primeiro deploy

### Docker Compose

```yaml
services:
  dyarium:
    image: ghcr.io/jose-guilherme93/dyarium:latest
    container_name: dyarium
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - dyarium-data:/data
      - dyarium-models:/models
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8080/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

volumes:
  dyarium-data:
  dyarium-models:
```

Salve como `docker-compose.yml` e rode:

```
docker compose up -d
```

### Dokploy

1. Crie um novo projeto e adicione um servico do tipo **Compose**.
2. Cole o compose acima.
3. Em **Domains**, adicione um dominio apontando para a porta `8080` do
   servico.
4. Faca o deploy e abra o dominio.

Nao ha nada para configurar antes: a imagem nao exige variavel de ambiente.

## Primeiro acesso

Na primeira subida o servidor nao tem token ainda, entao ele abre uma tela de
primeiro acesso. Abra o endereco do servico, escolha um token e pronto. Esse
token passa a proteger o dashboard, a API e o app mobile.

Nesse mesmo primeiro boot o servidor gera e guarda a chave mestra em
`/data/master.key` e baixa em segundo plano o modelo de transcricao padrao
(`small-q5_1`, ~180 MB). Nada mais a fazer.

> Guarde o volume `/data`. Ele contem a chave mestra; sem ela os audios cifrados
> sao irrecuperaveis.

## Usar

- **Dashboard**: abra o endereco do servico e faca upload de um audio (wav, mp3,
  m4a, ogg, flac, aac), acompanhe a transcricao e leia notas e analises.
- **App Android**: o app de captura grava com a tela bloqueada, enfileira e
  envia sozinho. Veja `mobile/README.md`.

## Modelos de transcricao

O modelo padrao (`small-q5_1`) e baixado automaticamente. Para escolher outro,
use a tela de **Configuracao** do dashboard: `tiny`, `base`, `small-q5_1`,
`medium-q5_0` e `large-v3-q5_0`. Modelos maiores transcrevem melhor e consomem
mais memoria. Para nao baixar nada no primeiro boot, defina
`DIARY_AUTO_DOWNLOAD_MODEL=false`.

## Modulos opcionais

- **Analise por IA**: desligada por padrao. Ativada, aponta para qualquer API
  compativel com OpenAI (por exemplo, Ollama local) e produz sentimento,
  emocoes, pessoas, lugares e resumo. Sem ela, transcricao e metricas continuam.
- **Backup com Litestream**: replica o SQLite para um bucket S3.
- **Telegram**: recebe audios pelo bot e cria entradas.

Todos ficam desligados por padrao e nao iniciam nada quando desativados. As
variaveis estao em `.env.example`.

## Configuracao

Nenhuma variavel e obrigatoria. As principais:

| Variavel | Padrao | Descricao |
|---|---|---|
| `DIARY_HTTP_ADDR` | `:8080` | Endereco de escuta da API |
| `DIARY_TOKEN` | gerado no primeiro acesso | Token Bearer; define para pular o wizard |
| `DIARY_MASTER_KEY` | arquivo em `/data/master.key` | Chave AES-256 (hex ou base64) |
| `DIARY_AUTO_DOWNLOAD_MODEL` | `true` | Baixa o modelo padrao no primeiro boot |
| `DIARY_WHISPER_MODEL` | `models/ggml-small-q5_1.bin` | Modelo de transcricao |
| `DIARY_WHISPER_LANGUAGE` | vazio | Idioma (ex.: `pt`); vazio detecta sozinho |
| `DIARY_MAX_UPLOAD_BYTES` | 2147483648 | Tamanho maximo de upload |
| `DIARY_MAX_DURATION_SECONDS` | 3000 | Duracao maxima (50 min) |
| `DIARY_LOG_LEVEL` | `info` | `debug`, `info`, `warn` ou `error` |

A lista completa esta em `.env.example`. O compose de desenvolvimento fica em
`deploy/compose.dev.yml`.

## Arquitetura

Um binario Go (`cmd/`, `internal/`) com o dashboard React embutido via
`go:embed`. Acesso a dados atras de uma interface de repositorio (SQLite em WAL,
migrations versionadas). Operacoes pesadas (transcricao, ffmpeg, analise) rodam
como subprocesso. O app de captura e Expo/React Native. Detalhes em `docs/`.

## Desenvolvimento

```
cp .env.example .env
make dev
```

- Dashboard: http://localhost:5173
- API: http://localhost:8080

Para rodar os testes e o lint localmente:

```
make test
make lint
```

Mais detalhes em `CONTRIBUTING.md` e `AGENTS.md`.

## Manutencao

Notas que sao duplicatas do mesmo audio (de versoes anteriores) podem ser
mescladas por um comando: ele mantem a nota mais completa (transcricao, nota,
analise) e move os dados das outras para ela.

```
make dedupe DRY=1   # simulacao
make dedupe         # aplica
```

## Versoes

A versao segue semver e e calculada automaticamente a partir dos commits
convencionais (release-please). Enquanto o projeto esta em `0.x`, uma mudanca de
quebra sobe a minor, nao a major. Veja `CHANGELOG.md` e as releases.

## Licenca

MIT. Veja `LICENSE`.
