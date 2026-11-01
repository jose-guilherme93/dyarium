# Contrato de sincronizacao entre ambientes

Este documento e normativo. Toda mudanca de comportamento de sincronizacao
atualiza este arquivo junto com o codigo.

## Modelo

O app e o servidor sao ambientes independentes. Cada um tem banco proprio, chave
propria e funciona sozinho para sempre. Um usuario pode usar apenas o app, apenas
o servidor, ou os dois. A conexao e opcional, reversivel e serve para que os dois
acervos se encontrem.

- O app pode se conectar a varios servidores; servidor nao fala com servidor.
- Nenhum ambiente e autoridade sobre o outro.
- A biblioteca do app e a uniao do que ele conhece.
- Conexao = reconciliacao de conjuntos, nunca espelho.

## Regras

### R1 - Autonomia

Todo ambiente le, escreve, transcreve, analisa e faz backup sozinho. Nenhuma
operacao local depende de rede. O primeiro boot funciona apenas com o volume de
dados montado.

### R2 - Simetria

Nao existe servidor principal. Cada ambiente e dono do que tem. A conexao troca
diferencas.

### R3 - Identidade do criador

Todo objeto tem id gerado por quem o criou e imutavel:

- nota/entrada: ULID do app ou id do servidor quando criada la;
- corpo: identificado pela entrada (um corpo por entrada);
- caderno: ULID do criador;
- anexo: id do criador (`att_...`), aceito pelo servidor em
  `X-Attachment-Id`;
- tag: nome normalizado, sem id.

O servidor nunca substitui o id de um objeto que veio com id. O upload de audio
envia `entry_id` e `X-Attachment-Id`; criar nota escrita envia `id`.

### R4 - Uniao

Ao conectar:

- id so local: sobe;
- id so remoto: desce;
- id nos dois: reconcilia;
- id em nenhum: nao existe.

### R5 - Ausencia nao e exclusao

Lista vazia, lista truncada, erro de rede, servidor novo, backup restaurado: nada
disso apaga. Só tombstone apaga.

### R6 - Tombstone permanente

Apagar grava um tombstone (`id`, `deleted_at`, `origin`). A retencao de 7 dias
purga apenas o conteudo (audio, imagens, corpo, transcricao, analise); o tombstone
continua sendo servido em `GET /api/v1/entries?deleted=1` e no manifesto. No app,
a intencao de exclusao vive na tabela `tombstones` e sobrevive a purga da lixeira.

### R7 - Conteudo imutavel

Audio e imagem nunca sao sobrescritos. Edicao de qualquer campo gera versao nova.

### R8 - Merge deterministico

Notas de ids diferentes nunca conflitam. Para o mesmo id, o campo segue a regra
do servidor (`docs/api.md`): cada campo tem versao, o servidor recusa escrita com
versao vencida (409) e o perdedor fica em `note_revisions`. O app nao inventa
outra ordem: usa a versao lida do ambiente.

### R9 - Idempotencia e retomada

- Criar com id existente devolve o existente.
- Reenviar chunk retoma do offset confirmado pelo ambiente (o servidor devolve
  o offset do `client_key`; a fila local guarda o offset do primario).
- Apagar duas vezes e sucesso.
- Timeout, 5xx ou resposta ilegivel nunca viram "apagado" nem "ausente".
- Upload interrompido retoma pelo offset gravado em `entry_sync`.

### R10 - Contrato versionado

`GET /api/v1/version` devolve `instance_id` e `sync_contract`. O app recusa a
conexao quando nao conhece o major do contrato, antes de qualquer escrita. Mudanca
aditiva (campo/endpoint novo) nao sobe o major; mudanca de semantica sobe.

## Superficie HTTP

- `GET /api/v1/sync/manifest?kind=entries|deleted|notebooks&cursor=&limit=`
  devolve identidade, versoes, hash do corpo, anexos e tombstones. O corpo e a
  transcricao sao buscados pelos endpoints normais quando o hash/versao difere.
- `GET /api/v1/entries` e `GET /api/v1/entries?deleted=1` continuam valendo; o
  manifesto e a forma compacta e estavel.
