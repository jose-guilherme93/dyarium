-- Estado da passada de revisao, independente das linhas por trecho.
--
-- revised_pending era derivado de "segmento sem linha em transcript_revisions".
-- Isso confundia trecho recusado (a passada chegou nele, mas a resposta nao
-- serviu) com trecho nao alcancado (a passada parou antes). O painel entao
-- mostrava uma passada terminada com recusas como se estivesse em andamento.
--
-- revised_through e o indice do primeiro trecho que a passada ainda nao
-- alcancou; revised_finished diz se ela chegou ao fim. Append-only: a 0018 e a
-- 0019 nao se editam.
ALTER TABLE transcripts ADD COLUMN revised_through INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transcripts ADD COLUMN revised_finished INTEGER NOT NULL DEFAULT 0;
