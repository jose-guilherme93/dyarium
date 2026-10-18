-- Transcricoes enviadas por clientes antigos sem `attachment_id` ficavam soltas
-- na entrada e nao apareciam na pilha de audios. Quando a entrada tem um unico
-- audio, associa a transcricao a ele.
UPDATE transcripts
SET attachment_id = (
	SELECT a.id
	FROM attachments a
	WHERE a.entry_id = transcripts.entry_id AND a.kind = 'original'
	ORDER BY a.created_at DESC
	LIMIT 1
)
WHERE (attachment_id IS NULL OR attachment_id = '')
  AND (
	SELECT COUNT(*)
	FROM attachments a
	WHERE a.entry_id = transcripts.entry_id AND a.kind = 'original'
  ) = 1;
