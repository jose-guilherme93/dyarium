#!/usr/bin/env bash
#
# lowmem.sh - executa um comando com tetos conservadores de memoria.
#
# Esta VPS tem pouca RAM disponivel (ver AGENTS.md). Este wrapper limita o
# consumo de Go e Node e evita que uma tarefa pesada derrube o resto.
#
# Uso:
#   scripts/lowmem.sh go test ./...
#   scripts/lowmem.sh pnpm -C web test
#   scripts/lowmem.sh docker build -f deploy/Dockerfile -t diary:dev .
#
# Todos os tetos podem ser sobrepostos por variaveis de ambiente, por exemplo:
#   GOMEMLIMIT=512MiB scripts/lowmem.sh go test ./...
#
set -euo pipefail

export GOMAXPROCS="${GOMAXPROCS:-2}"
export GOGC="${GOGC:-50}"
export GOMEMLIMIT="${GOMEMLIMIT:-768MiB}"
export GOFLAGS="${GOFLAGS:-} -p=1"
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=1024"
export UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-2}"

if [ "$#" -eq 0 ]; then
	echo "uso: $0 <comando> [args...]" >&2
	exit 2
fi

exec "$@"
