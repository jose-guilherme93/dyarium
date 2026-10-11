# dyarium mobile

App Android de captura do dyarium (React Native + Expo). Grava notas de voz com
a tela bloqueada, guarda local, enfileira e envia para o servidor self-hosted.

## O que ele faz

- Grava em **AAC ADTS** (48 kHz mono ~128 kbps), em **segmentos de 60 s**, com
  foreground service do `expo-audio` (continua gravando com a tela bloqueada).
- Concatena os segmentos e enfileira automaticamente ao parar.
- Envia por upload resumivel e **idempotente** (`client_key` por gravacao).
- **Importa audios compartilhados** por outros apps (share sheet do Android): ate 5 por
  vez, com tela de revisao (titulo, data em DD/MM/AAAA em 24h ou AM/PM, formato, duracao e
  playback) antes de enviar. O audio original e preservado; reimportar o mesmo conteudo nao
  duplica a entrada (dedupe por SHA-256 no servidor).
- A biblioteca organiza as notas **por ano** (mais novo no topo), pela data do evento, para
  que notas antigas importadas apareçam no ano a que pertencem.
- Biblioteca local com estado, reproducao, retry e apagar.
- Tela de recuperacao para gravacao interrompida (Enviar / Descartar / Continuar).

## Rodar no celular (Tailscale)

O jeito mais rapido de iterar na interface e o Metro via Tailscale:

```
make mobile-dev
```

O alvo detecta o IP da tailnet e sobe o Metro apontando para ele
(`REACT_NATIVE_PACKAGER_HOSTNAME`). No celular, com o Tailscale ativo, abra o
**Expo Go** e conecte ao endereco informado (`http://<ip-da-tailnet>:8081`).

Limite: no Expo Go o **foreground service nao roda**, entao a gravacao para
quando a tela bloqueia. Para o comportamento completo, use um development build.

## Development build (grava com a tela bloqueada)

O app usa config plugins nativos (`enableBackgroundRecording`), que exigem um
build proprio:

```
npx eas-cli@latest login
npx eas-cli@latest build --profile development --platform android
```

Instale o APK gerado no aparelho. O `eas.json` ja traz o perfil `development`.

## Servidor

Na tela inicial, toque em **Configurar** e informe a URL e o `DIARY_TOKEN`.
Sugestao: rode o dyarium nesta maquina (`make dev`) e use
`http://<ip-da-tailnet>:8080` como URL. O app valida `GET /healthz` e
`GET /api/v1/version` antes de salvar. O token fica no SecureStore.

## Comandos

```
pnpm install        # dependencias (respeite os tetos de RAM do AGENTS.md)
pnpm test           # Jest (nucleo puro: fila, uploader, concatenacao, titulo)
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
npx expo-doctor     # diagnostico de dependencias/config
```

Pelo repositorio: `make mobile-dev`, `make mobile-test`, `make mobile-lint`.

## Estrutura

```
src/core        nucleo puro e testavel (sem imports nativos)
src/services    integracoes nativas (audio, filesystem, sqlite, secure store)
src/state       providers (config, biblioteca, gravacao)
src/components  UI
src/app         rotas (expo-router)
src/theme       tokens de design
```

O nucleo em `src/core` e a parte confiavel e testada: a maquina de estados da
fila, o uploader resumivel, a concatenacao de segmentos e a formatacao do titulo.
As telas e os servicos nativos ficam finos por cima.
