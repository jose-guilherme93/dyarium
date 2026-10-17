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

Catalogo inicial (revisao fixa no Hugging Face, download em runtime):

| id | modelo | Q4_K_M | RAM minima |
|---|---|---|---|
| `gemma-3-270m` | Gemma 3 270M IT | ~253 MB | 3 GB |
| `qwen3-0.6b` | Qwen3 0.6B | ~397 MB | 5 GB |
| `qwen3.5-0.8b` | Qwen3.5 0.8B | ~533 MB | 7 GB |

O modelo recomendado e o mais capaz que cabe na RAM total do aparelho. Abaixo
de 3 GB nao ha recomendacao local.

O Gemma 4 E2B ficou fora da v1: o Q4_K_M tem cerca de 3,1 GB, o que e agressivo
demais para um aparelho de 8 GB com o app e o Android disputando memoria.

## Build

- Android arm64-v8a apenas (`expo-build-properties` > `android.buildArchs`).
- `llama.rn` limitado a duas variantes de CPU no EAS:
  `rnllama_v8_2,rnllama_v8_2_dotprod_i8mm` via
  `ORG_GRADLE_PROJECT_rnllamaVariants`.
- O benchmark aparece no `preview` por `EXPO_PUBLIC_ANALYSIS_BENCHMARK=1`.
- O perfil `production` nao recebe essa flag.

## Benchmark (fase 0)

A tela de modelos (`/transcription`) tem uma secao de benchmark visivel em
desenvolvimento ou quando `EXPO_PUBLIC_ANALYSIS_BENCHMARK=1` (perfil `preview`).
Ela usa as notas reais do aparelho e mede:

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

1. Fundacao: migration `note_analyses`, fila, analise manual, ficha da nota.
2. Historico: importar analises do servidor, backfill, tela Sentimentos,
   cartao no Painel e busca por tags.
3. Servidor: `PUT /api/v1/entries/{id}/analysis`, first-wins por hash e
   endpoint em lote para importar o historico.
4. Modos: automatico, carregador, baixo consumo, backup das analises.
5. Gancho comercial: `requiresPlan`, aviso de nota longa e plano futuro.
