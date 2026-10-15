-- Multiplos audios por nota e transcricao por audio.
--
-- Cada audio e um anexo de kind 'original'; a transcricao passa a apontar para
-- o audio (attachments.id) em vez de apenas para a nota.

ALTER TABLE attachments ADD COLUMN duration_seconds REAL NOT NULL DEFAULT 0;

ALTER TABLE transcripts ADD COLUMN attachment_id TEXT REFERENCES attachments (id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_transcripts_attachment_id ON transcripts (attachment_id);

-- O upload pode alimentar uma nota existente (varios audios) em vez de criar
-- uma nota nova.
ALTER TABLE uploads ADD COLUMN entry_id TEXT REFERENCES entries (id) ON DELETE CASCADE;

-- Backfill: liga cada transcricao existente ao audio original da nota.
UPDATE transcripts
SET attachment_id = (
    SELECT a.id FROM attachments a
    WHERE a.entry_id = transcripts.entry_id AND a.kind = 'original'
    ORDER BY a.created_at ASC LIMIT 1
)
WHERE attachment_id IS NULL;

-- Backfill: duracao do audio a partir da nota (dados da fase de audio unico).
UPDATE attachments
SET duration_seconds = (
    SELECT e.duration_seconds FROM entries e WHERE e.id = attachments.entry_id
)
WHERE kind = 'original' AND duration_seconds = 0;
