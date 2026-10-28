# Transcricao

## Principios

- O audio original nunca e alterado. Todas as transformacoes ocorrem em artefatos derivados.
- A transcricao e idempotente e retomavel.
- O pico de memoria do whisper.cpp e o principal recurso a controlar; a concorrencia de
  workers e o botao de ajuste.

## Pipeline

1. O worker reserva o job `transcribe` (lease + heartbeat).
2. Decifra o audio original para um diretorio temporario com permissao restrita (0700),
   fora do diretorio de dados. Se um derivado 16 kHz mono cifrado ja existe no cache com a
   `cache_key` atual, ele e decifrado em vez de recalculado.
3. Deriva a copia de trabalho com ffmpeg: 16 kHz, mono, PCM s16le. Se `trim_silence` estiver
   ligado, detecta e remove os silencios (ver abaixo); caso contrario, copia integral.
4. Divide o audio derivado em trechos transcriveis (chunks).
5. Transcreve cada trecho com `whisper-cli`, gravando checkpoints.
6. Remapeia as marcas de tempo para a linha do tempo do audio original.
7. Grava `Transcript` e `Segment` numa transacao; calcula metricas de audio; remove os
   arquivos temporarios.
8. Se a analise estiver ligada, enfileira `analyze`.

## Chunking por silencio

- A divisao de trechos busca fronteiras em silencio para nao cortar palavras.
- Deteccao: `ffmpeg -af silencedetect=noise=<dB>:d=<duracao>` produz intervalos de silencio.
  Escolhemos o silencio mais proximo do alvo de duracao de cada trecho como fronteira, com
  margem de seguranca.
- Se nao houver silencio adequado (audio continuo), cai no fallback de corte por duracao
  fixa, sempre em multiplos de quadro para evitar artefatos.
- O chunking e uma etapa de transparencia: nao modifica o arquivo enviado.

### Corte opcional de silencio (trim_silence)

- Booleano em `Settings`, desligado por padrao. Quando ligado, trechos inteiramente
  silenciosos sao **pulados** na transcricao (nao sao enviados ao whisper), o que acelera
  audios com muitas pausas.
- O audio derivado 16 kHz mono NAO e cortado: ele permanece identico ao original em duracao.
  Assim, cada trecho transcrito tem um deslocamento fixo na linha do tempo original e os
  `Segment.start_ms`/`end_ms` sempre se referem ao audio ORIGINAL, sem remapeamento fragil.
- Como o derivado nao depende do corte de silencio, a `cache_key` e constante (`16k:v1`) e
  ligar/desligar `trim_silence` nao invalida o cache; apenas muda quais trechos sao
  transcritos.

## Checkpoints por trecho

- Apos cada trecho transcrito, o resultado parcial e persistido (trecho atual, texto e
  marcas de tempo). Um evento `job.progress` e emitido.
- Se o processo cair, o worker que retomar o job le os checkpoints e continua do primeiro
  trecho nao concluido, sem reprocessar o que ja foi feito.
- Os checkpoints ficam em uma tabela de apoio/arquivo temporario associado ao job, limpos ao
  concluir com sucesso.

## Leases com heartbeat

- Ao reservar um job, o worker grava `worker_id` e `lease_expires_at = now + lease`.
- Durante a execucao, o worker renova o lease periodicamente (heartbeat em intervalo menor
  que o lease).
- Se o lease expirar (worker morto), o job volta a `queued` e pode ser pego por outro worker.
  O trabalho parcial e retomado via checkpoints.

## Retries com backoff

- Cada falha incrementa `attempts` e agenda `available_at = now + backoff(attempts)`.
- Backoff exponencial com jitter (por exemplo, base 2s, teto configuravel).
- Ao atingir `max_attempts`, o job vai para `dead` e a entrada associada para `failed`,
  emitindo `entry.failed`.
- Erros classificados como permanentes (formato invalido, integridade divergente) nao sao
  retentados: vao direto para `dead`.

## Idempotencia

- A chave logica e `transcribe:{entry_id}` (ou com o modelo/params, quando aplicavel).
- A gravacao de `Transcript`/`Segment` e feita em transacao com upsert pela chave natural;
  reexecutar nao duplica dados.
- Reenviar o mesmo trecho nao altera o resultado final.

## Metricas de audio

Calculadas com ffmpeg/ffprobe sobre o audio (derivado, nunca o original):
- duracao;
- loudness integrado (EBU R128) e true peak;
- intervalos de silencio (contagem e total);
- taxa de amostragem e canais do original (informativos).

## Benchmark de transcricao

