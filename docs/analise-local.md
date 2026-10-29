# Analise local de sentimentos

Plano e decisoes da analise de notas no proprio aparelho. O objetivo e extrair
sentimento, emocoes, temas, pessoas, lugares, eventos, decisoes, tarefas e ideias
sem depender do servidor, mantendo um historico de meses e anos.

## Decisoes

- Local-first independente: o resultado local e a fonte principal do historico.
- **O contrato da analise nao depende do modelo.** Todo modelo do catalogo
  devolve o mesmo documento; o que varia e a cobertura (quantos blocos foram
  lidos), nunca o significado de "analise".
- First-wins por versao de conteudo: `texto + transcricao` viram um hash; o
  primeiro resultado completo para aquele hash vence e nao e regerado.
- Se o servidor ja tem transcricao ou analise, o app importa em vez de gerar.
- Se o app gerou primeiro, o servidor recebe apenas o JSON derivado, nunca texto
  bruto. Analise parcial nao sobe: o servidor grava a primeira analise que chega.
- Transcricao em andamento (`transcriptStatus: pending`) nao sobe. Uma versao
  local com menos de 80% do texto que ja esta no servidor tambem nao substitui a
  completa.
- A analise e enxuta: metricas e listas, com **uma** frase de leitura por nota.
- Tags sao tipadas: pessoa, lugar, tema e evento.
- O historico usa a data da nota, nao a data da analise.
- Analise padrao sob demanda; automatica e no carregador sao opcionais.
- Nada de `expo-insights` por enquanto: o conteudo e privado e nao sai do
  aparelho.

## Contrato da analise

A nota e lida **bloco por bloco**: um paragrafo do texto escrito, ou a frase
entre duas pausas na fala. Cada bloco e uma chamada curta ao modelo e devolve
sempre os mesmos campos:

```json
{
  "tom": -40,
  "pessoas": [{ "nome": "Ana" }],
  "lugares": [{ "nome": "casa da minha mae" }],
  "emocoes": ["luto", "saudade"],
  "temas": ["familia", "viagem"],
  "eventos": ["enterro da Ana"],
  "decisoes": ["vou viajar em julho"],
  "tarefas": ["comprar a passagem"],
  "ideias": [],
  "epifanias": ["nunca falei com ela o que eu sentia"],
  "momentos": ["Fui ao enterro da Ana"]
}
```

- Lista vazia e o "nao": nao existe campo booleano separado.
- `tom` e um inteiro de -100 a 100; o rotulo (`positivo`, `neutro`, `negativo`) e
  derivado no codigo para o modelo nao poder contradizer o proprio numero.
- Emocoes e temas sao **listas fechadas**: 20 emocoes e os 11 temas que o
  servidor ja usa (`internal/analyze/types.go`). Emocao livre fragmenta o painel
  em "alegria", "felicidade" e "contente" como se fossem tres coisas.
- Pessoas, lugares e momentos precisam existir literalmente no bloco (sem
  acento, caixa ou pontuacao), como **nome inteiro**: "Ana" nao casa com
  "semana". O que o modelo inventar e descartado antes de entrar no documento, e
  o descarte fica contado no diagnostico.
- Todo item de texto (evento, decisao, tarefa, ideia, epifania e momento) precisa
  de **peso de evidencia >= 0.85**: a fracao das palavras de conteudo dele que
  existem no bloco. Abaixo disso o item nao entra, por mais confiante que o
  modelo pareca. `MIN_EVIDENCE` fica em `core/analysisChunk.ts`.
- O modelo pequeno costuma devolver a palavra no lugar do nome fechado. O
  parser aceita sinônimos comuns ("feliz" vira `alegria`, "triste" vira
  `tristeza`, "emprego" vira `trabalho`) e tambem o tom como texto
  ("negativo" vira -50). Isso aumenta o que entra no painel sem inventar: o
  valor final continua sendo um dos 20 emocoes / 11 temas.
