# dyarium

[![CI](https://github.com/jose-guilherme93/dyarium/actions/workflows/ci.yml/badge.svg)](https://github.com/jose-guilherme93/dyarium/actions/workflows/ci.yml)
[![Release](https://github.com/jose-guilherme93/dyarium/actions/workflows/release.yml/badge.svg)](https://github.com/jose-guilherme93/dyarium/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Diario falado self-hosted e de codigo aberto. Voce grava notas de voz, o
dyarium guarda o audio original cifrado, transcreve localmente com whisper.cpp,
enriquece com analises opcionais e mostra tudo num dashboard privado.

Um container para o app, um banco SQLite, um diretorio de dados. A analise
local pode rodar no mesmo processo (llama.cpp embutido) ou num servico Ollama
ao lado, ambos sem chave e sem mandar texto para fora. Sem conta, sem nuvem de
terceiros e sem variavel de ambiente obrigatoria para subir.

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
    image: ghcr.io/jose-guilherme93/dyarium:${DIARY_VERSION:-latest}
    container_name: dyarium
    restart: unless-stopped
    pull_policy: always
    ports:
      - "${DIARY_PORT:-8080}:8080"
    volumes:
      - dyarium-data:/data
      - dyarium-models:/models
    environment:
      DIARY_LOG_LEVEL: ${DIARY_LOG_LEVEL:-info}
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8080/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

  # Analise local sem chave. Sobe junto com o dyarium para o botao de um
  # clique funcionar; o modelo so e carregado quando a analise roda.
  # Em VPS de 1 GB, suba apenas o dyarium: `docker compose up -d dyarium`.
  ollama:
    image: ollama/ollama
    restart: unless-stopped
    cpus: "2"
    mem_limit: 900m
    environment:
      OLLAMA_MAX_LOADED_MODELS: "1"
      OLLAMA_NUM_PARALLEL: "1"
      OLLAMA_KEEP_ALIVE: "5m"
    volumes:
      - ollama-models:/root/.ollama

volumes:
  dyarium-data:
  dyarium-models:
  ollama-models:
```

Salve como `docker-compose.yml` e rode:

```
docker compose up -d
```

Esse comando sobe o dyarium e o Ollama. Para subir so o app (por exemplo, numa
VPS de 1 GB ou quando a analise roda no aparelho), use
`docker compose up -d dyarium`.

Para fixar uma versao em vez de acompanhar a `latest`, defina
`DIARY_VERSION=vX.Y.Z`. A porta publicada pode ser trocada com `DIARY_PORT`.

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

Em VPS de 1 GB, defina `DIARY_WHISPER_MODEL=/models/ggml-tiny.bin` antes do
primeiro boot para nao baixar o `small-q5_1`.

## Analise local

Duas opcoes, escolhidas em **Configuracao > Analise por IA**:

- **Ollama local**: sobe junto com o compose. O botao baixa o `qwen2.5:0.5b` e
  configura a analise. O servico ocioso usa ~150-250 MB e o modelo ~600 MB
  durante a geracao; ele sai da memoria depois de 5 minutos parado.
- **llama.cpp embutido**: o `llama-server` ja vem na imagem. O botao baixa o
  GGUF do Qwen2.5 0.5B (~469 MB) e o processo so existe durante a analise,
  sendo liberado por inatividade. Nao precisa de servico extra no compose.

As duas opcoes sao offline depois do download inicial: o texto da nota nao sai
do servidor. A transcricao comeca depois de liberar o modelo de linguagem, para
os dois nao ficarem residentes juntos.

**Memoria**: 2 GB de RAM e o minimo realista para transcrever e analisar no mesmo
servidor, usando `base` ou `tiny` na transcricao (`small-q5_1` pede mais folga).
Com 1 GB, use apenas transcricao (modelo `tiny`, ~75 MB) e deixe a analise no
aparelho, que ja roda llama.rn, ou num provedor hospedado. O botao baixa o
modelo quando falta e recusa o runtime embutido quando o binario nao esta na
imagem.

## Modulos opcionais

- **Analise por IA**: desligada por padrao. Ativada, aponta para qualquer API
  compativel com OpenAI (Ollama local, llama.cpp embutido ou provedor hospedado)
  e produz sentimento, emocoes, pessoas, lugares e resumo. Sem ela, transcricao
  e metricas continuam.
- **Backup com Litestream**: replica o SQLite para um bucket S3.
- **Telegram**: recebe audios pelo bot e cria entradas.

A analise continua desligada ate o usuario ativar. O servico Ollama sobe com o
compose para o botao de um clique funcionar, mas nao carrega modelo enquanto
ninguem analisa. Litestream e Telegram so iniciam quando ligados. As variaveis
estao em `.env.example`.

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
| `DIARY_OLLAMA_URL` | `http://ollama:11434` | Servico Ollama local usado pelo botao |
| `DIARY_OLLAMA_MODEL` | `qwen2.5:0.5b` | Modelo baixado pelo botao Ollama |
| `DIARY_LLAMA_SERVER_BIN` | `llama-server` | Binario do runtime embutido |
| `DIARY_LLAMA_IDLE_SECONDS` | `300` | Tempo ocioso antes de liberar o modelo embutido |
| `DIARY_MAX_UPLOAD_BYTES` | 2147483648 | Tamanho maximo de upload |
| `DIARY_MAX_DURATION_SECONDS` | 3000 | Duracao maxima (50 min) |
| `DIARY_DELETED_RETENTION_HOURS` | 168 | Quanto tempo uma nota apagada fica recuperavel (lixeira) antes da limpeza |
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

`make dev` sobe `api`, `web` e `ollama` e compila o whisper.cpp, mas **nao**
compila o llama.cpp: o runtime embutido fica indisponivel nessa imagem e o
Ollama funciona normalmente. Para testar o llama.cpp embutido:

```
make dev-llama
```

Esse alvo compila o llama.cpp com `BUILD_JOBS=2` (ajustavel). A imagem de
producao (`make build`, e o CI) inclui o llama.cpp; `PROD_WITH_LLAMA=0` gera
uma imagem sem ele, com o provedor embutido desabilitado de forma limpa.

Em VPS pequena, o build de producao limita cada container com
`BUILD_MEMORY=3g` por padrao. A primeira construcao ainda compila whisper.cpp
e llama.cpp; nas seguintes o cache do Docker reaproveita esses estagios.

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
