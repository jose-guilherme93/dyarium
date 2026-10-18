# Analise local de sentimentos

Plano e decisoes da analise de notas no proprio aparelho. O objetivo e extrair
sentimento, emocoes, temas, pessoas, lugares e eventos sem depender do servidor,
mantendo um historico de meses e anos.

## Decisoes

- Local-first independente: o resultado local e a fonte principal do historico.
- First-wins por versao de conteudo: `texto + transcricao` viram um hash; o
  primeiro resultado para aquele hash vence e nao e regerado.
- Se o servidor ja tem transcricao ou analise, o app importa em vez de gerar.
- Se o app gerou primeiro, o servidor recebe apenas o JSON derivado, nunca texto
  bruto, para nao regerar.
- A analise e enxuta: metricas e tags, com uma leitura curta. Sem resumo longo.
- Tags sao tipadas: pessoa, lugar, tema e evento.
- O historico usa a data da nota, nao a data da analise.
- Analise padrao sob demanda; automatica e no carregador sao opcionais.
- Nota longa demais para o aparelho fica parcial e mostra o gancho de plano
  futuro. Sem cobranca nesta fase.
- Nada de `expo-insights` por enquanto: o conteudo e privado e nao sai do
  aparelho.

## Runtime e modelos

Runtime: `llama.rn` (llama.cpp/GGUF), Android arm64, New Architecture, saida
estruturada por JSON Schema/GBNF.

Catalogo (revisao fixa no Hugging Face, download em runtime). Todos rodam so
na CPU (`n_gpu_layers: 0`); os maiores sao bem mais lentos:

| id | modelo | Q4_K_M | RAM minima |
|---|---|---|---|
| `gemma-3-270m` | Gemma 3 270M IT | ~253 MB | 3 GB |
| `qwen3-0.6b` | Qwen3 0.6B | ~397 MB | 5 GB |
| `qwen3.5-0.8b` | Qwen3.5 0.8B | ~533 MB | 7 GB |
| `gemma-3-1b` | Gemma 3 1B IT | ~806 MB | 8 GB |
| `qwen3-1.7b` | Qwen3 1.7B | ~1.1 GB | 11 GB |
| `qwen3.5-2b` | Qwen3.5 2B | ~1.3 GB | 12 GB |
| `qwen3.5-4b` | Qwen3.5 4B | ~2.7 GB | 16 GB |

A tela de modelos mostra a RAM minima de cada um e avisa quando o aparelho tem
menos que o necessario. O botao da nota tem o modo **Menos CPU** (2 threads em
vez de 4): demora mais, mas reduz o consumo de processamento e bateria. Durante
a analise a ficha mostra tempo, tokens/s (CPU) e bateria; ao terminar, mostra o
resumo da ultima execucao.

O modelo recomendado e o mais capaz que cabe na RAM total do aparelho. Abaixo
de 3 GB nao ha recomendacao local.

O Gemma 4 E2B ficou fora da v1: o Q4_K_M tem cerca de 3,1 GB, o que e agressivo
demais para um aparelho de 8 GB com o app e o Android disputando memoria.

## Build

- Android arm64-v8a apenas (`expo-build-properties` > `android.buildArchs`).
- `llama.rn` limitado a tres variantes de CPU no EAS:
  `rnllama_v8,rnllama_v8_2,rnllama_v8_2_dotprod_i8mm` via
  `ORG_GRADLE_PROJECT_rnllamaVariants`.
- O plugin `plugins/withLlamaBaseLib` copia o `librnllama.so` base para o
  jniLibs do app. O Java do `llama.rn` carrega esse arquivo explicitamente; sem
  ele o `install()` falha com "JSI bindings not installed".
- O benchmark aparece no `preview` por `EXPO_PUBLIC_ANALYSIS_BENCHMARK=1`.
- O perfil `production` nao recebe essa flag.

## Feature flag

