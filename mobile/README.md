# dyarium mobile

App Android de captura do dyarium (React Native + Expo). E um app de **notas de
audio e de texto**: grava notas de voz com a tela bloqueada, escreve notas de
texto, guarda local, enfileira e envia para o servidor self-hosted.

## O que ele faz

- Tela inicial com as notas em **lista separada por ano** (mais novo no topo) e
  um **botao flutuante unico** no canto inferior direito. Ao toque, ele abre para
  cima as opcoes **Texto**, **Audio**, **Imagem** e **Link** (Texto e a mais perto
  do dedo): cada uma ja cria a nota e abre direto no modo certo (corpo pronto para
  escrever, gravacao, seletor de imagem ou campo de link). O campo de link ja vem
  preenchido com o link do clipboard, quando houver. Tambem ha as **Opcoes**
  (engrenagem) no topo. Notas de texto nao
  mostram player; as de audio mostram. Nota sincronizada aparece com um **icone de
  nuvem**. Cada card tem um menu de **tres pontinhos** (arquivar/apagar) e da para
  **arrastar para o lado** para apagar ou arquivar (configuravel nas Opcoes).
- **Tela da nota** (`/note/[id]`): a nota e **um corpo so**, todo nativo (sem
  WebView). Titulo, data, tags, player, previa da transcricao e texto rolam
  juntos na mesma rolagem. O texto e editado no **editor nativo rico**
  (`EnrichedTextInput`): negrito, italico, tachado, codigo, titulos, listas,
  citacao e links aparecem enquanto o usuario digita, e a foto entra **no
  corpo** (metade da largura por padrao). O markdown continua sendo o formato
  salvo: o editor vira markdown no debounce e ao sair. Tem **autosave** (sem
  botao de salvar). A barra de acoes (negrito, italico, tachado, codigo, titulo,
  listas, citacao, link e foto) fica
  **grudada no topo do teclado**, desliza para o lado e nao monta/desmonta
  quando o teclado sobe. O titulo quebra linha (ate
  duas linhas) e encolhe um pouco a fonte quando fica longo, sem sumir. No topo,
  o botao de microfone (discreto) e os **tres pontinhos** abrem as configuracoes
  da nota: **compartilhar** e a ficha de propriedades (criada em, origem,
  palavras, caracteres, tamanho e status), como no dashboard. Enter no titulo
  desce para o corpo. Nota so de texto e enviada como conteudo textual; com
  audio, o audio sobe e o texto vai junto. Com audio transcrito, a tela mostra o
  **player** e uma **previa da transcricao sincronizada** (5 linhas, sem cortar
  palavra): a fala atual fica no meio e o texto sobe suavemente conforme o audio
  avanca; tocar abre a transcricao completa, que **ja continua no mesmo ponto do
  audio**. O player de audio fica acima do corpo; o audio nao e um bloco no meio
  do texto.
  Ao sair, a nota e enviada (rascunho com conteudo) ou entra
  na fila de sync (edicao de nota ja enviada), sem depender de rede na hora.
- **Imagens**: a foto entra no corpo no cursor, em metade da largura por padrao;
  **um toque** abre ela em tela cheia. A foto e reduzida (maior lado ate 2048 px)
  e recomprimida em JPEG de alta qualidade antes de entrar na nota. Fica salva no
  aparelho e e exibida pelo proprio arquivo (`file://`) no editor, nunca por
  base64; sobe no sync e continua abrindo do aparelho depois, sem baixar de novo.
  Assim o editor abre rapido, sem o atraso de decodificar a foto em resolucao
  cheia.
  O corpo e nativo, sem WebView. O editor rico (`EnrichedTextInput`, de
  `react-native-enriched-html`) e codigo nativo: precisa do development build
  com o modulo. Codigo, tabela e divisoria do dashboard ainda nao tem no
  nativo: a tabela e a divisoria aparecem como bloco somente leitura e voltam
  iguais ao salvar.
- Grava em **AAC ADTS** (48 kHz mono ~128 kbps), em **segmentos de 60 s**, com
  foreground service do `expo-audio` (continua gravando com a tela bloqueada). A tela de
  gravacao tem **pausar/retomar** e uma waveform **ao vivo a 60 fps** (desenhada na thread
  de UI, sem travar o JS).
- Concatena os segmentos e enfileira automaticamente ao parar.
- Envia por upload resumivel e **idempotente** (`client_key` por gravacao).
- **Importa audios compartilhados** por outros apps (share sheet do Android): ate 50 por
  vez, com tela de revisao (titulo, **ano** e **ordem dia/mes** do lote, data em DD/MM/AAAA
  em 24h ou AM/PM, formato, duracao e playback) antes de enviar. O ano do lote cobre nomes
  sem ano; a ordem pode ser invertida. O audio original e preservado; reimportar o mesmo
  conteudo nao duplica a entrada (dedupe por SHA-256 no servidor).
