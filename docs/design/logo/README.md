# Marca

| Arquivo | Uso |
|---|---|
| `mark.svg` | marca sozinha, 32×32; ícone de app, favicon, cabeçalho |
| `lockup.svg` | marca com o nome `dyarium` |
| `lockup-dev.svg` | marca com `dyarium - dev`, na cor de desenvolvimento |

Todos usam `currentColor`: a cor vem de quem usa. No produto é a primária do
tema (`#5b6f66` no claro, `#a2b8ae` no escuro e no amoled); no build de
desenvolvimento é a cor `dev` (`#9a5426` no claro, `#d69b6e` nos escuros).

## Geometria

Grade de 32, traço 1,5, canto quadrado.

- capa: retângulo 21×24, raio 2, em (5,5 / 4)
- lombada: linha de 4 a 28 em x 10,5
- fio: linha de 28,4 a 31,4 em x 8,2
- D: Schibsted Grotesk SemiBold como caminho, maiúscula de 11,7 (de 9,9 a 21,6),
  centro óptico em x 18,8

O D é caminho, não texto: a marca não depende da fonte instalada. Para refazer o
contorno a partir de `mobile/assets/fonts/SchibstedGrotesk-SemiBold.ttf`, extraia
o glifo e escale a maiúscula para 11,7 na grade de 32.

## Assinatura

Palavra em 600, tracking de -0,025em. No lockup, marca de 32 com a palavra em 14,
intervalo de 7 e base em 20,9. O nome de desenvolvimento recebe ` - dev` em
minúsculas, com espaço dos dois lados do hífen.

## Tamanhos

O fio tem 3 de comprimento e desaparece abaixo de 24 px. Ícone mínimo: 24 px.

Abaixo disso vale o desenho de aba, em `web/public/favicon.svg` (primária) e
`web/public/favicon-dev.svg` (cor `dev`): sem fio, capa 22×25 com raio 3 em
(5 / 3,5), traço 3 e o D com maiúscula de 15 em x 17,4, base 23. O traço engrossa
para 3 porque em 16 px o de 1,5 vira cinza lavado. O web troca o ícone pelo nome
do arquivo quando o build é de desenvolvimento.
