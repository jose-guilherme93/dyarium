# Resumos de projetos

O caderno protegido `Projetos` (`projetos-mcp`) recebe o trabalho de sessoes de
IA por dois caminhos:

- **Sessao com diretorio** — `session_open` e `session_close`, chamadas pelo
  cliente MCP enquanto trabalha numa pasta. Uma entry por **(maquina, caminho)**;
  uma nota por **sessao**. A session e identificada pelo id que o cliente manda
  (no OpenCode, `_meta["ai.opencode/sessionID"]`) ou por um id gerado no
  `session_open`.
- **Projeto sem diretorio** — `record_project_summary`, para trabalho que nao
  vem de uma pasta (uma entrega, uma conversa, outro cliente). Uma entry por nome
  e uma nota por entry, com um bloco anexado a cada chamada (formato v1).

Cada nota de sessao tem duas partes:

1. **Bloco humano** — o que o usuario le: `## data hora · maquina`, o resumo
   objetivo, um item por linha (`- **feat** titulo · [commit](url)`) e o
   `:::details` de detalhes tecnicos.
2. **Fence canonico** — o mesmo conteudo em JSON, de uma linha, dentro de um
   bloco cercado com a linguagem `dyarium-json`. E dele que sai a tabela e a
   arvore dos clientes. O fence nunca e editado a mao e nao aparece na leitura.

A nota continua sendo markdown e continua sincronizando como qualquer nota: nao
existe tabela de sessoes no servidor. O estado da sessao e derivado do fence e da
data de atualizacao da nota, no cliente.

## Contrato do fence v2 (nota de sessao)

```
{"v":2,"kind":"session","machine":"work-notebook","path":"/home/joseti/projects/syncwin","session":"ses_abc","state":"open","opened":"2026-11-14T09:12:00Z","closed":"2026-11-14T17:20:00Z","date":"2026-11-14","time":"09:12","summary":"...","items":[{"kind":"feat","title":"...","detail":"...","commit":"abc1234","url":"https://..."}],"commits":[{"hash":"...","message":"...","url":"..."}],"links":[{"label":"...","url":"..."}]}
```

- Uma linha, sem indentacao, HTML nao escapado (`<`, `>`, `&` literais).
- Sempre presentes: `v` (2), `kind` (`session`), `machine`, `path`, `session`,
  `state` (`open` ou `closed`), `opened` (RFC 3339 UTC), `date` (`YYYY-MM-DD`) e
  `time` (`HH:MM` UTC, igual ao cabecalho).
- `closed` so existe com `state` `closed`.
- Opcionais: `summary`, e `detail`/`commit`/`url` de item, `url` de commit,
  `label` de link. Arrays vazios podem faltar.
- Campo desconhecido e ignorado: o cliente le o que conhece e nao quebra.

### Estado derivado

`open` com mais de **12 horas** sem atividade vira **interrompida** na leitura.
Atividade e a data de atualizacao da nota: todo `session_open`, `session_close` e
qualquer chamada com o mesmo id de sessao toca a nota sem reescrever o corpo.
Nao existe rotina periodica no servidor: o estado e calculado quando a nota e
lida, e uma nota interrompida nunca e reescrita por isso.

## Contrato do fence v1 (projeto sem diretorio)

```
{"v":1,"project":"dyarium","date":"2026-11-09","time":"14:58","host":"vps-dev","detail":"concise","summary":"...","items":[{"kind":"feat","title":"...","detail":"...","commit":"abc1234","url":"https://..."}],"commits":[{"hash":"...","message":"...","url":"..."}],"links":[{"label":"...","url":"..."}]}
```

- Uma linha, sem indentacao, HTML nao escapado (`<`, `>`, `&` literais).
- Sempre presentes: `v`, `project`, `date` (`YYYY-MM-DD`), `time` (`HH:MM` UTC,
  igual ao cabecalho), `host`, `detail` (`concise` ou `full`).
