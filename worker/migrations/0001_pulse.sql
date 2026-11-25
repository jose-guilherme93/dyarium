-- Dados do painel /admin: uso anonimo e o cadastro minimo de contas.
--
-- O que entra: id aleatorio de instalacao (uuid), evento por dia, versao,
-- navegador, contagens de notas/tamanho e, SO no login com Google, o e-mail.
-- O que nunca entra: conteudo de nota, audio, transcricao, token, IP, header.

CREATE TABLE IF NOT EXISTS install (
  id TEXT PRIMARY KEY,
  first_day TEXT NOT NULL,
  last_day TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'web',
  email TEXT,
  notes INTEGER,
  bytes INTEGER,
  has_drive INTEGER
);

CREATE INDEX IF NOT EXISTS install_email ON install (email);
CREATE INDEX IF NOT EXISTS install_last_day ON install (last_day);

CREATE TABLE IF NOT EXISTS account (
  email TEXT PRIMARY KEY,
  first_day TEXT NOT NULL,
  last_day TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS account_last_day ON account (last_day);

CREATE TABLE IF NOT EXISTS event (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  install TEXT NOT NULL,
  PRIMARY KEY (day, kind, install)
);

CREATE INDEX IF NOT EXISTS event_kind_day ON event (kind, day);
