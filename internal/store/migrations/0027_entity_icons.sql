-- Icone monocromatico escolhido pelo dono para uma entidade. Vazio segue o
-- icone do tipo (pessoa, casa, cerquilha, check): o desenho do mapa continua
-- sendo do cliente, o banco guarda apenas a chave.
ALTER TABLE entities ADD COLUMN icon TEXT NOT NULL DEFAULT '';