- `kind=notebooks` inclui `kind` (`notes`/`book`) e os metadados do livro. Nao ha
  tipo novo de manifesto; cliente antigo ignora os campos desconhecidos.
- `kind=entries` inclui `chapter_kind` e `chapter_position` (e o status/sinopse
  do capitulo). O app movel guarda o espelho dos livros mesmo sem mostra-los no
  v1, para o futuro.
- Excluir um livro grava o tombstone do caderno e o de cada capitulo. O app
  reconcilia como qualquer nota apagada; converter um livro em caderno limpa os
  campos de capitulo e o proximo pull entrega notas comuns.
- `<id>` e `<instance_id>` sao opacos. URL nao e identidade.

### Erros

- 409: versao vencida ou id de anexo ja usado com outro conteudo. O app relê e
  decide; nao apaga nada.
- 404 em objeto vivo: recriar com o mesmo id. 404 em tombstone: a exclusao ja se
  aplicou, ignorar.
- 422: conteudo invalido. Nao retenta sozinho; preserva o dado local.
- 5xx/rede: backoff e estado local intacto.

## Anexos

O markdown guarda `attachment:<id>`. O id e do criador e vale em todos os
ambientes; cada ambiente materializa os bytes sob aquele id, cifrados com a
propria chave. Quando um ambiente nao tem o objeto, a nota continua sincronizando
e a midia fica pendente; nunca bloqueia o corpo.

Levar bytes de A para B e trabalho do app: baixa decifrado de A
(`GET /api/v1/attachments/{id}`) e sobe em chunks para B com o mesmo id. Nao
existe transferencia direta entre servidores.

## Estado no app

O app guarda o conteudo uma vez e o estado por ambiente em tabelas proprias:

- `server_instance`: id estavel, endereco, contrato e ultimo sync;
- `entry_sync`: id remoto, id da nota, versoes, offset de upload, mapa de anexos,
  ultimo estado confirmado e tombstone por ambiente;
- `notebook_sync`: o mesmo para cadernos;
- `tombstones`: intencao de exclusao permanente, inclusive depois de a lixeira
  purgar o conteudo;
- `transcript_sync_env` / `analysis_sync_env`: marcadores por ambiente.

O conteudo local (nota, corpo, transcricao, analise, audio) continua em uma copia
so. Nao existe copia da biblioteca por servidor.

## Exclusao e restauracao

- Excluir no app: a nota vai para a lixeira local, grava tombstone e o manifesto
  de cada ambiente recebe a exclusao (`DELETE /entries/{id}`).
- Excluir em um ambiente: o tombstone desce; o app coloca a nota na lixeira local
  se a exclusao for mais nova que a ultima mudanca local.
- Restaurar: `POST /entries/{id}/restore`; se o ambiente ja purgou a entrada, o
  app recria com o mesmo id (audio local e reenviado quando existe).
- Restaurar um backup: o estado por ambiente e reconstruido pela reconciliacao;
  nada e reenviado a toa porque criar por id e idempotente.

## Relogio de versao (HLC)

A versao de um campo e um carimbo do relogio hibrido logico:
`<fisico em ms>-<contador>-<no>`, com largura fixa. Node e a identidade estavel
de quem emitiu — o `instance.id` do servidor ou o id do aparelho.

- **Servidor:** cada gravacao recebe um carimbo estritamente maior que o
  anterior. Relogio de parede parado ou voltando so faz o contador avancar;
  relogio adiantado nao reemite o que ja saiu.
- **Recebimento:** `PATCH /entries/{id}` e `PUT /notes/{id}` aceitam `X-HLC` com
  a ultima versao lida pelo cliente. O servidor avanca o relogio ate ela antes de
  carimbar, entao uma edicao feita depois de uma leitura vence a leitura mesmo
  com o relogio do aparelho atrasado. O app faz o mesmo do outro lado: cada
  versao puxada avanca o relogio local, e a edicao seguinte fica depois.
- **Desempate:** fisico, depois contador, depois no. Duas edicoes simultaneas em
  ambientes diferentes terminam sempre na mesma ordem, sem dialogo.
