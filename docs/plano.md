# Plano do projeto dyarium

## Visao geral

O dyarium e um diario falado self-hosted e de codigo aberto, licenciado sob MIT. O usuario
envia arquivos de audio de ate 50 minutos. O sistema guarda o audio original exatamente como
recebido, cifrado em repouso; transcreve localmente com whisper.cpp; enriquece a transcricao
com analises opcionais (via API compativel com OpenAI, como o Ollama local) e apresenta tudo
num dashboard privado.

O sistema e um unico binario Go. O dashboard e uma aplicacao React embutida no binario via
`go:embed`. Nao existe dependencia obrigatoria de servicos externos: armazenamento, transcricao,
metricas e dashboard funcionam offline. Somente a analise de texto por IA e opcional.

## Objetivos

- Capturar ideias por voz com o minimo de atrito e sem alterar o audio original.
- Processar tudo localmente por padrao, preservando a privacidade.
- Ser simples de operar: um binario, um banco SQLite, um diretorio de dados.
- Ser extensivel: acesso a dados atras de uma interface de repositorio (permite Postgres no
  futuro), analise plugavel e modulos opcionais.
- Ser testavel, observavel e reproduzivel.

## Escopo da versao de desenvolvimento

- Binario `diary` com os subcomandos `serve` e `version`.
- API HTTP autenticada por token (`Authorization: Bearer`).
- Banco SQLite em modo WAL, com migrations versionadas e runner proprio embutido.
- Upload resumivel com validacao de integridade por SHA-256.
- Armazenamento cifrado em repouso (AES-256-GCM) dos audios originais.
- Fila de jobs com leases, heartbeat, retries com backoff e idempotencia.
- Transcricao local via `whisper-cli`, com chunking e checkpoints por trecho.
- Metricas de audio via ffmpeg/ffprobe: duracao, loudness, silencios, normalizacao.
- Analise de texto opcional: sentimento (com rotulo), emocoes, pessoas, lugares, temas,
  momentos-chave, resumo, perguntas e decisoes. Transcricoes longas sao analisadas em
  janelas com merge e meta-resumo. Pessoas, lugares e temas viram entidades consultaveis
  e o sentimento alimenta uma linha do tempo de humor.
- Dashboard SPA: lista, entrada aberta, painel de analise, humor, busca e configuracao.
- Backup continuo opcional com Litestream para S3.
- Modulo Telegram opcional, desligado por padrao, para envio de audio.
- Empacotamento Docker multi-stage com a imagem de producao.

## Fora de escopo desta versao

- Colaboracao multiusuario, contas e permissoes por usuario.
- Transcricao em tempo real (streaming de audio).
- Diarizacao de locutores (quem falou o que).
- Busca semantica com embeddings vetoriais.
- Suporte ativo a Postgres (apenas previsto pela abstracao de repositorio).
- Telegram bidirecional (apenas recepcao de audio).
- Edicao ou reprocessamento destrutivo do audio original.

Principio central: o audio original e imutavel. Qualquer transformacao (normalizacao,
reamostragem para 16 kHz mono, corte de silencio na transcricao) acontece em artefatos
derivados, nunca sobre o arquivo enviado.

## Riscos e mitigacoes

1. Consumo de memoria do whisper.cpp, sobretudo com modelos maiores.
   Mitigacao: benchmark reproduzivel (`make bench-transcricao`) e concorrencia de workers
   configuravel, com padrao conservador.
2. Uploads grandes interrompidos por queda de rede.
   Mitigacao: upload resumivel com retomada por offset e validacao final por SHA-256.
3. Perda de dados.
   Mitigacao: SQLite em WAL, migrations versionadas e Litestream opcional.
4. Vazamento de segredos (token, chave mestra, credenciais de S3).
   Mitigacao: tudo por variaveis de ambiente, `.env.example` sem valores reais, nenhum
   dominio ou IP real no codigo ou na documentacao.
5. Falsa sensacao de seguranca da cifra.
   Mitigacao: documentar explicitamente que a perda da chave mestra torna os audios
   irrecuperaveis, e que a cifra protege em repouso, nao em uso.
6. Incompatibilidade de formatos de audio.
   Mitigacao: o pipeline deriva uma copia 16 kHz mono via ffmpeg para a transcricao, sem
   tocar no original.
7. Dependencia de binarios externos (`whisper-cli`, `ffmpeg`).
   Mitigacao: compilar/instalar com versoes fixadas no Dockerfile.

## App mobile (captura e notas)

Superficie Android em Expo (development build). O nucleo puro fica em `mobile/src/core`
(testado com Jest); servicos nativos e telas ficam finos.

### Implementado