Objetivo: medir o pico de memoria residente (RSS) do whisper-cli com os modelos
`ggml-small-q5_1` e `ggml-medium-q5_0`, de forma reproduzivel.

Metodo:
- Entrada: fixture sintetico gerado por ffmpeg (ruido mais tom), de duracao fixa, criado por
  um alvo do Makefile. Garante determinismo sem versionar binarios pesados.
- Execucao: rodar `whisper-cli` sob `/usr/bin/time -v`, lendo a linha
  `Maximum resident set size` (pico de RSS) do stderr.
- Para cada modelo: uma execucao de aquecimento e tres medidas; reportar o maior pico e a
  mediana. Registrar tambem o tempo total.
- Reportar por modelo: pico de RSS (KiB), duracao do audio, tempo de execucao, numero de
  threads e a versao do whisper.cpp.
- `make bench-transcricao` executa o procedimento e imprime o pico de memoria por modelo.

Criterio de aceite do benchmark: o pico reportado deve ser reproduzivel entre execucoes
(variacao pequena) e documentado em `docs/transcricao.md` apos a medicao.

## No aparelho (app)

App e servidor sao **pares**, cada um com o proprio banco. O sync leva o que ja foi feito
e nada e reprocessado automaticamente; refazer e acao explicita do usuario.

### Quem processa

Tres interruptores em Opcoes > Processamento decidem, e o mesmo conjunto aparece na folha
do icone de IA dentro da nota:

- **Transcricao**: ligada/desligada.
- **Analise**: ligada/desligada.
- **Processar no servidor**: exige servidor configurado. Desligado, o trabalho roda no
  aparelho.

O lado escolhido e o unico que **comeca** a etapa; o outro apenas recebe o resultado pelo
sync. Instalacao nova nasce com os tres desligados, e nada e cobrado do usuario: a folha
se apresenta uma vez e pode ser ocultada para sempre (a marca fica em `app_flags`, fora de
qualquer backup, entao reinstalar o app reabre a conversa). O icone de IA continua na barra
da nota e sempre abre os tres interruptores.

Com a etapa desligada ou no aparelho, o upload leva `local_transcribe`/`local_analysis` e o
servidor nao enfileira nada. Sem modelo baixado a nota fica **pendente** — nunca cai para o
servidor sem o usuario escolher. Servidor escolhido e offline tambem nao cai para o
aparelho: a nota espera na fila do servidor.

A transcricao no aparelho comeca logo depois que a gravacao e enfileirada, e nao so no
proximo boot. A fila automatica (boot, com o app na frente) pega apenas audio sem texto e
sem dono no servidor.

- Quem e o dono fica em `transcriptOrigin` (`local` ou `server`), gravado no envio pelo
  `local_transcribe` e mantido no pull.
- Nota que o servidor transcreveu espera o `GET /transcript` e e marcada como pronta
  (`hasTranscript`); o texto do servidor nunca e refeito no aparelho so porque o modelo
  local apareceu depois.

### Limite de trabalho e memoria

O Android encerra o processo quando a memoria aperta e nao deixa um app em segundo
plano abrir um servico em primeiro plano. Por isso o trabalho pesado do app tem
limites internos:

- **Uma passada por vez.** Transcricao, revisao e analise entram na mesma fila
  (`services/heavyWork.ts`). Analise e revisao pedidas pelo usuario passam na frente de
  uma transcricao que espera e pausam a que estiver rodando no fim da janela atual; o
  checkpoint salvo permite retomar.
- **Um motor por vez.** Antes de o whisper carregar o modelo, o contexto do llama e
  liberado; antes de o llama carregar, o do whisper e liberado. Os dois residentes ao
  mesmo tempo eram o caminho mais curto para o processo ser encerrado.
- **Contexto ocioso sai da memoria.** Depois de 20 s sem trabalho, o modelo nativo e
  liberado. Uma nota seguinte na fila ainda o reaproveita.
- **Modelo que nao cabe e recusado.** A analise compara o modelo com a RAM total do
  aparelho e nao o carrega quando ele passa do minimo do catalogo.
- **Servico em primeiro plano com wake lock parcial.** A notificacao mantem o processo
  vivo e a CPU acordada com a tela apagada. Atualizacoes de progresso trocam so a
  notificacao; nao tentam reabrir o servico a partir do fundo. O fim e adiado alguns
  segundos para emendar transcricao, revisao e analise sem derrubar o servico.
- **O WorkManager nao transcreve.** A task de segundo plano so faz upload. Transcricao e
  analise rodam com o app na frente (ou sob um servico que ja esta na frente) e retomam
  no boot pelo checkpoint.
- **Duas threads no maximo** em cada motor, para a interface continuar respondendo.
