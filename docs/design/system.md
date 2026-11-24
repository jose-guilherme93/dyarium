# Sistema de interface

Este documento fecha o sistema de design do dyarium: o que cada peça é, como ela
se comporta, o que muda entre web e app e o que uma tela migrada precisa manter.
Ele fica ao lado de `docs/design/tokens.json` e `docs/design/icons.json`, que
continuam sendo a fonte da verdade dos valores e dos desenhos.

Ordem de leitura: tokens (valores) → sistema (peças) → ficha da tela → protótipo.

## Fonte da verdade

| Arquivo | Guarda |
|---|---|
| `docs/design/tokens.json` | cor, tipo, espaço, raio, foco, controle, densidade, leitura, camadas, movimento, onda, estado |
| `docs/design/icons.json` | o desenho de cada ícone, um caminho por nome |
| `docs/design/index.html` | a galeria gerada, contrato visual das peças |
| `web/src/ui/tokens.css` | variáveis `--dy-*` do dashboard |
| `web/src/ui/iconGlyphs.ts` | caminhos dos ícones no web |
| `mobile/src/theme/design.ts` | os mesmos valores tipados para o app |

Nada disso se edita à mão: `make tokens` grava, `make test-tokens` falha quando
qualquer arquivo gerado ficou para trás. A galeria abre em
`docs/design/index.html`.

## Princípios

1. Cor só significa estado. Nenhuma cor decorativa, nenhuma cor de marca em
   título.
2. Estado aparece por forma antes de cor: disco cheio é feito, anel vazio é não
   feito, anel com traço é ficou de fora.
3. Separação por hairline de 1px e degrau tonal. Sem sombra difusa, sem
   gradiente, sem brilho.
4. Texto visível só para nome de nota, rótulo de uma a três palavras, número e
   erro acionável. Explicação mora atrás de um toque.
5. **Paridade obrigatória**: a tela migrada mostra tudo que a tela atual mostra.
   Data, hora, pausa, filtros, menus e atalhos continuam; só a forma muda.
6. Nenhum emoji em código, interface, log ou documentação.

## Tipografia

Schibsted Grotesk em tudo, exceto leitura longa.

| Papel | Tamanho / peso | Onde |
|---|---|---|
| saudação | 48 / 600, entrelinha 1.05 | só no início do web |
| display | 21 / 600 | título de tela, título de livro |
| título | 17 / 600 | nome de nota aberta, cabeçalho de seção |
| corpo | 13 / 500 | texto de nota, rótulo de lista |
| rótulo | 10 / 500, caixa alta, 0.12em | cabeçalho de coluna, chip, botão |
| mono | 11.5 / 500, tabular | data, hora, duração, contagem |
| leitura | 15 / 400 serifada, entrelinha 1.45, medida 44ch | corpo de livro e leitura longa |

Peso 700 não existe. A saudação é o único tipo acima de 21 e nunca aparece no
app: o app abre nas notas.

## Cor e estado

Três paletas: claro, escuro e amoled. Além dos papéis, cada paleta declara
`overlay` para o véu de folha e diálogo.

Estados de uma peça: padrão, hover (web), pressionado, foco, desabilitado,
selecionado. Desabilitado usa `state.disabled` de opacidade e texto apagado.
Selecionado usa degrau tonal e barra de 2px de primária na borda de ataque.

Estados de uma nota (domínio): rascunho, gravando, interrompida, pronta, na fila,
enviando, enviada, falhou. A marca de forma continua valendo; o rótulo é curto.

## Forma e densidade

- Raio 2 em controle, 3 em superfície. Nada acima de 4.
- Exceções circulares, por função: o disco de gravação e o FAB. Nada mais é
  círculo.
- Foco é contorno de 1px com offset de 2px.
- Grade de espaço 2/4/6/8/12/16/24/32.
- Web trabalha com linha densa de 26 e alvo de ponteiro de 26.
- App trabalha com linha de toque de 44; o desenho do ícone continua 14 ou 16.

Medidas de layout (px, salvo indicação): página 420, medida 58ch, gutter 24,
sidebar 238, trilho 34, barra 34, aba 26, página dupla de livro 520, telefone 324.

## Camadas, movimento e aviso

| Camada | Valor | Quem fica |
|---|---|---|
| conteúdo | 0 | editor, lista, telas |
| trilho | 1 | navegação de ícones |
| barra | 2 | barra de ferramentas e abas |
| folha | 40 | folha inferior, menu ancorado |
| diálogo | 50 | diálogo modal |
| aviso | 60 | toast e aviso de fila |
| dica | 70 | tooltip |

