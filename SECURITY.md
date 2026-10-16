# Politica de seguranca

## Como reportar

Nao abra issue publica para vulnerabilidades. Use o canal privado de seguranca
do GitHub (aba Security, "Report a vulnerability") ou contate os mantenedores
diretamente. Inclua a versao, o cenario e um passo a passo reproducible, sem
dados reais.

## Modelo de seguranca

- O dyarium e self-hosted e single-user. O acesso se da por um token Bearer.
- Os audios originais sao cifrados em repouso com AES-256-GCM. A chave mestra
  fica no volume de dados (`/data/master.key`) ou em `DIARY_MASTER_KEY`.
- Perder o volume de dados significa perder a chave mestra e, com ela, os audios
  cifrados. Nao ha recuperacao.
- A cifra protege em repouso, nao em uso: enquanto o servidor processa uma
  entrada, o audio existe em claro num diretorio temporario.
- No primeiro acesso, enquanto a instancia nao foi reivindicada, as rotas
  publicas `/setup` e `/setup/state` ficam abertas. Exponha o servico apenas em
  rede confiavel (LAN, tailnet ou com autenticacao na borda) ate concluir o
  setup. Depois do primeiro acesso, essas rotas sao fechadas.
- O modulo Telegram e a analise por IA sao opcionais e desligados por padrao.

## Fora de escopo

- Servidores comprometidos pelo operador.
- Perda de dados por falta de backup (o Litestream opcional cobre o banco).
