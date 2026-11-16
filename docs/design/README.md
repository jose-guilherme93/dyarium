# Sistema de interface

Uma fonte de verdade para a aparencia dos dois clientes. O app e o dashboard
consomem os mesmos valores; cada um traduz para o seu dialeto (CSS variavel no
web, objeto TypeScript no app).

## Fonte da verdade

`docs/design/tokens.json`. Nenhum valor de cor, tamanho de fonte, espaco, raio,
altura de controle ou foco existe fora dele. Se a interface precisa de um valor
que nao esta la, o valor entra no JSON primeiro e a galeria e regerada.

## Geracao

```
make tokens        # escreve os arquivos abaixo
make test-tokens   # falha se algum arquivo gerado estiver fora de sincronia
```

`scripts/design-tokens.mjs` le o JSON e escreve:

| Arquivo | Para que serve |
|---|---|
| `web/src/ui/tokens.css` | variaveis `--dy-*` e classes de tipo `dy-*` do dashboard |
| `mobile/src/theme/design.ts` | mesmo conteudo tipado, para o app |
| `docs/design/index.html` | a galeria de especime, gerada dos mesmos valores |

Nada disso se edita a mao. `make test-tokens` roda no `make lint`, entao um
arquivo gerado que ficou para tras quebra o build em vez de mentir.

A galeria abre em `docs/design/index.html` com as fontes em `docs/design/fonts/`.
Ela e o contrato visual: nove secoes, claro, escuro e amoled.

## Tipografia

Schibsted Grotesk (SIL OFL 1.1), auto-hospedada. Web em `web/public/fonts/`
(woff2, latin e latin-ext). App em `mobile/assets/fonts/` (TTF estatico Medium e
SemiBold, porque o React Native nao aplica eixo variavel).

Escala: display 21/600, titulo 17/600, corpo 13/500, rotulo 10/500 em caixa alta,
mono 11.5/500 com numeros tabulares. Peso 700 nao existe no sistema.

## Densidade

Grade de 4 com passos 2/4/6/8/12/16. Altura de controle 20/26/30. Secao tem 12px
acima e abaixo. Linha de lista tem 26px de altura minima e separador de 1px.

## Forma

Raio 2 em controle, 3 em superficie. Sem sombra difusa, sem gradiente, sem
brilho: a separacao vem de uma hairline de 1px e de um degrau tonal entre
`surface`, `surface-alt` e `surface-raised`. Foco e contorno de 1px com offset de
2px, nunca anel grosso nem sombra.

## Cor

Tres paletas: claro, escuro e amoled (fundo preto puro, mesmos acentos do escuro).
Cor so significa estado. Nada de cor de destaque decorativa, nada de cor de marca
em titulo.

Estado aparece por forma antes de cor: disco preenchido e feito, anel vazio e nao
feito, anel com traco e ficou de fora. Quem nao distingue verde de vermelho
continua lendo a tela.

## O que a interface nao faz

- Nao escreve paragrafo explicando o que o usuario ja ve. Texto visivel so para
  nome de nota, rotulo de uma a tres palavras, numero e erro acionavel.
- Nao usa emoji, em codigo, interface, log ou documentacao.
- Nao inventa estado novo sem forma propria na galeria.

## Primitivas

`web/src/ui/` e `mobile/src/ui/` trazem `Button`, `Field` e `Meter` consumindo os
tokens gerados. Codigo novo usa essas primitivas; nao cria um quarto jeito de
desenhar botao.

## Migracao

O CSS legado do dashboard (`web/src/App.css`) e o tema antigo do app
(`mobile/src/theme/tokens.ts`, mais de 70 arquivos consumindo) continuam valendo
para as telas que ja existem. Eles sao drenados conforme a tela for tocada: a tela
migrada passa a usar as primitivas e some do CSS antigo no mesmo commit.

Nao existe uma passada de migracao unica. O que existe e a regra: nenhuma tela
nova nasce fora do sistema.