Movimento só para estado: 90ms no curto, 160ms no base, curva
`cubic-bezier(0.2, 0, 0, 1)`. Nada decorativo, nada que atrase a leitura. Aviso
fica 6s na tela e nunca cobre ação.

## Onda

Uma barra fina por amostra visível: largura 1.5, vão 1, altura mínima 2, altura
padrão 44. A parte tocada usa primária e opacidade cheia; o resto do áudio usa
texto com opacidade 0.26. Parado, a onda vira a linha do sistema. Sem bloco
decorativo: a forma do áudio tem que ser legível.

## Ícones

Um desenho por nome, em `docs/design/icons.json`, viewBox 14, traço 1.5, canto
quadrado. O web desenha o caminho gerado; o app mapeia o mesmo nome para o
Ionicons mais próximo (`mobile/src/ui/icons.tsx`). Nome novo entra no JSON
primeiro e depois nos dois clientes.

Conjunto atual: menu, plus, back, forward, search, mic, panel, theme, more, tree,
book, grid, sync, close, chevron, check, pin, cloud, server, sort, chart, image,
link, doc, clock, bell, calendar, network, trash, play, pause, stop, gear.

Regras da barra: `gravar` é o único botão preenchido; `buscar` é ícone que abre
campo sobre a lista; painel aberto sai de fantasma para contorno mais claro.

## Peças

Cada peça abaixo tem anatomia, estados e o que muda entre web e app. A galeria
mostra o desenho; esta seção diz o comportamento.

### Botão (`Button`)

Rótulo em caixa alta, altura 20/26/30, raio 2. Variantes primária, secundária e
fantasma. Primária é a única preenchida da região. Nunca duas primárias na mesma
linha de ação. No app, alvo 44 com desenho de 30.

### Campo (`Field`)

Rótulo de 10 acima, controle de 26, fundo `surface-alt`, hairline. Foco com
contorno de 1px. Busca do web não ocupa a barra: abre sobre a lista.

### Medidor (`Meter`)

Trilho de 2, preenchimento de 2, valor em mono. Nunca mais grosso que 2: o
medidor acompanha texto, não compete com ele.

### Marca de estado (`StateMark`)

Disco cheio, anel vazio, anel com traço. Tamanho 8, traço 1.5. A cor só reforça;
a forma resolve sozinha para quem não distingue verde de vermelho.

### Linha

Web: 26 de altura, hairline embaixo, nome em corpo, data em mono à direita.
App: 44 de altura, duas linhas (nome e meta em mono), marca à esquerda e um dado
à direita. Selecionada ganha degrau tonal e barra de 2px.

### Superfície

Três degraus: `surface` (papel), `surface-alt` (chrome e lista), `surface-raised`
(peça elevada, item selecionado, folha). Toda separação é hairline; não existe
sombra.

### Chip

20 de altura (web) ou 26 (app), raio 2, rótulo de 10 em caixa alta, contorno.
Ativo usa `primary-soft` e texto cheio. Chip de status usa a cor do estado no
contorno, nunca preenchimento.

### Segmentado e abas

Segmentado escolhe janela (dia/semana/mês) e vive junto do título. Abas são notas
abertas: só nota aberta vira aba, a ativa leva 2px de primária no topo. No app,
abas não existem: a navegação é a pilha.

### Barra de ferramentas

34 de altura, fundo `surface-raised`. Esquerda: menu, nova, voltar, avançar.
Centro: caminho curto. Direita: buscar, gravar, painel, tema, mais. Ícone de 14
dentro de alvo de 26 (web) ou 44 (app). Ações destrutivas nunca ficam na barra.

### Folha e diálogo

Folha sobe do rodapé com puxador de 26x2 e itens de 44; é o padrão do app para
menu e escolha. Diálogo é central e só no web, para confirmação com campo.
Ambos usam véu `overlay` e ficam acima da barra.

### Menu ancorado

Lista curta (26/44 por item), separador hairline antes da ação destrutiva, que é
a única em `danger`.

### Aviso

Faixa no topo (fila, offline) e toast curto no rodapé. Duas linhas no máximo,
número na frente, nome da nota atrás. Aviso nunca pede confirmação.

### Vazio

Uma forma, um rótulo curto e uma ação. Sem parágrafo explicando o óbvio.

### Onda e transporte

