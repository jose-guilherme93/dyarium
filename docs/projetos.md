# Resumos de projetos

O servidor MCP `record_project_summary` registra o trabalho de uma sessao de IA
no caderno protegido `Projetos` (`projetos-mcp`): uma entry por projeto, uma nota
por entry, e cada chamada anexa um bloco a essa nota.

O bloco tem duas partes:

1. **Bloco humano** — o que o usuario le: `## data hora · host`, o resumo
   objetivo, um item por linha (`- **feat** titulo · [commit](url)`) e o
   `:::details` de detalhes tecnicos.
2. **Fence canonico** — o mesmo conteudo em JSON, de uma linha, dentro de um
   bloco cercado com a linguagem `dyarium-json`. E dele que sai a tabela dos
   clientes. O fence nunca e editado a mao e nao aparece na leitura.

A nota continua sendo markdown e continua sincronizando como qualquer nota. O
fence e a unica coisa nova: nao existe tabela no servidor, nao existe campo
novo, nao existe registro paralelo. O indice da tabela e derivado no cliente.

## Contrato do fence v1

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

- todo fence `dyarium-json` valido vira uma sessao;
- bloco sem fence (historico anterior a esta mudanca) e lido pelo formato
  humano: cabecalho `## data hora · host`, resumo, itens `- **kind** titulo ·
  commit` e o `:::details` com os detalhes. E leitura, nunca escrita;
- o indice e cache por caderno e e reconstruido quando o corpo de uma nota muda.

Item editado a mao que nao siga nenhum dos dois formatos simplesmente nao entra
na tabela: o markdown continua legivel e nada e corrompido.

## Superficie

Notebook de `kind = mcp` abre a superficie **Projetos**, com duas abas:

- **Itens** — uma linha por item: projeto, titulo, kind, data, commit. Duas
  variantes, planilha densa e cartoes agrupados por sessao, com filtro de
  projeto, de kind e de periodo. Abaixo de 720px a variante cartoes e a unica.
- **Projetos** — uma linha por projeto: icone, nome, ultimo trabalho, numero de
  itens, proporcao por kind e status por recencia. Expandir mostra as sessoes,
  cada uma com um "Detalhes tecnicos" recolhivel.

A nota do projeto continua editavel como markdown. A leitura mostra a tabela do
escopo da sessao e os botoes de acao declarativos (filtrar, inserir, copiar
link); o fence fica oculto.

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
