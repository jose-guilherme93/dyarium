-- Revisao da transcricao por IA: o whisper escuta o audio, a LLM corrige a
-- lingua. O texto original continua em segments.text (imutavel); o derivado
-- fica por segmento para o painel marcar o trecho alterado e mostrar o
-- original, e para a analise ler o texto revisado.
--
-- transcripts.revised_text guarda a juncao do derivado para a previa e a busca
-- nao pagarem o join por segmento. revised_prompt_version e a chave de cache:
-- prompt novo revisa de novo.

ALTER TABLE transcripts ADD COLUMN revised_text TEXT NOT NULL DEFAULT '';
ALTER TABLE transcripts ADD COLUMN revised_model TEXT NOT NULL DEFAULT '';
ALTER TABLE transcripts ADD COLUMN revised_prompt_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transcripts ADD COLUMN revised_literal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transcripts ADD COLUMN revised_comprehension INTEGER NOT NULL DEFAULT -1;

-- Trecho editado a mao no aparelho. A revisao nunca toca nele: a escrita do
-- usuario vence a IA, inclusive depois de um novo sync da transcricao.
ALTER TABLE segments ADD COLUMN user_edited INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS transcript_revisions (
    segment_id     TEXT PRIMARY KEY REFERENCES segments (id) ON DELETE CASCADE,
    transcript_id  TEXT NOT NULL REFERENCES transcripts (id) ON DELETE CASCADE,
    text           TEXT NOT NULL,
    model          TEXT NOT NULL,
    prompt_version INTEGER NOT NULL DEFAULT 0,
    literal        INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transcript_revisions_transcript
    ON transcript_revisions (transcript_id);

-- comprehension -1 significa "nao medida"; a analise sem revisao devolve a
-- propria estimativa e marca a origem. As taxas sao por 100 palavras do texto
-- cru do audio: gagueira (repeticao) e hesitacao ("ee", "hum").
ALTER TABLE analyses ADD COLUMN comprehension INTEGER NOT NULL DEFAULT -1;
ALTER TABLE analyses ADD COLUMN comprehension_source TEXT NOT NULL DEFAULT '';
ALTER TABLE analyses ADD COLUMN stutter_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE analyses ADD COLUMN hesitation_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE analyses ADD COLUMN revised_segments INTEGER NOT NULL DEFAULT 0;
