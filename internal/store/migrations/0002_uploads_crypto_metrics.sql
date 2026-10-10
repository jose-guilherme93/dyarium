-- Adds the per-upload cipher state (needed for resumable, streaming encryption)
-- and the audio metrics table.

ALTER TABLE uploads ADD COLUMN prefix BLOB;
ALTER TABLE uploads ADD COLUMN next_counter INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS audio_metrics (
    entry_id         TEXT PRIMARY KEY REFERENCES entries (id) ON DELETE CASCADE,
    duration_ms      INTEGER NOT NULL DEFAULT 0,
    loudness_lufs    REAL,
    true_peak        REAL,
    silence_count    INTEGER NOT NULL DEFAULT 0,
    silence_total_ms INTEGER NOT NULL DEFAULT 0,
    sample_rate      INTEGER,
    channels         INTEGER,
    created_at       TEXT NOT NULL
);
