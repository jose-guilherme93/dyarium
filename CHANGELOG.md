# Changelog

## [0.2.0](https://github.com/jose-guilherme93/dyarium/compare/v0.1.1...v0.2.0) (2026-10-11)


### Features

* **web:** menu lateral recolhivel, painel de insights e criacao de nota ([63cc494](https://github.com/jose-guilherme93/dyarium/commit/63cc49477704c120e5070b0787fb1c5a8ae70b61))


### Bug Fixes

* **deploy:** forca o pull da imagem no compose ([9a4d8a9](https://github.com/jose-guilherme93/dyarium/commit/9a4d8a9b87a9c9a0be740c701732727ed762f791))
* **mobile:** tolera trava momentanea do sqlite ao abrir o banco ([e2b7a6e](https://github.com/jose-guilherme93/dyarium/commit/e2b7a6e7c2ff39901515b7804918198b0366c953))

## 0.1.0 (2026-10-11)

Primeira versao publica do dyarium.

### Funcionalidades

- Diario falado self-hosted com transcricao local via whisper.cpp.
- Audio original imutavel e cifrado em repouso (AES-256-GCM em streaming).
- Upload resumivel com validacao de integridade por SHA-256 e dedupe.
- Fila de jobs com leases, retentativas com backoff e idempotencia.
- Dashboard com entradas, transcricao, humor, busca, notas e configuracoes.
- Analise de texto opcional por API compativel com OpenAI (ex.: Ollama local).
- Modulos opcionais: Telegram e backup com Litestream.
- App Android de captura: gravacao com a tela bloqueada, importacao de audios
  compartilhados, fila persistida e envio automatico.
- Deploy turnkey: imagem multi-arch no GHCR, sem variavel de ambiente
  obrigatoria, primeiro acesso guiado por wizard em `/setup`.
