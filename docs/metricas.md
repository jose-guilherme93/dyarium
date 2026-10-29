# Metricas e Painel

Design das metricas do dyarium: para quem elas existem, como sao contadas, qual e
o contrato do snapshot e em que ordem entram. Este documento antecipa o contrato;
`docs/api.md` e `docs/modelo-de-dados.md` so mudam quando o codigo existir.

## Principio

O Painel e para quem escreve. Ele responde "o que eu escrevi, como eu estava e
sobre o que falei", nao "qual modelo rodou". Metricas de execucao (modelo,
tokens/s, threads, bateria) sao instrumentacao para diagnosticar e vivem em
Configs > Avancado, nunca no Painel.

O app e a superficie principal: ele tem o corpus local, a bateria, os modelos e a
analise no aparelho. O web espelha o snapshot; nao recalcula metrica.

## Decisoes

- Superficie: app mobile (Painel e Configs). O web apenas desenha o snapshot.
- Calculo local, offline e deterministico. Nenhuma frase de resumo usa LLM.
- Contrato: `MetricsSnapshot` schema 2, um documento por aparelho (o mesmo
  `PUT /api/v1/metrics`).
- Diagnostico tecnico: Configs > Avancado, fechado por padrao.
- Execucao de analise: tabela append-only `analysis_runs`, uma linha por
  tentativa, coletada a partir da implementacao (sem backfill).
- OCR de imagens: fase separada, fora deste escopo.
- Expo web: avaliado e descartado para esta fase (ver "Fora de escopo").

## Definicoes

**Nota**: entrada com texto nao vazio, depois de remover markdown. Uma nota pode
ter audio, imagens e transcricao; o texto escrito e o corpo da nota, nao a
transcricao.

**Texto vs fala**: palavras escritas e palavras transcritas sao contadas
separadamente e nunca somadas. A transcricao nao entra em "palavras escritas".

**Voz**: minutos gravados = soma da duracao dos audios originais; minutos
transcritos = soma da duracao dos audios que tem transcricao. Cobertura =
transcritos / gravados. WPM = palavras transcritas / minutos transcritos.

**Imagem**: anexo `kind=image`. O tamanho e o do arquivo local (ciphertext no
servidor, arquivo reduzido no aparelho).

**Analise**: resultado de qualquer motor (local `llama.rn` ou servidor), o mais
recente por nota.

**Janela**: 7d, 30d ou 365 dias corridos, ancorada em `recorded_at` (com fallback
para `created_at`), no fuso local do aparelho. "Ano" e 365 dias, nao ano-calendario.
O padrao e 30d. A comparacao e sempre com a janela imediatamente anterior de mesmo
tamanho.

**Sequencia (streak)**: dias consecutivos com pelo menos uma nota. Independe do
filtro: e sempre calculada sobre o historico completo.

**Cobertura da analise**: notas com conteudo que tem analise / notas com conteudo
na janela.

**Analise desatualizada**: analise local com hash de conteudo diferente do texto
atual; analise do servidor com `analyses.created_at` anterior a ultima edicao da
nota ou da transcricao.

## Contrato do snapshot (schema 2)

O documento e calculado no aparelho e guardado como veio. O envelope HTTP nao
muda: `device_id`, `device_name`, `schema`, `generated_at` e o documento.

```json
{
  "schema": 2,
  "generated_at": "2026-10-19T12:00:00Z",
  "streak": { "current": 5, "longest": 21, "wrote_today": true },
  "windows": {
    "7d": {
      "from": "2026-10-13",
      "to": "2026-10-19",
      "writing": { },
      "voice": { },
      "images": { },
      "analysis": { },
      "sentiment": { },
      "summary": ["...", "..."]
    },
    "30d": { },
    "365d": { }
  },
  "history": { }
}
```

As tres janelas vao prontas no documento. O web escolhe a janela e desenha; nao
filtra nem recalcula. O app monta uma vez, com um unico `now`, e usa o mesmo
documento no Painel e no upload. `history` permanece como no schema 1 (todas as
notas) e alimenta os graficos de constancia.

