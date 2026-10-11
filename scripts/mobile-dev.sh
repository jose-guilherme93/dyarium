#!/usr/bin/env bash
#
# Sobe o Metro/Expo apontando para o IP da tailnet, para abrir o app no celular
# via Tailscale (sem depender de tunnel externo).
#
# Uso:
#   scripts/mobile-dev.sh            # detecta o IP do tailscale
#   MOBILE_PACKAGER_HOSTNAME=1.2.3.4 scripts/mobile-dev.sh
#
set -euo pipefail

cd "$(dirname "$0")/../mobile"

HOST="${MOBILE_PACKAGER_HOSTNAME:-}"
if [ -z "$HOST" ] && command -v tailscale >/dev/null 2>&1; then
	HOST="$(tailscale ip -4 2>/dev/null | head -n1 || true)"
fi

if [ -n "$HOST" ]; then
	export REACT_NATIVE_PACKAGER_HOSTNAME="$HOST"
	echo "Metro via Tailscale em http://$HOST:8081"
	echo "Abra o Expo Go no celular (na mesma tailnet) e aponte para esse endereco."
else
	echo "Tailscale nao encontrado; usando o modo LAN padrao."
fi

exec npx expo start --lan "$@"