- **Compatibilidade:** versoes antigas em RFC3339 continuam validas e ordenam
  como carimbos sem contador nem no. O formato e opaco para os clientes; so a
  comparacao importa.
- **Perdedor:** quem perde a comparacao fica em `note_revisions`, nunca some.

## Proveniencia da nota

`entries.origin_instance` e `entries.origin_kind` registram quem criou a nota:
`device` com o id do aparelho (`dev_...`) ou `server` com o `instance_id` do
ambiente. E gravado **so na criacao** e nunca muda.

- **Nao restringe nada.** Um ambiente que recebe a nota continua podendo editar,
  arquivar, mover e apagar. A decisao de quem vence continua sendo do relogio de
  versao; proveniencia nao e autoridade.
- Quem nao manda `X-Origin-Instance` (dashboard, API, importacao) aparece como
  `server` com o id daquele ambiente.
- Linha anterior ao campo fica com os dois vazios: origem desconhecida.
- O app aprende a origem no pull, mas a proveniencia do manifesto e informativa:
  a reconciliacao continua por id, versao e hash, nao por origem.
- Quando o app recria num ambiente uma nota que so existia no outro, o criador
  daquela linha e o app (foi ele que a empurrou). A origem original nao viaja
  como estado; o id, o conteudo e as versoes viajam.

## Limites conhecidos desta versao

- **Backup/restore do servidor:** e uma copia do volume (`diary.db`,
  `objects/`, `master.key`, `instance.id`), documentada mas nao uma operacao
  primeira-classe. O app nao depende dela para funcionar.
- **Entidades sem id comum:** cada ambiente deriva as suas entidades da analise
  local, entao os ids diferem. O encontro e por nome/alias; a edicao (nome,
  icone, "sou eu") e reconciliada e empurrada para os demais ambientes, mas uma
  entidade so existe onde a analise que a cita existe.
- **Metricas sao um retrato:** cada ambiente guarda o ultimo snapshot enviado
  pelo aparelho; nao ha contagem combinada entre ambientes. O painel de cada
  servidor mostra as notas daquele servidor.
- A primeira copia de um acervo grande (por exemplo, 250 notas com audio) roda
  com o app aberto. O background task agora tambem chama a reconciliacao, mas o
  sistema decide quando acordar; se o app fechar, a proxima abertura retoma pelo
  `client_key` do upload, sem duplicar.

## O que ja e por ambiente

- Notas, titulos, datas, corpos, tags, autor, arquivamento e cadernos.
- Audio principal, audios adicionais e imagens: o byte e copiado do ambiente
  que o tem para o que nao tem, com o mesmo `attachment:<id>`.
- Transcricao, revisao e analise: empurradas para todos os ambientes e puxadas
  de cada um, com marcador `(server_id, entry_id)`.
- Exclusao de nota e de caderno: tombstone permanente nos dois lados, com a
  regra de mais novo vence e a origem gravada como o id do aparelho ou do
  ambiente que apagou.
- Edicao concorrente: HLC sem dialogo; o perdedor fica no historico.
- Entidades do mapa (nome, icone, "sou eu") e aliases: o catalogo de cada
  ambiente e aplicado com a regra de mais novo vence, e a diferenca local e
  empurrada de volta com o nome que aquele ambiente conhece.
- Metricas: o snapshot do aparelho e enviado a cada ambiente conectado.


## Compatibilidade

- Campo novo e opcional e ignorado por quem nao conhece.
- Endpoint novo nao substitui o antigo sem uma janela de convivencia.
- Contrato major diferente: recusa clara e nenhuma escrita.

## Clonagem de volume

O `instance_id` e a chave mestra vivem no volume de dados. Copiar o volume para
**migrar** um ambiente e valido: o novo servidor assume a mesma identidade e o
app continua vendo as mesmas notas. Copiar o volume para um ambiente que vai
viver **em paralelo** nao e: os dois responderiam com o mesmo `instance_id` e o
app trataria os dois como um so. Nesse caso, apague `/data/instance.id` do novo
ambiente antes de subir (e nao compartilhe a chave mestra, a menos que a intencao
seja justamente a mesma base de midia).