- Gravacao em AAC ADTS, segmentos de 60 s, foreground service (tela bloqueada) e
  recuperacao de sessao interrompida.
- Upload resumivel e idempotente (`client_key`); fila persistida em SQLite (WAL) com
  migracoes versionadas (`PRAGMA user_version`, append-only) e trava no banco para nao
  ter dois workers (primeiro plano e background task).
- Importacao de audios compartilhados por outros apps (share sheet): ate 50 por vez, com
  revisao (titulo, ano do lote, ordem dia/mes, 24h/AM-PM, duracao e playback). O audio
  original e preservado; dedupe por SHA-256 no servidor.
- App de notas (texto e audio): a nota e uma **lista ordenada de nos** (texto,
  imagem, audio), nao um texto com anexos. O texto da nota e **um editor rico
  so** (negrito, italico, tachado, codigo, titulos, listas, citacao e links) e
  cada foto/audio e um componente nativo no lugar: so as midias que cortam o
  texto dividem o editor. Um editor por paragrafo fazia o campo ser desmontado
  e remontado a cada troca de paragrafo (com o custo e o lag do documento
  inteiro), e o Enter criava um editor novo. A insercao no cursor divide o
  no de texto na posicao exata: a foto e a gravacao entram **entre dois trechos**,
  e o player de audio fica no corpo, nao acima dele. A foto e um no com largura
  em percentual da nota: o usuario escolhe o tamanho (largura total, metade ou
  miniatura) e pode redimensionar e remover depois; a largura viaja no markdown.
  Os audios podem ser removidos do corpo; os textos vizinhos voltam a ficar
  juntos. O markdown continua sendo o
  formato salvo (`![foto](ref){w=50}`, `!audio[ref]{d=12.5}`), com parser e
  serializer puros em `core/noteDocument`. O texto de um no e o conteudo que o
  editor mostra; o separador que fecha a linha antes da midia fica no
  `breakAfter` do no, entao o markdown volta igual e as linhas em branco que o
  usuario digita no fim do texto nao somem. So uma nota gigante e cortada
  (8000 caracteres) e as partes voltam coladas. O texto e editado no
  editor nativo do proprio app, sempre montado: o toque, o cursor e o Enter sao
  os do Android (nenhuma copia em JavaScript, nenhuma matematica de cursor,
  nenhuma camada de previa entre o dedo e o campo). Um editor por trecho de
  texto, e so as midias cortam o texto: uma nota sem midia tem um unico campo.
  A leitura do HTML de um trecho e uma por vez, para o texto escrito nao se
  perder. A barra de acoes fica
  grudada no topo do teclado; o titulo encolhe a fonte quando fica longo; os tres
  pontinhos abrem compartilhar e a ficha de propriedades (gravada em, criada em,
  importada em, origem, palavras, caracteres, tamanho, status), como no
  dashboard. Abaixo do titulo aparece a data do evento (`recordedAt`), nao a data
  da importacao. O corpo e **100% nativo**: nao ha WebView no app, o que elimina
  cold start, recarga do documento e tremor na digitacao. Nota so de texto entra
  na fila e e enviada como conteudo
  (`POST /api/v1/entries` + corpo markdown).
- Audio na nota, em um player so: o card do corpo tem um unico play/pause, tempo
  e barra de progresso; tocar ou arrastar a barra pula para o trecho, e o seek e
  aplicado quando a fonte termina de carregar (AAC informa a duracao real depois
  do metadado). Abaixo do audio fica a previa da transcricao em cinco linhas,
  que acompanha a fala; tocar numa linha toca dali, o toque longo abre a
  transcricao completa editando aquele trecho, e arrastar a janela pausa o
  acompanhamento por tres segundos. A transcricao em andamento aparece no
  proprio audio, com progresso, tanto a local quanto a pedida ao servidor. Nao
  existe player duplicado no topo nem segundo botao de play no card.
- Gravacao comeca no toque: o microfone abre no mesmo gesto e a tela de gravacao
  entra na frente; criar o registro no SQLite e resolver a posicao do cursor
  acontecem depois, sem segurar o audio. A waveform e uma fila de 40 barras
  comuns movida pelo medidor (4 Hz), sem animacao por frame, e a tela mostra a
  hora, o dia da semana e a data por extenso. A barra de acoes acima do teclado
  rola na horizontal e leva a gravacao de audio, a foto, o link e a formatacao.
- Home compacta: paginas recentes por padrao, sem alternador de modo nem barra
  de busca fixa. O caderno vira um icone no topo que abre uma folha com as
  paginas recentes, os cadernos e o atalho para criar ou gerenciar. A busca so
  aparece ao tocar na lupa, e cada nota e uma linha de largura total com divisor,
  sem cartao e sem margem externa (estilo OneNote).
