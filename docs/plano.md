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
- Analise de texto opcional: sentimento, emocoes, pessoas, lugares e resumo.
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
- App de notas (texto e audio): tela da nota sempre editavel, autosave, editor rico
  (negrito/italico/lista via WebView), contador de palavras e gravar audio embutido.
  Nota so de texto entra na fila e e enviada como conteudo (endpoint do servidor pendente).
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
5. **Endpoint de nota de texto no servidor** (`POST /api/v1/entries`), para o texto tambem
   entrar no backup do servidor.

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
