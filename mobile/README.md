# dyarium mobile

App Android de captura do dyarium (React Native + Expo). E um app de **notas de
audio e de texto**: grava notas de voz com a tela bloqueada, escreve notas de
texto, guarda local, enfileira e envia para o servidor self-hosted.

## O que ele faz

- Tela inicial com as notas em **lista separada por ano** (mais novo no topo),
  botao **+** para criar uma nota e **Opcoes** (engrenagem). Notas de texto nao
  mostram player; as de audio mostram. Nota sincronizada aparece com um **icone de
  nuvem**. Cada card tem um menu de **tres pontinhos** (arquivar/apagar) e da para
  **arrastar para o lado** para apagar ou arquivar (configuravel nas Opcoes).
- **Tela da nota** (`/note/[id]`): sempre editavel (titulo e texto), com
  **autosave** (sem botao de salvar), **editor rico** (negrito, italico, lista
  renderizados de verdade via WebView), **contador de palavras** e **gravacao de
  audio** dentro da nota. Enter no titulo desce para o corpo. Nota so de texto e
  enviada como conteudo textual; com audio, o audio sobe e o texto vai junto. Ao
  sair, a nota e enviada (rascunho com conteudo) ou sincronizada (nota ja enviada).
  O editor rico exige o `react-native-webview` (novo development build); ate o
  rebuild, cai para um editor simples com marcadores.
- Grava em **AAC ADTS** (48 kHz mono ~128 kbps), em **segmentos de 60 s**, com
  foreground service do `expo-audio` (continua gravando com a tela bloqueada).
- Concatena os segmentos e enfileira automaticamente ao parar.
- Envia por upload resumivel e **idempotente** (`client_key` por gravacao).
- **Importa audios compartilhados** por outros apps (share sheet do Android): ate 50 por
  vez, com tela de revisao (titulo, **ano** e **ordem dia/mes** do lote, data em DD/MM/AAAA
  em 24h ou AM/PM, formato, duracao e playback) antes de enviar. O ano do lote cobre nomes
  sem ano; a ordem pode ser invertida. O audio original e preservado; reimportar o mesmo
  conteudo nao duplica a entrada (dedupe por SHA-256 no servidor).
- **Status de sincronizacao** no cabecalho (nuvem discreta): abre a tela de Sincronizacao com
  o que esta na fila/falhou e "Enviar agora". O envio continua em segundo plano
  (WorkManager) quando o app fica em segundo plano.
- A biblioteca organiza as notas **por ano** (mais novo no topo), pela data do evento, para
  que notas antigas importadas apareçam no ano a que pertencem.
- **Notas somente texto** entram na mesma fila e sao enviadas como conteudo textual (o texto
  e tratado como se fosse a transcricao, marcado como nota de texto). O endpoint do servidor
  para isso ainda sera implementado; ate la a nota fica na fila e reenta com backoff.
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
