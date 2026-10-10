-- Initial schema for dyarium.
-- Timestamps are RFC 3339 (UTC) text. Booleans are INTEGER 0/1.

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
    id                TEXT PRIMARY KEY,
    title             TEXT,
    status            TEXT NOT NULL,
    source            TEXT NOT NULL DEFAULT 'upload',
    original_filename TEXT,
    content_type      TEXT,
    size_bytes        INTEGER NOT NULL DEFAULT 0,
    duration_seconds  REAL NOT NULL DEFAULT 0,
    sha256            TEXT,
    recorded_at       TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_entries_status ON entries (status);
CREATE INDEX IF NOT EXISTS idx_entries_recorded_at ON entries (recorded_at);
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries (created_at);
CREATE INDEX IF NOT EXISTS idx_entries_deleted_at ON entries (deleted_at);

CREATE TABLE IF NOT EXISTS attachments (
    id            TEXT PRIMARY KEY,
    entry_id      TEXT NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,
    storage_key   TEXT NOT NULL,
    content_type  TEXT,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    sha256        TEXT,
    cipher        TEXT NOT NULL DEFAULT 'aes-256-gcm',
    cache_key     TEXT,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_entry_id ON attachments (entry_id);
CREATE INDEX IF NOT EXISTS idx_attachments_entry_kind ON attachments (entry_id, kind);
CREATE INDEX IF NOT EXISTS idx_attachments_entry_cache ON attachments (entry_id, cache_key);

CREATE TABLE IF NOT EXISTS transcripts (
    id               TEXT PRIMARY KEY,
    entry_id         TEXT NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    model            TEXT NOT NULL,
    language         TEXT,
    text             TEXT NOT NULL DEFAULT '',
    trim_silence     INTEGER NOT NULL DEFAULT 0,
    duration_seconds REAL NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transcripts_entry_id ON transcripts (entry_id);

CREATE TABLE IF NOT EXISTS segments (
    id            TEXT PRIMARY KEY,
    transcript_id TEXT NOT NULL REFERENCES transcripts (id) ON DELETE CASCADE,
    idx           INTEGER NOT NULL,
    start_ms      INTEGER NOT NULL,
    end_ms        INTEGER NOT NULL,
    text          TEXT NOT NULL,
    speaker       TEXT,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segments_transcript_id ON segments (transcript_id, idx);

CREATE TABLE IF NOT EXISTS analyses (
    id         TEXT PRIMARY KEY,
    entry_id   TEXT NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    model      TEXT NOT NULL,
    sentiment  REAL NOT NULL DEFAULT 0,
    emotions   TEXT,
    people     TEXT,
    places     TEXT,
    summary    TEXT,
    raw        TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analyses_entry_id ON analyses (entry_id, model);

CREATE TABLE IF NOT EXISTS notes (
    id         TEXT PRIMARY KEY,
    entry_id   TEXT NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    title      TEXT,
    document   TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_entry_id ON notes (entry_id);

CREATE TABLE IF NOT EXISTS note_revisions (
    id         TEXT PRIMARY KEY,
    note_id    TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
    document   TEXT NOT NULL,
    author     TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_note_revisions_note_id ON note_revisions (note_id, created_at);

CREATE TABLE IF NOT EXISTS tags (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    color      TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id   TEXT NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    tag_id     TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (entry_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag_id ON entry_tags (tag_id);

CREATE TABLE IF NOT EXISTS links (
    id            TEXT PRIMARY KEY,
    from_entry_id TEXT NOT NULL REFERENCES entries (id) ON DELETE CASCADE,
    to_entry_id   TEXT REFERENCES entries (id) ON DELETE SET NULL,
    url           TEXT,
    label         TEXT,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_from ON links (from_entry_id);
CREATE INDEX IF NOT EXISTS idx_links_to ON links (to_entry_id);

CREATE TABLE IF NOT EXISTS jobs (
    id               TEXT PRIMARY KEY,
    type             TEXT NOT NULL,
    idempotency_key  TEXT NOT NULL UNIQUE,
    payload          TEXT,
    status           TEXT NOT NULL,
    attempts         INTEGER NOT NULL DEFAULT 0,
    max_attempts     INTEGER NOT NULL DEFAULT 5,
    available_at     TEXT NOT NULL,
    lease_expires_at TEXT,
    worker_id        TEXT,
    last_error       TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, available_at);

CREATE TABLE IF NOT EXISTS uploads (
    id             TEXT PRIMARY KEY,
    status         TEXT NOT NULL,
    filename       TEXT,
    content_type   TEXT,
    size_bytes     INTEGER NOT NULL DEFAULT 0,
    sha256         TEXT,
    received_bytes INTEGER NOT NULL DEFAULT 0,
    storage_key    TEXT,
    created_at     TEXT NOT NULL,
    expires_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads (status, expires_at);