- Centro de atividade na home, ao lado da nuvem: transcricao, analise local,
  backup/restauracao e download de modelo publicam inicio, progresso e fim num
  store em memoria. A folha mostra a fase real (trecho transcrito, tokens
  gerados, notas copiadas) e guarda as concluidas recentes ate serem limpas. Uma
  falha ou interrupcao oferece uma acao de recuperacao: tentar de novo
  (transcricao, backup, restauracao e download) ou abrir a nota (analise). O
  estado da fila de envio continua no icone da nuvem.
- Transcricao no aparelho (opcional, nas Opcoes): usa `whisper.rn` (whisper.cpp) com modelos
  ggml baixados em runtime (Tiny..Large v3 Turbo), recomendado pela RAM; o audio AAC e
  decodificado para 16 kHz por um modulo nativo local (sem ffmpeg) e transcrito offline, com o texto
  aparecendo por trecho. Cada nota tem um flag de transcricao e a origem (`local`/`server`);
  quem transcreve primeiro informa o outro e nao ha retranscricao. Exige novo development build.
- Nota local-first de verdade: a edicao e sempre persistida no SQLite antes de qualquer
  rede; edicao de nota ja enviada (texto ou imagem) marca um flag e entra na fila de sync,
  que reenvia ao voltar a conexao. Imagens sao salvas no aparelho e exibidas no editor pelo
  proprio arquivo (`file://`), sem base64 nem download a cada abertura; um mapa de anexos
  evita reenviar a mesma imagem. Na importacao a foto e reduzida (maior lado ate 2048 px) e
  recomprimida em JPEG de alta qualidade (`expo-image-manipulator`), o que remove o atraso
  de abrir a nota (o editor nao decodifica mais a foto em resolucao cheia). Imagem que ainda
  nao esta no aparelho nao segura a abertura: o editor monta com as locais, baixa o resto
  em segundo plano e a imagem entra quando chega. A pilha de audios do servidor
  tambem fica em cache no SQLite e e revalidada em background.
- Biblioteca por ano, busca local, pull-to-refresh, swipe para apagar/arquivar e opcoes.
- Status de sincronizacao no cabecalho e tela de fila; notificacao quando a transcricao
  fica pronta; compartilhar o texto da nota.
- Painel com as metricas do servidor (resumo, humor, tags, status).
- Armazenamento local: uso no aparelho e liberar espaco (remove o audio local de notas ja
  sincronizadas; o audio continua no servidor).

### Proximos passos

1. **Backup local em .zip (proximo)**: exportar banco + audios num arquivo .zip e restaurar
   (rollback). Sem dependencia nativa; testavel logo. Requer uma lib de zip em JS (ex.:
   `jszip`).
2. **Integridade**: gerar o SHA-256 do arquivo local (`expo-crypto`) e enviar no
   `createUpload` para o servidor validar.
3. **Backup no Google Drive via OAuth (pendente)**: `expo-auth-session` + Drive
   (`appDataFolder`). Depende de um OAuth client no Google Cloud (tipo Android, package
   `com.dyarium.app` + SHA-1 do keystore). Cada usuario autentica a propria conta; o backup
   vai para o Drive do usuario, nao do dono do projeto.
4. **Cifra em repouso no aparelho (pendente)**: AES-256-GCM com chave no SecureStore;
   requer lib nativa de cripto.

### Notas de confiabilidade

- SQLite em WAL, migracoes versionadas; audio imutavel; importados copiados antes de
  enfileirar.
- Armazenamento local em `recordings/<id>/` (diretorio de documentos, nao apagado pelo SO).
- `android.allowBackup=false` (sem backup automatico do SO); o backup sera explicito
  (zip local primeiro; Drive depois).

## Distribuicao e releases

- Versao unica do produto (semver), comecando em 0.1.0 e calculada pelo release-please a
  partir dos commits convencionais. Em 0.x, uma mudanca de quebra sobe a minor.
- Imagem de producao multi-arch (`linux/amd64` e `linux/arm64`) publicada no GitHub
  Container Registry (`ghcr.io/jose-guilherme93/dyarium`) com tags `vX.Y.Z` e `latest`,
  com provenance e SBOM.
- Deploy padrao por `docker-compose.yml` (usado tambem pelo Dokploy). Nenhuma variavel de
  ambiente obrigatoria: o primeiro run funciona apenas com o volume de dados montado.
- Primeiro acesso guiado por wizard (`/setup`) e modelo padrao do whisper baixado em
  segundo plano (`DIARY_AUTO_DOWNLOAD_MODEL`).
