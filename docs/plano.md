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