- Se o modelo ignorar o schema, as chaves em ingles (`tone`, `people`,
  `emotions`, `themes`...) tambem sao lidas.
- Se o bloco voltar valido mas sem nenhum item, uma terceira tentativa usa um
  prompt curto, com o mesmo contrato e o mesmo schema. E o que salva um bloco
  com um modelo de 230M, que se perde no prompt longo. Bloco com menos de 12
  palavras de conteudo nao paga a chamada extra.
- O prompt do bloco nao traz um objeto de exemplo. Um exemplo com nomes fazia
  o modelo repetir "Ana" em toda nota; um exemplo vazio fazia modelos menores
  copiarem o JSON vazio inteiro, mesmo quando o bloco tinha gente e emocoes
  claras. As chaves e os limites ficam descritos em prosa, o parser aceita JSON
  dentro de markdown e listas vazias continuam validas. A versao do prompt do
  bloco sobe junto com essas regras (6) e analises antigas aparecem como
  desatualizadas.
- Decisao, tarefa e ideia tem definicoes objetivas: decisao e escolha feita ou
  anunciada ("decidi", "nao vou mais"); tarefa e obrigacao ou pendencia
  ("preciso", "tenho que"); ideia e proposta ou possibilidade ("pensei em",
  "que tal"). Uma frase entra em uma lista so.
- Evento e o acontecimento objetivo ("enterro da Ana", "viagem para Minas"),
  diferente do momento, que e a cena marcante.
