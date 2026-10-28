-- Grafias que o dono confirmou serem ele mesmo. "Sou eu" apaga a pessoa
-- duplicada do mapa e guarda o nome antigo aqui: toda analise, antiga ou nova,
-- resolve essa grafia para o nome do dono nas configuracoes. O centro do mapa e
-- a unica representacao do diarista.
CREATE TABLE IF NOT EXISTS owner_aliases (
    name       TEXT PRIMARY KEY COLLATE NOCASE,
    created_at TEXT NOT NULL
);
