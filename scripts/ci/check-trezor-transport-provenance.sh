#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo 'Usage: check-trezor-transport-provenance.sh PROVENANCE_JSON' >&2
  exit 2
fi

jq -e '
  if (.runtime.docker.server.componentNames | index("Podman Engine")) != null
  then .runtime.trezorTransport == "docker-exec-loopback"
  else .runtime.trezorTransport == "published-port"
  end
' "$1" >/dev/null