### `writing`

Mantem os nomes do schema 1, agora por janela: `notes`, `with_text`, `with_audio`,
`with_transcript`, `words`, `chars`, `sentences`, `paragraphs`, `unique_words`,
`lexical_richness`, `average_words_per_note`, `average_sentence_words`,
`average_word_length`, `questions`, `exclamations`, `links`, `images`,
`list_items`, `top_words[]`, `longest_words[]`, `active_days`,
`average_notes_per_active_day`, `top_weekday`, `top_hour`, `weekday_hour`,
`consistency`, `longest_note`, `notes_per_week`.

Novo: `reading_minutes` (palavras / 200).

### `voice`

`audio_count`, `audio_minutes`, `transcribed_minutes`, `coverage`,
`words`, `words_per_minute`, `words_per_audio`, `origin_local`, `origin_server`,
`transcript_share` (palavras de transcricao / (escritas + transcritas), 0..1).

Tempo de transcricao e percentual retomado por checkpoint dependem da
instrumentacao de execucao (fase 2) e nao entram aqui.

### `images`

`count`, `bytes_total`, `bytes_average`, `per_note`, `notes_with_image`,
`notes_with_image_no_text`.

### `analysis`

`notes_with_content`, `notes_analyzed`, `coverage`, `stale`, `simplified`,
`last_analyzed_at`.

### `topics`

`themes[]`, `people[]` e `places[]`, cada item `{ "label": ..., "count": ... }`.
Vem das analises da janela, sem repetir o mesmo nome na mesma nota; ate 8 por
tipo. E a fonte do cartao "Sobre o que voce escreveu".

### `sentiment`

`source` (`analysis` ou `lexical`), `analyzed`, `positive`, `neutral`,
`negative`, `top_positive`, `top_negative`, `emotions[]`
(`{ "label": ..., "count": ..., "tone": "positive|neutral|negative" }`),
`series[]` (`{ "key": ..., "average": ..., "notes": ... }`) e `granularity`
(`day` ou `week`). O `tone` de cada emocao vem do sentimento das notas em que ela
apareceu: o app mostra seta verde para cima no positivo, vermelha para baixo no
negativo e um traco no neutro.

Fonte: a analise mais recente de cada nota na janela. Quando a janela nao tem
nenhuma analise, cai para a estimativa lexica de `writing.ts`, com
`source = "lexical"`; as duas fontes nunca se misturam na mesma media. O numero
`average` existe para tendencia e diagnostico, nao para ser exibido como
"sentimento 0,42".

### Regras de compatibilidade

- O servidor aceita schema 1 e 2 e preserva o documento inteiro, inclusive
  secoes que ainda nao conhece. So o envelope (`device_id`, `device_name`) sai do
  payload.
- O web desenha schema 2 (com filtro de janela) e cai no layout atual (todas as
  notas) para schema 1.
- O documento nao carrega texto de nota, transcricao, audio, caminho de arquivo
  nem segredo. O teto de 256 KiB continua valendo; as tres janelas ficam muito
  abaixo.

## Painel

Filtro global no topo: 7d / 30d / ano, padrao 30d. O filtro troca a secao
inteira; nao ha filtro por card.

### Secoes do primeiro corte

| Secao | Manchete | Apoio | Detalhe (expansivel) |
|---|---|---|---|
| Como voce escreveu | "1.240 palavras em 8 notas" | notas/semana, media por nota, sequencia, dia e hora | tempo de leitura, diversidade lexical, repeticao |
| Como voce se sentiu | "A maioria das notas foi positiva" | proporcao positivo/neutro/negativo, 3 emocoes mais frequentes, tendencia | serie da janela, notas que puxaram para cima/baixo |
| Sua voz | "42 min gravados, 38 transcritos" | cobertura, palavras por audio, origem local/servidor | WPM, quanto do texto veio da fala |

### Segundo corte (implementado)

