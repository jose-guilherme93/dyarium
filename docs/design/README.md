# Sistema de interface

Uma fonte de verdade para a aparencia dos dois clientes. O app e o dashboard
consomem os mesmos valores; cada um traduz para o seu dialeto (CSS variavel no
web, objeto TypeScript no app).

O comportamento das pecas — anatomia, estados, o que muda entre web e app e o que
uma tela migrada precisa manter — esta em `system.md`. Aquele documento e a
regra; este README explica a geracao.

## Fonte da verdade

- `docs/design/tokens.json`: cor, tipo, espaco, raio, altura de controle, foco,
  densidade, leitura, camadas, movimento, onda e estado.
- `docs/design/icons.json`: o desenho de cada icone, um caminho por nome, com
  viewBox 14 e traco 1.5.

Nenhum valor de cor, tamanho de fonte, espaco, raio, altura de controle, camada,
duracao de movimento ou desenho de icone existe fora deles. Se a interface precisa
de um valor que nao esta la, o valor entra no JSON primeiro e a galeria e regerada.

## Geracao

```
make tokens        # escreve os arquivos abaixo
make test-tokens   # falha se algum arquivo gerado estiver fora de sincronia
```

`scripts/design-tokens.mjs` le os dois JSONs e escreve:

| Arquivo | Para que serve |
|---|---|
| `web/src/ui/tokens.css` | variaveis `--dy-*` e classes de tipo do dashboard |
| `web/src/ui/iconGlyphs.ts` | caminhos dos icones para o web |
| `mobile/src/theme/design.ts` | mesmo conteudo tipado, para o app |
| `docs/design/index.html` | a galeria de especime, gerada dos mesmos valores |

Nada disso se edita a mao. `make test-tokens` roda no `make lint`, entao um
arquivo gerado que ficou para tras quebra o build em vez de mentir.

A galeria abre em `docs/design/index.html` com as fontes em `docs/design/fonts/`.
Ela e o contrato visual: quatorze secoes, claro, escuro e amoled.

## Tipografia

Schibsted Grotesk (SIL OFL 1.1), auto-hospedada. Web em `web/public/fonts/`
(woff2, latin e latin-ext). App em `mobile/assets/fonts/` (TTF estatico Medium e
SemiBold, porque o React Native nao aplica eixo variavel).

Escala: saudacao 48/600, display 21/600, titulo 17/600, corpo 13/500, rotulo
10/500 em caixa alta, mono 11.5/500 com numeros tabulares. Leitura longa usa
Newsreader 15/400 com entrelinha 1.45 e medida de 44 caracteres. Peso 700 nao
existe no sistema.

A saudacao so existe no inicio do web; o app abre nas notas.

## Densidade

Grade de 4 com passos 2/4/6/8/12/16/24/32. Altura de controle 20/26/30. Secao tem
12px acima e abaixo. No web a linha de lista tem 26px; no app a linha de toque tem
44px. O desenho do icone continua 14 ou 16 nos dois.

## Forma

Raio 2 em controle, 3 em superficie. Sem sombra difusa, sem gradiente, sem
brilho: a separacao vem de uma hairline de 1px e de um degrau tonal entre
`surface`, `surface-alt` e `surface-raised`. Foco e contorno de 1px com offset de
2px. As unicas formas circulares, por funcao, sao o disco de gravacao e o FAB.

## Cor

Tres paletas: claro, escuro e amoled (fundo preto puro, mesmos acentos do escuro).
Cada paleta declara tambem `overlay`, o veu de folha e dialogo. Cor so significa
estado. Estado aparece por forma antes de cor: disco preenchido e feito, anel
vazio e nao feito, anel com traco e ficou de fora.

## Icones

Um desenho por nome, em `docs/design/icons.json`. O web desenha o caminho gerado
em `iconGlyphs.ts`; o app mapeia o mesmo nome para o Ionicons mais proximo em
`mobile/src/ui/icons.tsx`. Nome novo entra no JSON primeiro.

## O que a interface nao faz

- Nao escreve paragrafo explicando o que o usuario ja ve. Texto visivel so para
  nome de nota, rotulo de uma a tres palavras, numero e erro acionavel.
- Nao usa emoji, em codigo, interface, log ou documentacao.
- Nao inventa estado novo sem forma propria na galeria.
- Nao remove um controle que a tela ja tinha.

## Primitivas

`web/src/ui/` e `mobile/src/ui/` trazem `Button`, `Field`, `Meter`, `StateMark`,
`Wave` (web) e `Icon` consumindo os tokens gerados. Codigo novo usa essas
primitivas; nao cria um quarto jeito de desenhar botao.

## Migracao

O CSS legado do dashboard (`web/src/App.css`) e o tema antigo do app
(`mobile/src/theme/tokens.ts`, mais de 70 arquivos consumindo) continuam valendo
para as telas que ja existem. Eles sao drenados conforme a tela for tocada: a tela
migrada passa a usar as primitivas e some do CSS antigo no mesmo commit. Os lotes
e as fichas de paridade estao em `system.md`.

Nao existe uma passada de migracao unica. O que existe e a regra: nenhuma tela
nova nasce fora do sistema e nenhuma tela migrada perde o que ja tinha.