- Epifania e a percepcao ou conclusao que muda o entendimento do autor ("percebi
  que", "entendi que", "caiu a ficha"). Nao se repete em ideia: a mesma frase
  entra em uma lista so.
- O modelo nunca escreve tempo, contagem, intensidade nem confianca. O tempo do
  momento vem dos segmentos do whisper; a contagem de mencoes, a intensidade da
  emocao (participacao nos blocos) e a confianca do tema (frequencia) sao
  calculadas.

O documento da nota junta os blocos:

| campo | como sai |
|---|---|
| tom | media ponderada pelo tamanho dos blocos |
| emocoes | blocos em que aparecem / blocos lidos, e tom medio |
| pessoas | grafia canonica, mencoes literais, blocos, tom medio, primeiro e ultimo instante |
| lugares | o mesmo, sem tom |
| temas | numero de blocos |
| eventos, decisoes, tarefas, ideias, epifanias | frases deduplicadas, com o bloco e o instante da primeira ocorrencia |
| momentos | no maximo 8, os mais salientes e espalhados pela nota, com `start_ms` da fala |
| cobertura | blocos lidos / total, caracteres e minutos de audio |

Antes de compor, o app canoniza nomes contra as grafias que ele ja conhece
(analises anteriores): "maria" e "Dona Maria" viram "Maria", sem criar duas
pessoas.

### A frase

A unica geracao de texto livre da analise. Uma chamada por nota, com entrada de
tamanho fixo — titulo, tom, ate 5 pessoas com contagem, 3 lugares, 3 temas, 3
eventos, decisoes/tarefas/epifanias, 3 momentos, o trecho mais saliente (ate 400
caracteres) e o fim da nota. Por isso a frase nao depende do tamanho da nota nem
da janela do modelo.

A frase e uma interpretacao em terceira pessoa, no maximo 24 palavras, e nomeia
o sujeito quando ha uma pessoa dominante ("uma despedida anunciada pelo autor,
sobre Ana"). Se copiar o trecho, passar do limite ou vier vazia, o codigo escreve
uma frase derivada dos campos e marca `sentence_source: "derived"` na ficha.

## Runtime e modelos

Runtime: `llama.rn` (llama.cpp/GGUF), Android arm64, New Architecture, saida
estruturada por JSON Schema/GBNF.

### Texto puro antes do modelo

Antes do plano de leitura, o texto passa por `toAnalysisText`
(`src/core/analysisText.ts`) e, no servidor, por `analyze.CleanText`
(`internal/analyze/clean.go`). As regras sao as mesmas dos dois lados: fora
tags e entidades HTML, `script`/`style`, cercas e blocos de codigo, tabelas,
imagens, marcadores de audio, links e URLs, carimbos de tempo, emojis, marcas
invisiveis, caracteres de controle e linhas que so tem simbolo. Paragrafos
continuam separados, porque sao a unidade do bloco.

O texto salvo e a revisao nao mudam: a limpeza vale so para a copia que entra no
prompt. Menos tokens por bloco, menos ruido e uma ancoragem de 0.85 mais
confiavel (palavra de HTML nao passa mais por nome ou frase).

Catalogo (revisao fixa no Hugging Face, download em runtime). Todos rodam so
na CPU (`n_gpu_layers: 0`); os maiores sao bem mais lentos. Cada familia tem
duas quants, e a tela mostra **uma entrada por familia** com um interruptor
**Rapida / Qualidade**; o usuario nao escolhe arquivo. A qualidade e o padrao
sempre que a RAM permite, porque a versao rapida do modelo menor nao extrai o
contrato inteiro.

| familia | rapida (Q4_0) | qualidade (Q5_K_M) | RAM minima |
|---|---|---|---|
| LFM2.5 230M | QAD-Q4_0 ~149 MB | Q5_K_M ~172 MB | 3 GB / 5 GB |
| Qwen3.5 0.8B | Q4_0 ~507 MB | Q5_K_M ~590 MB | 5 GB / 6 GB |
| Qwen3.5 2B | Q4_0 ~1.2 GB | Q5_K_M ~1.4 GB | 10 GB / 11 GB |
| LFM2.5 2.6B | Q4_0 ~1.6 GB | Q5_K_M ~1.9 GB | 12 GB / 14 GB |

O 230M e o ultimo recurso: e o menor arquivo e o mais rapido, mas tambem o que
menos reconhece pessoas, emocoes e frases. Para uma nota real, a recomendacao
comeca no 0.8B qualidade assim que a RAM permite.

Vocabulario pesa tanto quanto parametro: o Qwen3.5 tem 248 mil tokens de
vocabulario, o LFM2.5 tem 65 mil. A cada token gerado o Qwen calcula logits
sobre quase quatro vezes mais tokens; por isso o 230M pode ser mais rapido que
o 0.8B no nosso caso, mesmo tendo um terco dos parametros. O LFM2.5-230M foi
feito para on-device e cobre portugues.

Licencas: Qwen3.5 e Apache-2.0. LFM2.5 usa a LFM Open License v1.0
(`huggingface.co/LiquidAI/LFM2.5-230M-GGUF/blob/main/LICENSE`): uso livre
enquanto a entidade nao passar de US$ 10 milhoes de receita anual; acima disso
exige licenca comercial. A tela de modelos mostra a licenca de cada arquivo.

A tela de modelos mostra a RAM minima de cada um e avisa quando o aparelho tem
menos que o necessario. O botao da nota tem o modo **Menos CPU** (1 thread em
vez de 2). Durante a passada a ficha mostra tempo, tokens/s (CPU), bateria e
"bloco 12 de 34"; ao terminar, o resumo da ultima execucao.

O modelo recomendado e a qualidade da familia mais capaz que cabe na RAM total
do aparelho; so cai para a versao rapida quando a RAM nao comporta a qualidade.
Abaixo de 3 GB nao ha recomendacao local. O limite nao e so um aviso: um modelo abaixo
do minimo de RAM do catalogo nao e carregado.

### Limites de memoria e concorrencia

- Uma passada pesada por vez: revisao e analise compartilham a fila de
  `services/heavyWork.ts` com a transcricao.
- Um motor por vez: antes de carregar o llama, o contexto do whisper e liberado
  (e o contrario tambem vale).
- Depois de 20 s sem geracao, o contexto do llama e liberado. Blocos
  consecutivos chegam antes disso e reaproveitam o modelo.
- A inferencia usa no maximo 2 threads (1 no modo **Menos CPU**).
- O contexto do modelo e 2048 tokens: cada chamada le um bloco de ate 900
  caracteres, nao a nota. Nota longa nao estoura a janela; vira mais blocos.
- Com o app em segundo plano, o servico em primeiro plano segura um wake lock
  parcial e a notificacao e atualizada sem reabrir o servico. Fechar o app nao
  interrompe a passada; se o Android encerrar o processo, cada bloco ja lido
  esta em `analysis_chunks` e o proximo **Analisar nota** retoma dali.
- A interface nao paga por token: o `llama.rn` roda sem callback de token e o
  progresso chega por bloco. A tela da nota nao tem relogio; o tempo ao vivo, a
  bateria e o contador sobem so na tela de analise, e so com ela aberta.
- Entre dois blocos a passada devolve a vez para a thread de JS
  (`setTimeout(0)`). Digitar, rolar e navegar continuam respondendo durante a
  analise; com a tela de analise fechada nenhum estado de andamento e
  publicado na nota.

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

A tela de modelos e o benchmark aparecem no Metro com:

```
EXPO_PUBLIC_LOCAL_ANALYSIS=1 npx expo start
```

Os perfis do EAS ja definem a variavel; o benchmark continua exigindo
`EXPO_PUBLIC_ANALYSIS_BENCHMARK=1` no `preview`.

## Quem analisa

A analise segue os mesmos tres interruptores da transcricao (Opcoes > Processamento):
ligada/desligada e, quando ha servidor, aparelho ou servidor. Com **Processar no servidor**
ligado, o app nao inicia analise local: a nota espera o resultado do servidor, e o upload
leva `local_analysis` para o servidor nao enfileirar quando a etapa e do cliente.

Analise desligada nao e erro nem pendencia: a nota simplesmente nao recebe analise, e nada
na interface cobra isso. O botao do menu so aparece quando a analise roda no aparelho.

Analise completa feita no aparelho **sobe** para o servidor por
`PUT /api/v1/entries/{id}/analysis`, com origem `app`. Sem `replace`, o servidor so grava
se ainda nao tiver analise daquela nota (o sync nunca sobrescreve); refazer no app manda
`replace: true`. Na primeira conexao o app faz backfill das analises locais das notas que
ja existem no servidor.

## Analise manual no aparelho

A analise tem **tela propria**, aberta pelo botao de IA (sparkles) da nota; os
tres pontinhos ficam so com as configuracoes da nota. Na tela da analise o
botao e **Analisar nota** — o mesmo retoma uma analise parcial. Ao lado do
modelo ha **Trocar modelo**, que abre a tela de modelos. Quando a analise esta
configurada para o servidor, o botao e **Analisar no servidor** (ver abaixo).
O processamento (transcrever/analisar/servidor) abre por uma linha no fim da
mesma tela. A passada:

- usa o titulo e o texto que estao na tela (nao a copia salva na biblioteca)
  e a transcricao mais nova do banco, juntando todos os audios da nota;
- roda a revisao da transcricao antes, quando ela esta ligada: e o texto
  revisado que a analise le;
- divide a nota em blocos: paragrafos do texto escrito (com o titulo markdown) e
  frases entre pausas na fala, com o tempo de cada bloco. Paragrafo curto funde
  com o vizinho; paragrafo acima de 900 caracteres quebra em frases inteiras;
- le cada bloco com o contrato acima, ancora a resposta no texto do bloco e
  grava o resultado no SQLite (`analysis_chunks`) antes de seguir. Parar no meio
  nao perde trabalho; um bloco que falha e tentado de novo com mais tokens antes
  de ficar para a proxima passada;
- compoe o documento a cada bloco e **mostra na ficha na hora**: os campos vao
  aparecendo enquanto o modelo trabalha, junto do medidor e do numero de blocos;
- ao lado do indicador a ficha escreve o que esta acontecendo ("Carregando
  modelo...", "Definindo pesos...", "Pensando melhor sobre as pessoas...",
  "Avaliando os lugares...", "Entendendo as emoções...") e o contador de blocos.
  A frase muda ao longo da passada; a analise no servidor usa a mesma linha,
  avancando pelo tempo de espera e mostrando o tempo decorrido;
- com outra analise pesada na frente, a ficha mostra **Na fila** ate chegar a
  vez; a atividade nasce antes da fila, entao o centro de atividade tambem
  mostra a espera;
- continua mesmo quando o usuario sai da nota: o servico em primeiro plano
  segura a passada ate o fim, porque o tempo gasto precisa virar resultado;
- escreve **uma** frase no fim, a partir do documento composto (nunca da nota
  inteira);
- fotos ainda nao sao interpretadas: o modelo local e de texto;
- nenhuma chamada de rede durante a analise.

A ficha mostra:

- o medidor de cobertura e o numero de blocos lidos ("34/34 blocos"); uma
  analise interrompida aparece como **parcial** e o mesmo botao **Analisar nota**
  continua dali, lendo so os blocos que faltam (e os que foram recusados), sem
  refazer o que ja estava certo;
- pessoas com a contagem de mencoes, lugares, temas, emocoes com a participacao,
  eventos, decisoes, tarefas, ideias, epifanias e momentos com o tempo no audio;
- a frase da nota; quando ela foi derivada dos campos, a linha "frase derivada".
  Uma frase que cita nome proprio fora dos dados (por exemplo, um nome que o
  modelo copiou de exemplo) tambem cai na derivada;
- a cobertura tambem vale para nota longa: a nota nao e mais cortada em 6.000
  caracteres, ela vira mais blocos, todos lidos.

Enquanto o cache local ainda esta sendo lido, a ficha mostra um marcador de
carregamento em vez de "sem analise": nada pisca antes de o banco responder.

## Analise no servidor

Quando o interruptor de analise esta ligado e o processamento escolhido e o
servidor, a ficha mostra **Analisar no servidor**. O botao so aparece quando a
nota ja tem `entryId` e ha servidor configurado; o pedido leva apenas o id da
entrada, nenhum texto.

- O servidor valida o provedor antes de enfileirar: 409 quando a analise esta
  desligada la, 502 quando o provedor nao responde, 404 quando a nota ainda nao
  subiu. A ficha mostra a mensagem sem detalhe tecnico.
- A analise roda no servidor e o app consulta **so esta entrada** enquanto a
  nota esta aberta (a cada 5 s, por ate 3 minutos); se o app sair, o pull
  seguinte traz o resultado.
- O resultado entra pelo mesmo caminho do sync: e guardado no banco e mostrado a
  partir dali. A lista de entradas traz `analysis_at` e `transcript_at`, os
  sinais de atualizacao; quando eles mudam, o app busca uma vez
  (`analysis_sync` e `transcript_sync` guardam o ultimo valor) e nao pede de novo
  so para exibir. Transcricao e revisao vindas do servidor seguem a mesma regra.
- Analise feita no aparelho vence a do servidor: quando ja existe uma local, o
  sync so marca o sinal e nao baixa nada.

Cada bloco guarda um hash de `texto + contexto`. Se a nota ou o contexto
mudarem (inclusive uma revisao nova da transcricao), so aquele bloco e lido de
novo. A analise guarda o hash de `titulo + texto + transcricao` e a ficha avisa
quando ela e de uma versao anterior.

Sem analise utilizavel (nenhum bloco lido), a nota **nao** recebe uma analise
falsa: a mensagem e generica e o botao continua ali para tentar de novo. A
leitura simplificada por palavras (`local-fallback`) nao e analise: nao sobe ao
servidor e nao entra na serie de sentimento do painel.

Antes do upload a analise e chaveada pelo id local da nota; quando o `entryId`
chega, a linha e movida para a chave definitiva. Nenhum texto bruto, audio ou
transcricao sai do aparelho nesse caminho.

## Revisao da transcricao

Antes de analisar, o app pode limpar a transcricao com o mesmo modelo local. O
whisper escuta o audio; a revisao so corrige a lingua (ortografia, concordancia,
pontuacao, reticencias, siglas ambiguas) e preserva o jeito de falar. A ligacao
fica em **Ajustes > Transcricao e modelos**, desligada por padrao, e e separada
da opcao do dashboard.

- O texto original de cada trecho continua em `text`; o derivado fica em
  `revised` no mesmo JSON de segmentos. O leitor mostra o revisado e o
  **Transcricao completa** revela o original num toque no icone.
- Janelas de 2 trechos nos modelos mais leves do catalogo e de 3 nos demais, com
  o trecho anterior como contexto. Contagem diferente, JSON invalido ou guardrail
  recusado mantem o trecho como estava; as outras janelas seguem.
- As travas sao as mesmas do servidor (`internal/review`): numeros preservados,
  tamanho entre 0,7x e 1,4x (a explicacao de sigla ganha espaco proprio), no
  maximo uma explicacao entre parenteses por trecho e similaridade minima.
- "Transcricao literal" mantem hesitacoes ("ee", "hum") e gagueira; desligada,
  so o que nao tem significado sai. "tipo", "ne" e girias ficam sempre.
- Trecho editado a mao ganha `edited` e sai da revisao para sempre.
- A ficha da analise ganha **compreensao logica** (0-100, estimada sobre o texto
  cru) e as taxas de gagueira e hesitacao por 100 palavras. Sem a revisao, a
  ficha marca "sem revisao".
- A revisao sobe ao servidor pelo `PUT /entries/{id}/transcript/revisions`; se o
  servidor ja revisou a nota, o aparelho reaproveita (mesma versao de prompt,
  modo e texto) em vez de gastar bateria.
- O chip usa o estado da passada para distinguir "revisando agora" de "passada
  interrompida": uma passada parada aparece com icone de pausa e o botao de
  continuar de onde parou (inclusive a que foi cancelada no servidor).
- Uma passada interrompida (app morto no meio) retoma no boot do primeiro trecho
  que faltou. A compreensao ja medida e os indices recusados continuam valendo,
  para a media final nao refletir so as ultimas janelas.
- Transcricao que veio do servidor e marcada com `transcriptOrigin: 'server'` e
  nao e reenviada como se tivesse sido transcrita no aparelho.

## Build verificado

O development build v9 (versionCode 9) inclui o `librnllama.so` base via
`plugins/withLlamaBaseLib`, junto das variantes restritas. A pendencia de "JSI
bindings not installed" do build v8 esta resolvida.

## Benchmark (fase 0)

A tela de modelos (`/transcription`) tem uma secao de benchmark visivel em
desenvolvimento ou quando `EXPO_PUBLIC_ANALYSIS_BENCHMARK=1` (perfil `preview`),
sempre com `EXPO_PUBLIC_LOCAL_ANALYSIS=1`. Ela usa as notas reais do aparelho e
mede, por nota, a passada completa por blocos:

- tempo total e por bloco
- blocos lidos / total e blocos recusados
- campos extraidos (pessoas, lugares, temas, eventos, decisoes, tarefas, ideias,
  momentos) e a frase
- tokens/s de prompt e de geracao

Para cada modelo, anotar:

- tempo medio por bloco e por nota
- taxa de blocos recusados
- pico de memoria (via `adb shell dumpsys meminfo`)
- esquentamento e consumo de bateria
- qualidade subjetiva dos campos

O catalogo definitivo e os thresholds de RAM saem desse benchmark. O benchmark
nao grava blocos (`persist: false`), entao rodar com varios modelos nao mistura
o cache de uma nota.

## Fluxo

```
nota -> plano de blocos (paragrafos / pausas) -> fila -> llama.rn, um bloco por chamada
     -> contrato do bloco validado e ancorado -> analysis_chunks (SQLite)
     -> composicao deterministica -> uma frase -> analyses -> ficha, historico e busca
     -> (se completa) PUT no servidor para nao regerar
```

## Proximas fases

1. Fundacao: analise por bloco, documento composto, cobertura e Continuar feitos.
2. Historico: importar analises do servidor, backfill, tela Sentimentos,
   cartao no Painel e busca por tags.
3. Servidor: `PUT /api/v1/entries/{id}/analysis` com tarefas, ideias, eventos e
   cobertura; endpoint em lote para importar o historico.
4. Modos: automatico, carregador, baixo consumo, backup das analises.
5. Gancho comercial: `requiresPlan` e aviso de nota longa.

## Worker opcional no navegador

O dashboard pode processar as mesmas notas no computador do usuario. E um terceiro
modo, aditivo: sem a aba aberta nada muda, e a VPS continua transcrevendo e analisando
como hoje.

- **Nucleo compartilhado**: o worker importa `mobile/src/core` (`analysisPlan`,
  `analysisChunk`, `analysisCompose`, `analysisSummary`, `analysisText`, `analysis`).
  Nao existe copia do contrato: qualquer mudanca de prompt ou parser vale para o app e
  para o navegador ao mesmo tempo. O `web` nao depende de React Native nesses arquivos.
- **Modelos**: Whisper em ONNX pelo `transformers.js` (WASM, e WebGPU quando o navegador
  oferece) e o mesmo catalogo de GGUFs do app pelo `wllama` (llama.cpp em WASM, com
  offload de GPU quando o runtime suporta). O laboratorio mostra o tamanho de cada
  arquivo e o total antes do download; quem baixa e o navegador, para o cache local.
- **Runtime proprio**: o wasm do ONNX Runtime e servido pelo dashboard em `/ort/`, nao
  pelo jsDelivr. Uma aba que executa script de terceiros poderia ler o token e o texto
  das notas; os pesos do Hugging Face sao os unicos downloads externos.
- **Perfis**: 0 (CPU/WebAssembly, Whisper base + LFM 230M), 1 (Intel HD, small + Qwen
  0.8B), 2 (3-4 GB de VRAM, small + Qwen 2B), 3 (RX 580 8 GB, large-v3-turbo + LFM 2.6B)
  e 4 (12 GB+, large-v3-turbo + Qwen2.5 7B em dois shards). A VRAM nao e exposta pelo
  navegador: a escolha combina o renderer WebGL, o `adapter.info`, uma tabela de placas,
  a RAM aproximada e, no laboratorio, o teste de alocacao. O usuario pode descer de
  perfil.
- **Privacidade**: os modelos rodam no PC; a VPS nao processa esses jobs e so recebe
  texto, JSON e metadados. O audio continua sendo decifrado no servidor para o
  streaming autenticado, exatamente como no player. Nao ha chamada a API de IA.
- **Ativacao**: o interruptor **neste PC** fica no painel da nota, ao lado de
  **Analisar** (a unica acao de analise). Ele mede o hardware, mostra o download e liga o
  worker. Ligar nao enfileira nem reserva nada: sem um clique em **Analisar**, o PC fica
  ocioso e a VPS segue a fila. Analisar pede a nota aberta (claim restrito aquela entrada)
  e substitui a analise existente. A seta ao lado abre `/lab`, e **Voltar** devolve a nota.
- **Andamento**: o painel mostra bloco lido, medidor, tempo e tok/s do worker da aba. Se o
  PC estiver lento, **no servidor** libera o job (`/worker/release`) e desliga o worker; a
  VPS assume na hora, sem esperar o lease.
- **Aparelho**: a analise feita aqui guarda `device_id` (anonimo, estavel por instalacao do
  navegador) e `device_name` (navegador, sistema e placa). O painel mostra o nome; nao e
  hostname, que o navegador nao expoe.
- **Nucleos**: o llama.cpp usa todos os nucleos por padrao (`navigator.hardwareConcurrency`);
  o laboratorio oferece **Metade** para quem precisa da maquina respondendo. Sem
  `SharedArrayBuffer` o motor fica em uma thread de qualquer forma, e a tela diz isso.
- **Fila**: o worker usa a fila duravel existente com `worker_id` proprio, lease de
  120 s e heartbeat de 20 s. Presenca de 60 s; quando ela expira, o servidor reassume.
  A preferencia que pausa o servidor dura so o pedido local; entre um clique e outro a
  VPS processa normalmente. Tarefas de `cleanup` nunca saem do servidor.
- **Retomada**: cada bloco lido fica no IndexedDB com hash, versao do prompt e modelo.
  Fechar a aba no meio nao perde o que ja foi lido; a nota que estava em curso volta
  para a fila quando o lease expira.

### Limites conhecidos

- O navegador usa o contrato do app (extracao por bloco, composicao deterministica e
  uma frase). Ele nao reproduz a leitura secao a secao que o worker do servidor
  escreve em `reading`/`sections`: essa passada vive em `internal/analyze` e ainda
  nao tem um prompt compartilhado. A cobertura e os campos extraidos sao os mesmos.
- A revisao da transcricao continua sendo uma etapa do servidor. Nota transcrita no
  navegador vai para a analise com o texto cru; se a revisao estiver ligada, ela roda
  quando o servidor assumir a nota. Para qualidade maxima, rode a revisao antes.
- O `wllama` le arquivos de ate 2 GB em um shard; o 7B e baixado em dois shards.
- O perfil 4 usa Qwen2.5 7B porque e o GGUF 7B publicado em shards; os perfis menores
  usam as familias Qwen3.5/LFM do app. Qwen3.5 e LFM2.5 podem gastar o teto de tokens
  raciocinando; o worker manda `enable_thinking`/`preserve_thinking: false` no template.
  O Qwen2.5 do perfil 4 nao raciocina, entao e o caminho mais previsivel para analise.
- Todo modelo tem revisao fixa e os SHA-256 dos shards estao no catalogo. A
  verificacao por arquivo no navegador ainda nao roda: o Web Crypto nao calcula
  SHA-256 de forma incremental e ler 2-5 GB na memoria para conferir derrubaria a
  aba. A integridade imediata vem do HTTPS + revisao fixa; o hash fica para um
  gerenciador de download em streaming.
- A rota `/lab` manda `COOP`/`COEP`, entao `SharedArrayBuffer` fica disponivel e o
  llama.cpp usa os nucleos configurados. O ONNX Runtime do Whisper roda com uma thread
  de proposito: em um Web Worker o pool de threads trava a criacao da sessao. A GPU
  (WebGPU) e o caminho rapido da transcricao no Edge/Chrome; no Firefox a analise cai
  para a CPU e a transcricao usa a GPU quando a versao ja expoe WebGPU.
- O download inicial e grande por desenho: o perfil 4 chega perto de 6 GB. A tela
  informa o total e so comeca depois da confirmacao.
- Em contexto inseguro (HTTP por IP, como o dev server) nao existem OPFS nem
  `crypto.subtle`: o `wllama` nao encontra backend de cache e aborta com
  `No supported storage backend found`. Nesse caso o worker baixa o GGUF em
  streaming e entrega os blobs na memoria: o modo funciona, mas o download se repete
  a cada inicio. Com HTTPS o modelo fica no OPFS e o download e unico.
- Sem `SharedArrayBuffer` (HTTP) o llama.cpp fica em uma thread: a recomendacao cai para
  o perfil minimo e o laboratorio avisa. Numa maquina fraca, prefira o servidor ou rode o
  dashboard em HTTPS. A WebGPU tambem exige contexto seguro: o laboratorio mostra
  `não · HTTPS` em vez de `não`, para nao parecer falta de suporte do navegador.
