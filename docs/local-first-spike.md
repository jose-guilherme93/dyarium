# Spike: armazenamento local no navegador (fase 0)

Data: 14/11/2026. Descartavel. Nao e codigo de produto.

Objetivo: provar que um cofre com 5 mil notas e audio cabe no navegador com o
SQLite certo, e descobrir o que quebra antes de extrair o core.

## Ambiente medido

Headless Chromium 156 em Linux x86_64 (a VPS). **Nao e aparelho de usuario**:
os numeros abaixo provam que o motor funciona e dao a ordem de grandeza; o gate
de aprovacao continua sendo iPhone e Android de verdade.

Ferramenta: `agent-browser` (Chromium com `--no-sandbox`) sobre
`http://127.0.0.1:8901`. Harness em `tmp/spike-storage/` (ignorado pelo git).

## Resultados

Duas execucoes, a segunda depois de recarregar a pagina.

| medida | 1a | 2a (pos-reload) |
|---|---|---|
| carregar wasm | 43 ms | 23 ms |
| inserir 5.000 em uma transacao | 89 ms | 105 ms |
| 200 escritas avulsas | 4.118 ms | 4.236 ms |
| listar 50 por data | 1 ms | 1 ms |
| busca LIKE em 5.200 notas | 4 ms | 8 ms |
| FTS5 | indisponivel | indisponivel |
| fechar + abrir + contar | 1 ms | 1 ms |
| notas no banco | 5.200 | 5.200 |
| uso / cota | 6,7 / 10.247 MB | 6,7 / 10.247 MB |
| `storage.persist()` | negado | negado |
| marcador da execucao anterior | ausente | presente |

O marcador da segunda execucao veio da primeira: **o banco sobreviveu ao
reload** em OPFS.

## Achados

1. **wa-sqlite + `AccessHandlePoolVFS` (OPFS) funciona.** O motor abre, escreve,
   le e reabre. Caminho aprovado para o spike.
2. **`IDBBatchAtomicVFS` falhou.** No primeiro `CREATE TABLE` estourou
   `Cannot read properties of null (reading 'fileSize')` em `xFileSize`
   (`IDBBatchAtomicVFS.js:383`, `block0` nulo). Nao vale insistir: OPFS e o
   caminho e o VFS de IndexedDB sai do desenho.
3. **FTS5 nao vem no build.** `no such module: fts5`. Busca por `LIKE` resolve
   5.200 notas em 4 a 8 ms; so trocar de estrategia (trigram ou build proprio
   com FTS5) se a biblioteca passar de dezenas de milhares de notas.
4. **Escrita avulsa custa ~21 ms por transacao**, enquanto 5.000 linhas em uma
   transacao custam 89 ms. Regra para o produto: **uma transacao por operacao
   de usuario**, nunca uma por campo digitado.
5. **Espaco**: 5.200 notas de ~200 caracteres ocupam 6,7 MB. Audio vai dominar
   a cota; a nota em si e irrelevante.
6. **`persist()` negado no headless** (esperado). Nao conclui nada; o teste
   valido e em aparelho, com e sem app na tela de inicio.

## Pendente (so em aparelho ou com credencial)

- iPhone/Safari: sobreviver aos 7 dias sem interacao, com e sem app instalado.
- Firefox: mesma bateria.
- Drive: listar e baixar 1.000 ops e 200 blobs, medir 403 de cota. Precisa de
  client ID OAuth e consentimento.
- Whisper `base`: 10 min de audio em aparelho medio.
- `https` -> `http://127.0.0.1`: preflight de Private Network Access no
  Chromium e Firefox; e o mesmo teste em `http://192.168.x.x`, que deve falhar.
- AES-GCM em streaming de um blob de 200 MB dentro do Worker.

## Como repetir

```
cd tmp/spike-storage
python3 -m http.server 8901 --bind 127.0.0.1
```

Abrir `http://127.0.0.1:8901/index.html`, clicar em Rodar. Para testar no
telefone, subir com `--bind 0.0.0.0` e abrir `http://<ip-da-maquina>:8901/`
na mesma rede. O botao Copiar JSON devolve tudo para colar aqui.

## O que ainda reprova o desenho

- persistencia negada em iPhone fora da tela de inicio;
- Delta do Drive acima de 10 s ou 403 com 1.000 ops;
- 10 min de audio acima de 10 min com `base` no pior aparelho;
- `https` -> loopback bloqueado no Chromium.
