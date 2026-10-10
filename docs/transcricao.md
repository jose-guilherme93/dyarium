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

- Booleano em `Settings`, desligado por padrao. Quando ligado, o silencio e removido do
  audio de trabalho antes de transcrever, por exemplo para acelerar audios com muitas pausas.
- Como o audio derivado deixa de ter a mesma duracao do original, cada segmento transcrito
  carrega um deslocamento acumulado. O remapeamento soma os deslocamentos para que
  `Segment.start_ms` e `Segment.end_ms` sempre se refiram ao audio ORIGINAL.
- Ligar/desligar muda a `cache_key` do derivado (por exemplo `16k:trim=off` vs
  `16k:trim=on`), invalidando o cache e forcando a regeracao.

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
