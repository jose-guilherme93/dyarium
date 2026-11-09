# Curadoria de entidades

Contrato unico para o app e o dashboard. As duas superficies leem e escrevem o
mesmo modelo; o schema existe no SQLite do servidor (que o dashboard usa) e no
SQLite local do app, e os dois reconciliam pelo mesmo contrato de sync.

## Tipos

- `kind` e lista fechada: `person`, `place`, `theme`, `decision`. Nao existe
  `event`, `task` ou `idea` como entidade: esses campos vivem na analise.
- `label` e texto livre, editavel pelo dono, so para exibir. Exemplos:
  `place` + `escola`, `person` + `gata`, `person` + `personagem`. O rotulo nao
  muda cor, metrica, mapa nem sync.

## Nome real (canonico)

- `entities.name` e o nome real exibido no mapa, nos chips e nas listas.
- `entity_aliases` guarda apelidos e grafias antigas ligados ao mesmo id. O nome
  real pode nao existir em nenhum texto: o usuario digita e as grafias entram
  embaixo dele.
- O texto escrito pelo usuario nunca e reescrito. A citacao da nota continua
  com a grafia original; so a representacao estruturada (mapa, chips, listas,
  frase da analise) usa o nome real.
- A analise resolve `(kind, name)` para o canonico pela tabela `entities` e
  depois por `entity_aliases`, como hoje.
- Trocar o tipo move os vinculos para a entidade do tipo destino com o mesmo
  nome; se ela ja existir, mescla. O tipo antigo vira rejeicao.

## Rejeicoes

Uma rejeicao diz "este nome nunca e entidade deste tipo".

| Campo | Tipo | Notas |
|---|---|---|
| kind | TEXT | pessoa, lugar, tema ou decisao rejeitado |
| name | TEXT | grafia exibida |
| name_key | TEXT | normalizado: minusculas, sem acento, espacos colapsados, pontas aparadas |
| created_at | TEXT | |
| updated_at | TEXT | LWW do sync |

Chave primaria: `(kind, name_key)`.

- A rejeicao e aplicada por script **antes de persistir**. `SaveRichAnalysis`
  (servidor) e `replaceEntryEntities` (app) descartam o vinculo cujo
  `(kind, name_key)` esta rejeitado. O dado nunca chega ao banco.
- A camada de stopwords de gramatica (`rewriteStopwords`, em `entities.go`)
  continua existindo: pronome, artigo e papel generico nunca sao pessoa. Ela e
  a camada 0; a rejeicao do usuario e a camada 1.
- Remover a rejeicao libera o nome de novo; o "Desfazer" de 5 s faz isso junto
  com a restauracao da entidade.
- Excluir uma entidade apaga entidade, vinculos e aliases e grava a rejeicao
  `(kind, name)`. O desfazer restaura tudo, inclusive a rejeicao.

## Recuperacao por relevancia

Antes de ler um bloco (app) ou secao (servidor), o script procura no texto os
nomes e aliases que ele conhece. So o que aparece literalmente entra no prompt:

```json
{
  "paulo ramos": { "tipo": "place", "rotulo": "escola", "nunca": ["person"] },
  "joao pedro gomes da silva": { "tipo": "person", "apelidos": ["joaozinho", "pedrinho gomes"] }
}
```

- Casamento lexical: minusculas, sem acento, nome inteiro; o mesmo criterio da
  ancora de evidencia.
- Sem embeddings e sem modelo extra. Quando o dicionario crescer, a recuperacao
  continua igual: so o que casa com o bloco entra.
- A lista `nunca` tambem entra no prompt como instrucao, mas a garantia e o
  filtro pos-extracao; o modelo pode ignorar o prompt, o script nao.

## API

- `GET /api/v1/entities` passa a devolver `rejections` junto de `entities` e
  `owner_aliases`; cada entidade traz `label`.
- `PUT /api/v1/entities/{kind}/{name}/label` — corpo `{ "label": "escola" }`.
- `POST /api/v1/entities/{kind}/{name}/kind` — corpo `{ "kind": "place" }`;
  move vinculos, mescla se ja existir e grava a rejeicao do tipo antigo.
- `DELETE /api/v1/entities/{kind}/{name}` — apaga e grava a rejeicao; devolve
  `edit_id` para o desfazer.
- `POST /api/v1/entity-rejections` — corpo `{ "kind": "person", "name": "você" }`
  (para a tela de memoria).
- `DELETE /api/v1/entity-rejections/{kind}/{name}` — libera o nome.
- `POST /api/v1/entities/edits/{id}/undo` continua sendo o desfazer; o snapshot
  inclui rejeicoes.

## Sincronizacao

- `label`, `kind`, `name` e `updated_at` viajam na entidade; a rejeicao viaja
  com `kind`, `name`, `name_key` e `updated_at`.
- O encontro e por `(kind, name_key)`, nunca por id: cada ambiente deriva ids
  proprios.
- A escrita mais nova vence por `updated_at`; a diferenca local e empurrada de
  volta.
- Excluir/rejeitar no app offline entra na outbox e sobe no proximo sync. Como
  o desfazer acontece em 5 s e antes do sync, a outbox ainda nao saiu; se saiu,
  o desfazer enfileira a operacao inversa.
