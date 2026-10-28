-- Metricas de escrita enviadas pelo app (um snapshot por aparelho).
--
-- O app calcula as metricas offline e envia o documento pronto; o servidor
-- guarda o ultimo de cada aparelho (contrato versionado em docs/api.md) para o
-- painel web mostrar exatamente os mesmos numeros. Guardar o JSON inteiro
-- permite o app evoluir as metricas sem migracao no banco do servidor.
CREATE TABLE IF NOT EXISTS metrics_snapshots (
    device_id      TEXT PRIMARY KEY,
    device_name    TEXT NOT NULL DEFAULT '',
    schema_version INTEGER NOT NULL,
    generated_at   TEXT NOT NULL,
    received_at    TEXT NOT NULL,
    payload        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_received_at ON metrics_snapshots (received_at);
