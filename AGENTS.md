# AGENTS.md

Regras para agentes (humanos ou IA) que trabalham neste repositorio. Leia isto
antes de qualquer mudanca. Em caso de conflito, estas regras vencem.

O projeto tem tres superficies: o binario Go (`cmd/`, `internal/`), o dashboard
(`web/`) e o app de captura (`mobile/`). A documentacao de referencia fica em
`docs/`.

## Como trabalhar

- **Toda tarefa comeca em um worktree proprio**, fora do checkout principal:
  ```
  /home/joseti/projects/dyarium.worktrees/<slug>
  ```
  Criado com `git worktree add -b <tipo>/<slug> <caminho>` a partir de `main`.
- **Nunca trabalhe no checkout principal** (`/home/joseti/projects/dyarium`)
  nem mexa nos outros worktrees. Um worktree por tarefa.
- Antes de mudar algo, leia `docs/` e os arquivos envolvidos. Trate mudancas nao
  commitadas que voce nao criou como trabalho de terceiros: investigue, nao apague.
- **Nunca faca commit, push ou rebase sem pedido explicito.** Quando pedido, use
  commits pequenos e conventional commits com descricao em pt-BR.
- Nunca use `git add -A`/`git add .` as cegas; revise o que vai entrar.
- Nao edite codigo gerado (`web/dist/`, `web/node_modules/`, migrations ja
  aplicadas, `models/`). Migrations sao append-only.

## Versoes e releases

- A versao do produto e unica e segue semver, comecando em `0.1.0`. So chega a
  `1.0.0` quando o mantenedor decidir; ate la, uma mudanca de quebra sobe a
  minor, nao a major.
- A versao e calculada automaticamente pelo release-please a partir dos commits
  convencionais. **Nao edite a mao** `version.txt`, `web/package.json`,
  `mobile/package.json` nem `mobile/app.json`: o bot atualiza todos de uma vez.
- Efeito dos tipos: `fix` sobe patch; `feat` sobe minor;
  `feat!`/`BREAKING CHANGE` sobe minor enquanto estivermos em `0.x`;
  `chore`, `docs`, `test`, `ci`, `refactor` e `perf` nao mudam a versao.
- Ao mesclar na `main`, o release-please abre um PR de release; ao mesclar esse
  PR, cria o tag `vX.Y.Z` e o `CHANGELOG.md`, e a imagem e publicada no GHCR
  (`ghcr.io/jose-guilherme93/dyarium`) com as tags `vX.Y.Z` e `latest`.
- O binario recebe a versao do tag por `-ldflags`; nao existe versao embutida a
  atualizar no Go.

## Empacotamento e deploy

- `deploy/Dockerfile` produz a imagem de producao; o `docker-compose.yml` da
  raiz e o deploy padrao (tambem usado pelo Dokploy).
- Toda configuracao nova precisa de um padrao seguro e **nao** pode exigir
  variavel de ambiente obrigatoria. O primeiro run tem que funcionar apenas com
  o volume de dados montado.

## Regras de seguranca (duras)

- **Segredo nenhum no repositorio.** Token, chave mestra, chaves S3, tokens de
  bot, dominios, IPs e nomes de tailnet reais ficam fora do codigo e dos testes.
  Tudo por variavel de ambiente; `.env.example` sem valores reais.
- **Segredos de runtime:** quando `DIARY_MASTER_KEY` e `DIARY_TOKEN` nao vem do
  ambiente, a chave mestra e o token sao gerados no primeiro boot e persistidos
  em `/data` (`master.key` e `token`, modo 0600). Nunca logue o valor; no maximo
  registre que o setup esta pendente.
- **Nunca logar segredo nem conteudo sensivel.** Nada de `Authorization`, token,
  corpos de requisicao, audio ou transcricao em log, mensagens de erro ou
  telemetria. Erro para o usuario e generico; detalhe so no log do servidor.
