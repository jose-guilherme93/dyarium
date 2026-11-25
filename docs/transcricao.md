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

Cada etapa tem **um** lugar, escolhido em Opcoes > Processamento: desligada, no aparelho,
no servidor ou online direto. As duas etapas (transcricao e analise) tem a escolha propria.

- **Desligada**: notas novas nao entram na fila.
- **Aparelho**: whisper.cpp (transcricao) ou llama.cpp (analise), com modelo baixado.
- **Servidor**: o servidor executa com o provedor configurado la (Whisper ou Deepgram,
  analise OpenAI-compatible). O app so pede e recebe; nao transcreve nem analisa aqui.
- **Online**: o aparelho chama o provedor direto, com a chave do cofre do aparelho —
  Deepgram na transcricao e um provedor OpenAI-compatible na analise.

O lugar escolhido e o unico que **comeca** a etapa; os outros apenas recebem o resultado
pelo sync. Nada troca de motor em silencio: sem modelo, sem chave ou sem servidor a etapa
fica **bloqueada** e a tela diz o que falta. Servidor escolhido e offline nao cai para o
aparelho; aparelho escolhido sem modelo nao cai para o servidor.

Quando a escolha do servidor chega depois do upload (o audio subiu com a etapa nas maos do
aparelho), o app pede `POST /entries/{id}/retranscribe` em vez de transcrever aqui. O botao
de transcrever de uma nota nao executa o motor errado.

### Provedores e a web

A tela de Processamento mostra o mesmo conjunto de provedores da web:

- **Transcricao no servidor**: `transcribe_provider` (`whisper` ou `deepgram`),
  `deepgram_model`, `whisper_language` e `trim_silence`.
- **Analise no servidor**: `analyze_provider`, `analyze_base_url`, `analyze_model`,
  `review_enabled` e `literal_transcript`.
- **Online no aparelho**: Deepgram (modelo e chave no cofre) e os presets OpenAI-compatible
  (OpenRouter, Groq, Google, DeepSeek, Mistral, xAI e personalizado).

`GET /settings` nunca devolve chave: so `deepgram_api_key_set` e `analyze_api_key_set`.
**Importar do servidor** traz provedor, modelo, idioma e revisao sem copiar segredo;
**Enviar para o servidor** leva a escolha do aparelho e, quando existir aqui, a chave
digitada — nunca um segredo ausente, para nao apagar o que o servidor ja tinha.

### Feedback de quem esta rodando

Trabalho pesado e visivel em quatro lugares, sem abrir a nota:

- **Card da nota**: porcentagem real do motor e, no servidor, "Transcrevendo no
  servidor" sem numero; o badge da home usa o mesmo estado.
- **Centro de atividade**: progresso, etapa e o botao de parar. A atividade nasce
  antes da fila de trabalho pesado, com "Na fila" enquanto espera a vez. Uma
  atividade interrompida que voltou do banco ainda oferece **Continuar** (o id
  da atividade carrega a nota; o banco nao guarda funcoes).
- **Fila em Processamento**: o que esta rodando com a porcentagem, o que espera o
  servidor sem inventar numero e o que ainda nao comecou.
- **Notificacao** (servico em primeiro plano) durante a passada no aparelho.

A porcentagem so existe quando o motor reporta: local em tempo real, online por
janela (a Deepgram responde a janela inteira, nao em streaming). No servidor o
estado e de espera, nunca uma barra falsa.

### Checkpoint, retomada e audio longo

- A transcricao roda em janelas de 60 s; ao fim de cada janela o checkpoint e gravado
  (duravel) antes da proxima.
- **Nao existe prazo para a passada inteira.** O unico limite e por janela: o motor que
  para de reportar progresso por 90 s tem a janela cancelada. Um audio de 41 minutos tem
  41 janelas e cada uma vale por si.
- Se o processo morrer (Android sem memoria/reinicio), a proxima abertura retoma do
  checkpoint. O WAV de trabalho fica em documentos (nao no cache, que o sistema pode
  limpar) e e apagado no fim.
- O modelo efetivo e resolvido pelos **arquivos instalados**, nao pelo id salvo: uma
  preferencia apontando para um modelo ausente usa o instalado; sem nenhum, a nota fica
  pendente com o caminho do download, nunca com "sem modelo" por leitura ruim.
- A transcricao online usa as mesmas janelas, o mesmo checkpoint e a mesma retomada;
  falha passageira (429, 5xx, rede) tenta de novo dentro da passada.

A transcricao no aparelho (ou online) comeca logo depois que a gravacao e enfileirada, e
nao so no proximo boot. A fila automatica (boot e volta ao app, com o app na frente) roda
mesmo sem servidor e pega apenas audio sem texto e sem dono no servidor.

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