- **Transcricao no aparelho** (nas Opcoes): lista de modelos do whisper.cpp (Tiny, Base, Small,
  Medium, Large v3 Turbo) do mais leve ao mais preciso, com o **recomendado para a RAM do
  aparelho** e download sob demanda (nunca entram no build). Com um modelo baixado e o toggle
  ligado, a nota de audio e transcrita **offline**, com o texto aparecendo por trecho
  ("Transcrevendo..." com a **porcentagem** e loading). Quem transcreve primeiro informa o
  outro: ao subir o audio o app avisa o servidor (`local_transcribe`) e, ao terminar,
  **empurra o texto** (`PUT /entries/{id}/transcript`), entao o servidor nao transcreve de
  novo e o dashboard mostra o texto. Precisa de development build (`whisper.rn` + um modulo
  nativo local que decodifica o AAC para WAV 16 kHz).
- **Status de sincronizacao** no cabecalho (nuvem discreta): abre a tela de Sincronizacao com
  o que esta na fila/falhou e "Enviar agora". O envio continua em segundo plano
  (WorkManager) quando o app fica em segundo plano.
- **Painel** (nas Opcoes): duas partes. **Escrita** (local, sempre disponivel): **graficos** de
  palavras por semana, **palavras por dia (30 dias)** e **notas por semana** (barras; o de linha
  com SVG ja esta pronto, desligado ate o build — quando liga, toda serie vira linha),
  **constancia** (dias escritos vs nao escritos, com o percentual),
  **historico de escrita** (mapa de dias que escreveu e os que nao), **palavras por mes** com a
  **comparacao com o mes passado**, mapa **dia x hora** (quando escreve), **humor** dos textos
  (lexico local: tom, distribuicao e destaques), e **meta semanal** de palavras com aviso de
  "sequencia em risco". Alem de palavras, caracteres, frases, paragrafos, vocabulario (palavras
  unicas e riqueza), palavras por nota, palavras mais usadas e mais longas,
  perguntas/exclamacoes, links, imagens, listas, dias com nota, sequencia (streak), constancia
  (percentual, dias escritos e melhor sequencia em 30 dias), dia da semana
  e periodo em que mais escreve, palavras faladas nas transcricoes, e **insights** em frases.
  **Servidor** (quando configurado): resumo, humor (sentimento), emocoes, pessoas, lugares, tags e
  status, puxados do servidor.
- **Metricas no servidor** (`PUT /api/v1/metrics`): o app calcula o snapshot das metricas de
  escrita **offline** (o mesmo que o Painel mostra) e guarda esse documento **no aparelho**,
  sempre — fica pronto para enviar mesmo sem servidor. Havendo servidor configurado, ele envia
  ao abrir/voltar ao app, quando a lista de notas muda e de 15 em 15 minutos. O servidor guarda o
  ultimo snapshot de cada aparelho e o painel web desenha exatamente o que o celular calculou
  (contrato versionado em `docs/api.md`).
- **Lembretes de escrita** (notificacoes locais): avisam quando a **sequencia esta em risco**
  (nao escreveu hoje) ou quando a **meta semanal esta atrasada** no fim da semana (quinta em
  diante). Tambem comemoram **marcos** (palavras e novo recorde de sequencia), uma vez cada. Hora
  configuravel (padrao 20h) e um liga/desliga no Painel; a notificacao nao leva conteudo sensivel.
- **Busca local** e **pull-to-refresh** na lista; **compartilhar** o texto da nota;
  **notificacao** quando a transcricao fica pronta.
- **Armazenamento** (nas Opcoes): uso no aparelho e liberar espaco (remove o audio local de
  notas ja sincronizadas; o audio continua no servidor). Migracoes do banco versionadas e
  trava de fila para nao ter dois workers ao mesmo tempo.
- **Backup local** (nas Opcoes): escolhe uma pasta do aparelho e copia tudo para la — notas,
  audio, imagens e links — num manifesto em ordem. Cada midia leva o **md5 do conteudo** no
  nome, entao reexecutar nao reescreve o que ja existe e nada e perdido; o manifesto e escrito
  por ultimo (um backup interrompido nao invalida o anterior). "Restaurar backup" **confere o
  md5 de cada arquivo** antes de entrar na nota e aborta se algo nao bate; notas com o mesmo id
  sao atualizadas e as demais ficam. Nao depende do servidor nem de nuvem (sem cifra).
  Ao restaurar, cada nota volta **tambem no servidor**, antes de qualquer sincronizacao: o app
  desfaz a exclusao logica da entrada (`POST /entries/{id}/restore`) e, se o servidor ja nao a
  conhece mais, recria com o mesmo id e reenvia titulo/corpo. E o que impede a nota restaurada
  de ser apagada de novo pelo servidor.
- **Sincronizacao de exclusoes por lixeira**: o app so apaga uma nota local quando o servidor
  **confirma** que ela foi apagada (`GET /entries?deleted=1`) e a exclusao e mais nova que a
  ultima mudanca local. Uma entrada que simplesmente sumiu (servidor novo, banco restaurado)
  nunca apaga o aparelho.
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

A compressao de imagem usa `expo-image-manipulator` (modulo nativo), entao um
**novo development build** e necessario para o app mais recente. Sem ele, o app
continua abrindo, mas anexa a foto original (sem reduzir).

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
