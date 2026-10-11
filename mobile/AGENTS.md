# AGENTS.md (mobile)

Regras especificas do app. As regras gerais do repositorio (seguranca, confianca
de codigo, limite de RAM) estao em `../AGENTS.md` e valem aqui.

## Expo muda rapido: nao confie na memoria

Antes de escrever codigo que toca em API do Expo, EAS ou React Native:

1. Veja a versao do `expo` no `package.json`.
2. Leia a documentacao versionada correspondente:
   `https://docs.expo.dev/versions/v<major>.0.0/`.
3. Use `https://docs.expo.dev/llms.txt` como indice e siga os links.

## Comandos

- Instale dependencias com `npx expo install <pacote>` (resolve versoes
  compativeis com o SDK). Nunca `pnpm add` direto para modulos nativos.
- Antes de concluir: `pnpm typecheck`, `pnpm lint` e `pnpm test` limpos.
- Diagnostico: `npx expo-doctor`.

## Native e config plugins

- `ios/` e `android/` nao existem no repositorio e sao gerados (CNG). **Nunca**
  crie ou edite esses diretorios a mao. Configure comportamento nativo no
  `app.json` e nos config plugins.
- Expo Go so inclui os modulos nativos embutidos. Depois de adicionar uma lib com
  codigo nativo, o app precisa de um **development build**
  (`eas build --profile development`).
- O foreground service de gravacao vem do plugin `expo-audio`
  (`enableBackgroundRecording: true`). Nao troque por API que nao suporte
  background.

## Arquitetura

- Mantenha o **nucleo puro** em `src/core` sem imports nativos; e o que testamos
  com fakes. Servicos nativos (`src/services`) e telas ficam finos.
- Teste comportamento externo do nucleo, nao detalhes. Priorize o seam mais alto.
- Estado da fila e da gravacao vive no SQLite; nada de estado critico so em
  memoria. Toda transicao relevante e persistida antes de prosseguir.

## Seguranca

- Token do servidor apenas no `expo-secure-store`. Nunca em log, URL ou
  `AsyncStorage`.
- Nao logar audio, token ou conteudo. Mensagens de erro ao usuario sao genericas.
- `android.allowBackup=false` (ja no `app.json`) para nao vazar o audio local.
