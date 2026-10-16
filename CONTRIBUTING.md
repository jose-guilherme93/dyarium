# Como contribuir com o dyarium

Obrigado pelo interesse. Este documento resume o fluxo de trabalho; as regras
duras estao em `AGENTS.md` e vencem em caso de conflito.

## Fluxo

1. Abra uma issue descrevendo o problema ou a ideia antes de codificar, quando a
   mudanca nao for trivial.
2. Crie um worktree proprio a partir de `main`, fora do checkout principal:
   ```
   git worktree add -b <tipo>/<slug> ../dyarium.worktrees/<slug>
   ```
3. Faca commits pequenos, em conventional commits com descricao em pt-BR:

   | Tipo | Quando usar | Efeito na versao |
   |---|---|---|
   | `fix` | correcao de bug | patch (0.1.x) |
   | `feat` | funcionalidade nova | minor (0.x.0) |
   | `feat!` / `BREAKING CHANGE` | quebra de compatibilidade | minor enquanto < 1.0.0 |
   | `chore`, `docs`, `refactor`, `test`, `ci`, `perf` | sem mudanca de comportamento | nenhum |

   A versao e calculada automaticamente pelo release-please a partir desses
   commits. Nao edite `version.txt`, `web/package.json`, `mobile/package.json`
   nem `mobile/app.json` a mao.

4. Antes de abrir o pull request, rode:

   ```
   make lint
   make test
   make mobile-lint
   make mobile-test
   ```

5. Descreva o que mudou, como testar e qual issue fecha.

## Regras que nao se negociam

- Nenhum segredo, dominio, IP ou nome de tailnet real no codigo, nos testes ou
  na documentacao. Tudo por variavel de ambiente.
- Nada de audio, token ou transcricao em log, mensagem de erro ou telemetria.
- O audio original e imutavel; derivados sao artefatos separados.
- Toda mudanca de comportamento vem com teste. Bug corrigido vem com teste que
  falhava antes.
- Sem emoji em codigo, interface, log ou documentacao.
- Identificadores em ingles, prosa em pt-BR.

## Limite de RAM

O projeto e mantido numa VPS pequena. Velocidade importa menos que estabilidade:
uma tarefa pesada por vez, pelos alvos do `Makefile` ou via
`scripts/lowmem.sh`. Veja a secao correspondente em `AGENTS.md`.
