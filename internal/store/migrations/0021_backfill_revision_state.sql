-- Revisoes gravadas antes da 0020 nao tinham o estado da passada. Sem este
-- backfill `revised_through` ficava zero e uma revisao antiga parecia ter
-- comecado agora ("0 de N").
--
-- Uma passada que alcancou todos os trechos tem uma linha por trecho revisado,
-- exceto os recusados (que ja estao contados em revised_rejected). Essas sao
-- marcadas como terminadas.
UPDATE transcripts
SET revised_through = (SELECT COUNT(*) FROM segments s WHERE s.transcript_id = transcripts.id),
    revised_finished = 1
WHERE revised_prompt_version > 0
  AND (SELECT COUNT(*) FROM segments s
         WHERE s.transcript_id = transcripts.id AND s.user_edited = 0)
      - (SELECT COUNT(*) FROM segments s
         JOIN transcript_revisions r ON r.segment_id = s.id
         WHERE s.transcript_id = transcripts.id AND s.user_edited = 0)
      = revised_rejected;

-- As demais foram interrompidas: o alcance e o maior indice que tem linha.
UPDATE transcripts
SET revised_through = COALESCE((
        SELECT MAX(s.idx) + 1
        FROM segments s
        JOIN transcript_revisions r ON r.segment_id = s.id
        WHERE s.transcript_id = transcripts.id
    ), 0),
    revised_finished = 0
WHERE revised_prompt_version > 0
  AND revised_finished = 0;