A analise local esta **desligada por padrao**. Para ver a tela de modelos e o
benchmark no Metro:

```
EXPO_PUBLIC_LOCAL_ANALYSIS=1 npx expo start
```

Em build EAS, defina a mesma variavel no perfil. O benchmark continua exigindo
`EXPO_PUBLIC_ANALYSIS_BENCHMARK=1` no `preview`.

## Analise manual no aparelho

Com a flag ligada, o menu da nota (tres pontinhos) mostra a secao **Analise**
com o botao **Analisar no aparelho**. O botao:

- usa o titulo e o texto que estao na tela (nao a copia salva na biblioteca)
  e a transcricao mais nova do banco, juntando todos os audios da nota;
- fotos ainda nao sao interpretadas: o modelo local e de texto;
- roda o modelo escolhido em Ajustes sem nenhuma chamada de rede;
- a leitura ("reading") e uma interpretacao curta, nunca copia da nota; se o
  modelo repetir o texto ou a transcricao, o app troca por uma frase derivada de
  tom, temas e emocoes;
- tenta duas vezes (a segunda com contexto novo) e aceita JSON cortado no limite
  de tokens, fechando string e chaves pendentes;
- se as duas tentativas falharem e a nota nao tiver mudado, a analise anterior
  e mantida; se nao houver anterior, a nota ainda sai analisada por uma leitura
  simplificada (tom estimado por palavras da nota), marcada na ficha;
- cada analise local guarda um hash do conteudo; se a nota mudar, a ficha avisa
  que a analise e de uma versao anterior;
- grava o JSON derivado no SQLite local (`analyses`, origem `local`);
- deixa a analise local vencer a do servidor (first-wins): a leitura de fundo
  do servidor nao sobrescreve o resultado feito no aparelho;
- permite **Parar** durante a geracao e **Analisar de novo** depois.

Antes do upload a analise e chaveada pelo id local da nota; quando o `entryId`
chega, a linha e movida para a chave definitiva. Nenhum texto bruto, audio ou
transcricao sai do aparelho nesse caminho.

## Build verificado

O development build v9 (versionCode 9) inclui o `librnllama.so` base via
`plugins/withLlamaBaseLib`, junto das variantes restritas. A pendencia de "JSI
bindings not installed" do build v8 esta resolvida.

## Benchmark (fase 0)

A tela de modelos (`/transcription`) tem uma secao de benchmark visivel em
desenvolvimento ou quando `EXPO_PUBLIC_ANALYSIS_BENCHMARK=1` (perfil `preview`),
sempre com `EXPO_PUBLIC_LOCAL_ANALYSIS=1`. Ela usa as notas reais do aparelho e
mede:

- tempo de carga do modelo
- tempo por nota
- JSON valido ou invalido
- tokens/s de prompt e de geracao
- leitura gerada

Para cada modelo, anotar:

- tempo medio por nota
- taxa de JSON valido
- pico de memoria (via `adb shell dumpsys meminfo`)
- esquentamento e consumo de bateria
- qualidade subjetiva das tags/pessoas/lugares/eventos

O catalogo definitivo e os thresholds de RAM saem desse benchmark.

## Fluxo

```
nota -> hash do conteudo -> fila -> llama.rn -> JSON validado
     -> SQLite (note_analyses) -> ficha, historico e busca
     -> (opcional) PUT no servidor para nao regerar
```

## Proximas fases

1. Fundacao: analise manual e ficha da nota feitas; falta a tabela
   `note_analyses` com hash de conteudo e a fila.
2. Historico: importar analises do servidor, backfill, tela Sentimentos,
   cartao no Painel e busca por tags.
3. Servidor: `PUT /api/v1/entries/{id}/analysis`, first-wins por hash e
   endpoint em lote para importar o historico.
4. Modos: automatico, carregador, baixo consumo, backup das analises.
5. Gancho comercial: `requiresPlan`, aviso de nota longa e plano futuro.