- **Sobre o que escreveu**: temas, pessoas e lugares mais citados (fonte:
  analises). Depende de cobertura e pode ficar vazio.
- **Imagens**: quantidade e espaco; "notas com imagem e sem texto" no detalhe.
  Os bytes vem da varredura local das pastas das notas.

### Estados vazios

Card so aparece quando ha dado. Sem analise, a secao de sentimento mostra uma
frase convidando a analisar, nao um card zerado. "Analise desatualizada" e aviso
discreto com acao ("3 notas mudaram desde a analise - reanalisar"), nunca card
vermelho. Nunca exibir "0%" como se fosse falha do usuario.

### Frases de resumo

Regras puras em `mobile/src/core`, deterministicas e testaveis com relogio fixo.
Cada janela tem 2 a 3 frases, comparando com a janela anterior de mesmo tamanho.
Exemplos de tom:

- "Voce escreveu 1.240 palavras em 8 notas, 32% mais que nos 30 dias anteriores."
- "Voce escreveu em 12 dos 30 dias e manteve uma sequencia de 5 dias."
- "Voce gravou 42 minutos e transcreveu 38."
- "Suas notas deste mes falam mais de trabalho e de familia."

Regras de tom: descritivo, sem diagnostico de humor, sem conselho, sem julgamento
moral e sem emoji. Quando a janela anterior nao tem base de comparacao, a frase
omite a variacao em vez de inventar 100%.

## Diagnostico (Configs > Avancado)

Fechado por padrao. Uma linha de saude em linguagem simples e, ao expandir, os
numeros tecnicos:

- Taxa de sucesso por modelo (tentativas e por nota), tempo medio, tokens/s,
  percentual de leituras simplificadas e erros por classe.
- Cobertura da analise e analises desatualizadas.
- Bateria: apenas o delta em pontos percentuais, marcado como estimativa; nao
  vira card de "custo medio" nesta fase.
- Espaco dos modelos locais (GGUF) e do armazenamento local.
- Exportar metricas em JSON: o mesmo documento do snapshot mais o agregado de
  diagnostico, compartilhado localmente, sem texto, transcricao, audio ou
  caminhos. Nunca enviado automaticamente.
- Secao "Servidor": usa `GET /api/v1/analysis/runs/summary` e mostra o agregado
  do worker Go; as execucoes locais ficam no proprio aparelho.

## Instrumentacao de execucao (implementado)

Tabela append-only `analysis_runs`, uma linha por tentativa, no SQLite do
servidor e no SQLite do app (schema equivalente). Campos:

```text
id, entry_id, analysis_id (nulo), attachment_id (nulo),
runtime (local|server), provider (llama.cpp|openai|opencode|ollama), model,
attempt, outcome (ok|partial|invalid_json|error|stopped|fallback),
error_class (generico, sem conteudo), started_at, finished_at, duration_ms,
input_text_chars, input_transcript_chars, input_images,
prompt_tokens, completion_tokens, tokens_per_second, threads,
battery_delta_pct (nulo; so local)
```

- Sucesso = tentativa com resultado parseado e persistido. `invalid_json`,
  `error` e `stopped` sao falhas; `fallback` conta em "% simplificadas" e nunca
  como sucesso. `partial` e a passada que leu alguns blocos e parou: conta como
  sucesso (a analise existe e pode continuar) e a cobertura fica no documento.
  A taxa e calculada por tentativa e por nota (resultado final); latencia so
  sobre sucessos e parciais.
- Identidade do modelo: `runtime`, `provider` e `model` separados. Agrupar por
  provider + modelo na exibicao; nunca comparar um GGUF local com uma API como se
  fossem o mesmo modelo.
- Runs locais ficam no aparelho e nao sobem para o servidor. Runs do servidor
  ficam no servidor e sao expostos por um agregado (contrato em `docs/api.md`
  quando implementado). O app junta os dois so para exibir.
- Sem backfill: as analises antigas nao tem duracao nem tokens e ficam nulas.
  Metricas de texto, voz e imagem sao recalculadas do historico, porque os dados
  de origem existem.
