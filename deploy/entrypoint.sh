#!/bin/sh
# Entrypoint: optionally runs Litestream to replicate the SQLite database to S3
# and then starts the diary server. When Litestream is not enabled, nothing
# related to it runs.
set -eu

if [ "${DIARY_LITESTREAM_ENABLED:-false}" = "true" ] && [ -n "${DIARY_LITESTREAM_BUCKET:-}" ]; then
  config=/tmp/litestream.yml
  cat > "$config" <<EOF
dbs:
  - path: ${DIARY_DB_PATH:-/data/diary.db}
    replicas:
      - type: s3
        bucket: ${DIARY_LITESTREAM_BUCKET}
        path: ${DIARY_LITESTREAM_PATH:-dyarium}
        endpoint: ${DIARY_LITESTREAM_ENDPOINT:-}
        access-key-id: ${DIARY_LITESTREAM_ACCESS_KEY_ID:-}
        secret-access-key: ${DIARY_LITESTREAM_SECRET_ACCESS_KEY:-}
EOF
  echo "litestream: replicando ${DIARY_DB_PATH:-/data/diary.db} para ${DIARY_LITESTREAM_BUCKET}"
  exec litestream replicate -config "$config" -exec "diary serve"
fi

exec diary serve
