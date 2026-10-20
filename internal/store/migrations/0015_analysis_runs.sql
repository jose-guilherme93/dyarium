-- Uma linha por tentativa de analise (no servidor ou no aparelho). E a
-- materia-prima do diagnostico: medidas e resultado, nunca o conteudo da nota.
-- Append-only: nao guarda estado mutavel e nao e podada nesta fase.
CREATE TABLE IF NOT EXISTS analysis_runs (
    id                     TEXT PRIMARY KEY,
    entry_id               TEXT NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    analysis_id            TEXT REFERENCES analyses (id) ON DELETE SET NULL,
    attachment_id          TEXT,
    runtime                TEXT NOT NULL,
    provider               TEXT NOT NULL,
    model                  TEXT NOT NULL,
    attempt                INTEGER NOT NULL DEFAULT 1,
    outcome                TEXT NOT NULL,
    error_class            TEXT,
    started_at             TEXT NOT NULL,
    finished_at            TEXT NOT NULL,
    duration_ms            INTEGER NOT NULL DEFAULT 0,
    input_text_chars       INTEGER NOT NULL DEFAULT 0,
    input_transcript_chars INTEGER NOT NULL DEFAULT 0,
    input_images           INTEGER NOT NULL DEFAULT 0,
    prompt_tokens          INTEGER NOT NULL DEFAULT 0,
    completion_tokens      INTEGER NOT NULL DEFAULT 0,
    tokens_per_second      REAL NOT NULL DEFAULT 0,
    threads                INTEGER,
    battery_delta_pct      REAL,
    created_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_started ON analysis_runs (started_at);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_model ON analysis_runs (runtime, provider, model);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_entry ON analysis_runs (entry_id);
