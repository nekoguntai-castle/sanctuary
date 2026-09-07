#!/usr/bin/env bash
# Resolve the Trezor Docker-exec loopback forwarder endpoints from the JSON
# document that scripts/ci/docker-exec-tcp-forwarder.mjs writes on stdout.
#
# Reads the file exactly once and validates every field before printing a
# single tab-separated line: host, controller port, bridge port, control port.
# Fails closed with a named diagnostic on any missing or implausible field so
# an empty host can never reach the exported TREZOR_EMULATOR_* environment
# (issue #1038, run 14994).
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo 'usage: resolve-trezor-forwarder-endpoints.sh <forwarder-endpoints.json>' >&2
  exit 2
fi
readonly endpoints_file="$1"

if [ ! -s "$endpoints_file" ]; then
  echo "Trezor forwarder endpoints file is missing or empty: $endpoints_file" >&2
  exit 1
fi

# One read of the file for all four fields; a parse failure yields no lines.
fields=()
mapfile -t fields < <(jq -r '
  [.host, .controllerPort, .bridgePort, .controlPort]
  | .[] | if . == null then "" else tostring end
' "$endpoints_file" 2>/dev/null)
if [ "${#fields[@]}" -ne 4 ]; then
  echo "Trezor forwarder endpoints file is not a JSON object: $endpoints_file" >&2
  exit 1
fi
readonly host="${fields[0]}" controller_port="${fields[1]}" bridge_port="${fields[2]}" control_port="${fields[3]}"

if [ "$host" != '127.0.0.1' ]; then
  echo "Unable to resolve Trezor proof host: forwarder reported '${host}' instead of 127.0.0.1" >&2
  exit 1
fi

port_is_valid() {
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$((10#$1))" -ge 1 ] && [ "$((10#$1))" -le 65535 ]
}

for pair in "controller:$controller_port" "bridge:$bridge_port" "control:$control_port"; do
  if ! port_is_valid "${pair#*:}"; then
    echo "Unable to resolve Trezor proof ${pair%%:*} port: forwarder reported '${pair#*:}'" >&2
    exit 1
  fi
done

printf '%s\t%s\t%s\t%s\n' "$host" "$controller_port" "$bridge_port" "$control_port"