- Opcionais: `summary`, e `detail`/`commit`/`url` de item, `url` de commit,
  `label` de link. Arrays vazios podem faltar.
- Campo desconhecido e ignorado: o cliente le o que conhece e nao quebra.

## Indice derivado

Os dois clientes montam o indice lendo as notas do caderno `Projetos`:

- todo fence `dyarium-json` v2 vira uma sessao de projeto (maquina + caminho);
- todo fence `dyarium-json` v1 vira uma sessao de projeto sem diretorio;
- bloco sem fence (historico anterior a esta mudanca) e lido pelo formato
  humano: cabecalho `## data hora · host`, resumo, itens `- **kind** titulo ·
  commit` e o `:::details` com os detalhes. E leitura, nunca escrita;
- o indice e cache por caderno e e reconstruido quando o corpo de uma nota muda.

Item editado a mao que nao siga nenhum dos dois formatos simplesmente nao entra
na tabela: o markdown continua legivel e nada e corrompido.

## Superficie

Notebook de `kind = mcp` abre a superficie **Projetos**: uma arvore a esquerda e
a leitura da nota a direita.

A arvore agrupa por **maquina + caminho completo**:

- no de maquina (`machine`), com o total de sessoes;
- no de pasta so quando aquele caminho tem **duas ou mais** sessoes; o rotulo
  sao os dois ultimos segmentos do caminho, o caminho completo fica no `title`;
- sessao de pasta unica aparece como linha solta, com o caminho na segunda
  linha, para o projeto nao sumir da vista;
- as guias desenham a hierarquia (uma linha por nivel e um cotovelo por no),
  nunca caracteres de desenho de caixa;
- o mesmo caminho em maquinas diferentes sao dois nos, nunca um;
- projeto sem pasta (fence v1, de `record_project_summary`) fica num grupo
  `sem pasta` acima das maquinas, recolhido quando tem mais de um, para nada do
  que ja foi registrado desaparecer da vista.

A leitura mostra a nota da sessao selecionada: caminho em mono como titulo, o
nome da sessao como subtitulo, o resumo, a tabela de itens e, no fim, os graficos
— colunas por dia de calendario na sessao (dia sem item continua slot vazio) e
linha de atividade no agregado da pasta. O fence fica oculto. A nota continua
editavel como markdown.

No no de pasta a leitura vira o agregado: sessoes, itens e commits em numero,
composicao por kind, atividade por dia e a lista das sessoes.

A visao **Itens** (uma linha por item, com filtro de projeto, kind e periodo)
continua disponivel sobre o mesmo indice, escopada ao no selecionado.

## No app

O app entrega a mesma superficie em linguagem nativa (`mobile/src/app/projects.tsx`):

- **Itens** vira lista de cartoes por sessao (nao cabe tabela de colunas em 360dp);
- **Projetos** mantem a linha com icone, ultimo trabalho, numero de itens, barra por
  kind e status por recencia, com as sessoes expansíveis;
- o parser e o mesmo modulo (`mobile/src/core/projetoLog.ts`), lido do SQLite local;
- o icone do projeto e o campo `icon` da entry, sincronizado como qualquer campo.

Nota com tabela continua legivel no app: o `noteDocument` separa o bloco de tabela
em um no proprio (`NoteTable`) que guarda o markdown original. Tabela e
somente-leitura; a edicao abre uma folha com o markdown cru e devolve o texto ao
no de tabela. O editor rich-text (`react-native-enriched-html`) nao conhece
`<table>` e nunca recebe o bloco — e o que impede a tabela de ser achatada e os
pipes de serem perdidos ao salvar.

## Botoes de acao

Um botao e dado, nao codigo: `{ id, label, icon, command, params }`. O comando
vem de uma lista fechada e os dois clientes implementam a mesma semantica. A v1
e de leitura e navegacao (filtrar, agrupar, abrir detalhe, inserir snapshot,
copiar link). Nenhum script e executado a partir do documento.
