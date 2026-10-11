# Changelog

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
