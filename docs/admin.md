# Painel /admin

O painel do dono no site hospedado. Ele responde "quantas pessoas usam, quantas
entraram hoje e quem sao" sem abrir o cofre de ninguem: notas, audio e
transcricao continuam cifrados no Drive de cada pessoa.

## O que conta

- **Instalacao**: um id aleatorio por navegador (`localStorage["dyarium.install"]`),
  sem nome, e-mail ou IP. Limpar o site cria outra instalacao.
- **Ativos**: instalacoes que abriram o app no dia.
- **Entraram**: contas distintas que concluiram login no Google no dia.
- **Novas**: contas cujo primeiro login foi no dia.
- **Contas**: e-mails distintos que ja entraram ao menos uma vez.
- **Cofres**: instalacoes que hoje tem cofre no Drive (`has_drive`).
- **Notas e tamanho**: o ultimo numero que cada instalacao relatou; por conta,
  vale o maior entre os navegadores dela (o sync deixa o cofre inteiro nos dois).
- O dia e o de `America/Sao_Paulo`, carimbado no Worker.

Um navegador que so deu F5 nao fala com o Google de novo: "ativos" costuma ser
maior que "entraram". O app mobile ainda nao manda pulso; quando mandar, entra
como `platform: "android"|"ios"` no mesmo contrato.

## Contrato

### POST /pulse

Corpo JSON de ate 4 KB, mesma origem, resposta `204`:

```json
{
  "install": "uuid",
  "event": "boot",
  "version": "0.2.0",
  "platform": "web",
  "email": "pessoa@exemplo.com",
  "notes": 400,
  "bytes": 13000000,
  "has_drive": true
}
```

- `email` so e aceito em `event: "connect"`; um boot com e-mail responde `400`.
- `notes`, `bytes` e `has_drive` sao opcionais; ausente nao apaga o valor anterior.
- O evento e unico por `(dia, kind, install)`; a conta atualiza `last_day` a
  cada login.
- O corpo nunca e logado. A API roda num Worker separado (workers.dev) do site,
  com CORS liberado: o pulso e publico e o painel exige Bearer, entao nao ha
  cookie nem credencial automatica em jogo.

### GET /admin-api/stats?days=30

`Authorization: Bearer <ADMIN_TOKEN>`. `days` entre 7 e 90 (padrao 30).

```json
{
  "generated_at": "2026-11-25T15:00:00.000Z",
  "days": [{ "day": "2026-11-25", "active": 12, "logins": 9, "new_accounts": 2 }],
  "today": { "active": 12, "logins": 9, "new_accounts": 2 },
  "totals": { "accounts": 31, "installs": 42, "vaults": 25, "notes": 12345, "bytes": 98765432 },
  "accounts": [
    {
      "email": "pessoa@exemplo.com",
      "first_day": "2026-11-01",
      "last_day": "2026-11-25",
      "installs": 2,
      "notes": 400,
      "bytes": 13000000,
      "version": "0.2.0",
      "platform": "web"
    }
  ],
  "versions": [{ "version": "0.2.0", "installs": 30 }]
}
```

### DELETE /admin-api/account?email=

Remove o e-mail e desliga os navegadores dele do cadastro. O historico de uso
continua anonimo (as instalacoes deixam de apontar para a conta). Resposta
`{ "removed": true | false }`.

## Banco (D1)

`worker/migrations/0001_pulse.sql` cria:

- `install` — id, primeiro/ultimo dia, versao, plataforma, e-mail, notas, bytes, has_drive.
- `account` — e-mail, primeiro/ultimo login.
- `event` — `(day, kind, install)`, o que gera ativos e entradas por dia.

O cron `17 4 * * *` apaga `event` com mais de 180 dias. Contas ficam ate serem
removidas pelo painel.

## Privacidade

- O pulso leva: id aleatorio, evento, versao, navegador, contagens e, no login, o e-mail.
- Nunca leva: conteudo de nota, audio, transcricao, token, header ou IP (o Worker
  nao le `CF-Connecting-IP`).
- O e-mail e dado pessoal: fica em `account`, e o aviso esta em `/privacidade`.
- O ingest e publico: qualquer um pode inserir uma instalacao ou um e-mail falso.
  O token do admin protege a leitura, nao a escrita. E um contador de uso, nao
  uma fonte de autorizacao.

## Setup (uma vez, com a conta Cloudflare)

```bash
npx wrangler -c worker/wrangler.jsonc d1 migrations apply dyarium-admin --remote
npx wrangler -c worker/wrangler.jsonc secret put ADMIN_TOKEN   # 32+ bytes aleatorios
npx wrangler -c worker/wrangler.jsonc deploy
```

O `worker/wrangler.jsonc` aponta o binding `DB` e o cron; o `wrangler.jsonc` da
raiz continua publicando so os assets do site. O endereco do Worker vai em
`VITE_ADMIN_API` (`web/.env.production`); vazio usa a mesma origem. A chave do
`/admin` e pedida uma vez por aba e guardada em `sessionStorage["dyarium.admin"]`;
ela nao vai para o bundle nem para o `localStorage`.

O site e publicado pelo build do Git (Cloudflare Workers Builds); o Worker da API
precisa de um deploy a parte quando `worker/` mudar.