Ver "Onda". Transporte: tocar/pausar, tempo atual em mono, trilho arrastável,
duração, velocidade. Alvos de 26 (web) e 44 (app).

### Tabela (web)

Cabeçalho em rótulo de 10, colunas fixas, linha de 26, coluna de data em mono,
coluna ordenada em texto cheio com seta. No app a tabela vira linha de 44 com a
meta embaixo: não existe tabela com rolagem lateral no telefone.

### Árvore

Uma linha vertical por nível e um cotovelo por filho. Célula de 14, trilho 6,
guia 1. O nó selecionado leva barra de 2px. Contagem à direita em mono.

### Gráfico de dias

Colunas por dia com eixo de data real, sem esticar: um dia sem nota aparece como
coluna zero. Altura 84, base 64, coluna entre 5 e 16.

### Livro e página

Capa, números em mono e capítulos agrupados por parte. No web, capítulo em página
dupla serifada com cabeço, número nas bordas e medida de 44 caracteres. No app,
folha única do tamanho do livro, com numeração. Importar EPUB entra como ação do
livro, ao lado de exportar.

### Saudação (início do web)

Só o web tem início; o app abre nas notas. Bloco centralizado, coluna de 420:
saudação pela hora do aparelho (05–11 bom dia, 12–17 boa tarde, 18–04 boa noite),
até duas frases do resumo que já é calculado sem LLM, e no máximo quatro números
(notas do mês, palavra, assunto, palavras). Ações: nova nota e análise.

As opções de importação não ficam no vazio: vivem no trilho esquerdo, abaixo do
menu, como ícones com dica.

## Paridade

Antes de prototipar qualquer tela, extraia do código atual a lista do que ela
mostra: controles, dados, estados, menus, atalhos e mensagens. O protótipo só é
aprovado quando a lista inteira está presente. Depois de migrar, a mesma lista
vira o roteiro do teste.

Modelo da ficha:

```
tela:        record (app)
mostra:      fechar, rótulo nova gravação/gravando na nota, hora atual grande,
             data, onda ao vivo, relógio decorrido, dica de estado, erro,
             pausar/retomar, parar, dica "pausar · parar"
estados:     parado, preparando, gravando, pausado, finalizando, erro
não muda:    tudo acima continua na tela
```

Fichas já levantadas:

```
tela:        home do app (index)
mostra:      caderno atual e troca, estado de sync, atividade com ponto,
             calendário, mapa, busca (campo que abre), opções,
             filtros por tag com contagem, ordem da lista,
             linhas com marca, título, meta, status e progresso,
             FAB com link, imagem, áudio e texto,
             folhas de caderno, atividade, ordem e ações da nota,
             gesto de arquivar/apagar, faixa de Drive expirado
estados:     pronto, carregando (esqueleto), vazio, offline, busca ativa
```

```
tela:        início do web (sem nota aberta)
mostra:      saudação, até duas frases do resumo, quatro números,
             nova nota, análise, importar do Notion, importar de servidor,
             ver mapa (importações no trilho), estado de sync e fila
estados:     com notas, caderno vazio, primeira vez
```

```
tela:        barra do web
mostra:      menu, nova, voltar, avançar, caminho, buscar, gravar, painel,
             tema, mais, abas de notas abertas com fechar e adicionar
estados:     painel aberto, busca aberta, nota ativa, sem nota aberta
```

Cada lote de migração abre com a ficha da tela e fecha com a tela vista no
emulador `hp240-debian`.

## Migração em lotes

1. Fundação: tokens v2, galeria, ícones, primitivas nos dois clientes.
2. App, notas: home, nota, gravação, transcrição.
3. App, superfícies: projetos, calendário, mapa, livro, cofre, ajustes,
   importação, primeiro uso.
4. Web, notas: barra, início, lista, editor, livro, projetos.
5. Web, resto e limpeza: ajustes, diálogos, insights, primeiro uso; apaga
   `web/src/App.css` e `mobile/src/theme/tokens.ts`.

Regra de drenagem: a tela migrada passa a usar as primitivas e sai do CSS antigo
no mesmo commit. Nenhuma tela nova nasce fora do sistema.

## O que a interface não faz

- Não escreve parágrafo explicando o que o usuário já vê.
- Não usa emoji.
- Não usa sombra, gradiente, pílula ou ícone preenchido fora de gravar.
- Não cria estado novo sem forma própria na galeria.
- Não remove um controle que já existia na tela.