- Retencao: sem poda nesta fase; cada linha e pequena e o historico e o que
  permite comparar modelos ao longo do tempo.

O worker grava a execucao no `analysis_runs` do servidor mesmo quando a analise
falha (o diagnostico nunca derruba o job). O app grava as tentativas locais e a
leitura simplificada no SQLite do aparelho. O agregado do servidor sai em
`GET /api/v1/analysis/runs/summary`; o local e calculado por
`mobile/src/core/analysisRuns.ts`. A tela fica em
`mobile/src/app/diagnostics.tsx` (Configs > Avancado) e exporta o JSON dali.

## Custo no aparelho

Abrir o Painel nao pode travar a thread de JS. Tres regras sustentam isso:

- **Um cache de fatos por nota** (`noteTextFacts`, em
  `mobile/src/core/writing.ts`): tokenizar o corpo (markdown, palavras,
  sentencas, marcas, tom) custa caro, e as tres janelas, o historico e o snapshot
  leem as mesmas notas. O cache e um `WeakMap` com o proprio objeto `Recording`
  como chave; o `LibraryContext` reutiliza os objetos inalterados e cria um novo
  a cada gravacao (`updatedAt` muda), entao editar uma nota invalida so aquela.
- **Aquecimento em blocos** (`warmMetricsFacts`, em `mobile/src/core/metrics.ts`):
  o Painel aquece o cache antes de montar os cards, cedendo a thread entre os
  blocos. So a agregacao (barata) roda durante o desenho. A varredura de imagens
  segue o mesmo caminho (`scanImageBytesAsync`).
- **Um documento so**: o Painel monta o snapshot uma vez e entrega o mesmo
  documento ao sync (`publishMetricsSnapshot`), que nao rele a biblioteca do
  banco para recalcular.

## Ordem de implementacao

1. **Nucleo puro** (implementado): agregacao por janela e frases de resumo em
   `mobile/src/core`, com testes de relogio fixo e limites de janela.
2. **Painel v1** (implementado): Escrita, Sentimento e Voz em
   `mobile/src/app/dashboard.tsx`, com filtro, estados vazios, detalhes e setas de
   tom.
3. **Schema 2** (implementado): documento completo com as tres janelas, servidor
   aceitando 1 e 2 e preservando o documento, web desenhando as duas versoes.
4. **Segundo corte** (implementado): temas, pessoas, lugares e imagens.
5. **Runs e diagnostico** (implementado): tabela, instrumentacao dos dois
   motores, agregado do servidor, tela Avancado e export JSON.

OCR de imagens esta descartado (futuro distante, se algum dia voltar).

## Testes

- Nucleo puro: janela por `recorded_at` com fallback, definicao de nota, cobertura
  de voz, bytes de imagem, cobertura/desatualizacao de analise, frases com e sem
  base de comparacao.
- Contrato: fixture do schema 2 usada pelos testes do app, do servidor e do web;
  o servidor rejeita schema 3, aceita 1 e 2 e preserva secoes desconhecidas.
- Servidor: `PUT`/`GET` com as duas versoes e teto de tamanho.
- Web: render do schema 2 e fallback do schema 1.

## Fora de escopo

- **OCR de imagens**: descartado por ora. Se voltar no futuro distante, vira
  projeto separado, com engine/modelo e artefato proprio.
- **Card de custo de bateria**: a medicao atual e delta de 1% com polling de 5s;
  fica so no diagnostico ate haver amostra que justifique.
- **Insights gerados por LLM**: caros, imprevisiveis e desnecessarios para frases
  que saem de regras.
- **Expo web como dashboard**: `expo-secure-store` nao tem plataforma web,
  `expo-sqlite` web e alpha e exige COOP/COEP no servidor, e `llama.rn`/
  `whisper.rn` nao tem build web. O `web/` continua sendo o dashboard servido
  pelo proprio binario Go.
- **Diagnostico do servidor no primeiro corte**: entra com os runs.