- **Autenticacao:** toda rota sob `/api/v1` passa por `requireAuth` (Bearer).
  As unicas rotas publicas sao `/healthz`, `GET /setup/state` e `POST /setup`.
  As duas de setup so respondem enquanto a instancia nao foi reivindicada e sao
  a unica excecao deliberada a esta regra. Nao crie outras.
- **Audio original e imutavel.** Nunca sobrescreva o objeto cifrado. Qualquer
  derivado (16 kHz mono, corte de silencio) e um artefato separado com cache key.
- **Nada de audio em claro no disco do servidor.** A cifra (AES-256-GCM) e em
  streaming; siga `internal/crypto`. Nunca reutilize nonce.
- **Valide todo input na fronteira:** tamanho, offset, sha256, formato (whitelist
  `DIARY_ALLOWED_FORMATS`), limites de upload e duracao. Nunca confie no cliente.
- **App movel:** o token vive em `expo-secure-store`, nunca em `AsyncStorage`,
  log ou URL. Habilite storage privado e desabilite backup adb
  (`android:allowBackup=false`) para nao vazar audio local. HTTP em claro so
  quando o usuario configurar um host explicito.
- Nenhum emoji em codigo, UI, log ou documentacao.

## Confianca de codigo (duras)

- Toda mudanca de comportamento vem com teste. Bug corrigido vem com teste que
  falhava antes.
- Teste comportamento externo, nao detalhe de implementacao. Prefira o seam mais
  alto possivel; poucos seams e melhor que muitos.
- Antes de concluir: `gofmt`, `go vet`, `eslint` limpos e a suite relevante verde.
- Mudanca de contrato de API atualiza `docs/api.md`. Mudanca de decisao de
  arquitetura atualiza `docs/arquitetura.md` ou `docs/plano.md`.
- Nao introduza dependencia nova sem justificar (tamanho, licenca, manutencao);
  prefira o que ja existe no projeto.
- Preserve estrutura, nomes e estilo do que ja existe. Identificadores em ingles,
  prosa em pt-BR.
- Nao silencie erro: trate, propague com contexto ou registre. Nunca `_ = err`
  sem motivo explicito.

## Limite de RAM (regra dura)

Esta VPS e pequena: **5.8 GiB de RAM total, tipicamente ~1.5 GiB livres**, com
swap lento. Estourar memoria derruba servicos. Velocidade importa menos que
estabilidade: testes podem demorar.

- **Uma tarefa pesada por vez.** Nunca rode em paralelo: `docker build`,
  `go build`/`go test`, `pnpm install`, bundler/Metro, `whisper-cli`,
  transcricao ou benchmark.
- Rode builds e testes pelos alvos do `Makefile` ou via `scripts/lowmem.sh`, que
  aplicam os tetos abaixo. Nao chame `go`/`pnpm` "cru" para tarefas pesadas.
- Tetos padrao (sobreponíveis por variavel de ambiente):
  - `GOMAXPROCS=2`, `GOGC=50`, `GOMEMLIMIT=768MiB`, `GOFLAGS=-p=1`
  - `NODE_OPTIONS=--max-old-space-size=1024`, `UV_THREADPOOL_SIZE=2`
- `go test -p 1 -parallel 2 ./...` (nunca paralelismo amplo).
- Vitest/Jest com `maxWorkers=1`; Metro com `--max-workers=2`.
- Se um comando estourar memoria: nao repita igual. Reduza paralelismo, rode em
  partes, ou pare o que estiver concorrendo.
- Nao suba `docker compose` de desenvolvimento junto com testes. Derube com
  `make down` antes de rodar a suite pesada.

## Comandos

```
make test        # go test + testes do web (serializados, com tetos de RAM)
make lint        # go vet, gofmt e eslint
make dev         # containers de desenvolvimento (derube antes de testar)
make build       # imagem de producao (nao rode junto com testes)
make mobile-dev  # app Expo em desenvolvimento (development build)
make mobile-test # testes do app (Jest + Maestro)
```

Testes do Go que dependem de `whisper-cli`/`ffmpeg` ficam atras de build tag ou
skip quando o binario nao existe; nao torne a suite dependente de binario pesado.
