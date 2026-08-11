#!/usr/bin/env bash
set -euo pipefail

is_ipv4() {
  local address="$1"
  local octets=()
  local octet

  IFS=. read -r -a octets <<< "$address"
  [ "${#octets[@]}" -eq 4 ] || return 1
  for octet in "${octets[@]}"; do
    [[ "$octet" =~ ^[0-9]+$ ]] || return 1
    [ "$((10#$octet))" -le 255 ] || return 1
  done
}

is_private_or_link_local_ipv4() {
  local address="$1"
  local octets=()

  is_ipv4 "$address" || return 1
  IFS=. read -r -a octets <<< "$address"
  [ "${octets[0]}" -eq 127 ] \
    || [ "${octets[0]}" -eq 10 ] \
    || { [ "${octets[0]}" -eq 169 ] && [ "${octets[1]}" -eq 254 ]; } \
    || { [ "${octets[0]}" -eq 172 ] && [ "${octets[1]}" -ge 16 ] && [ "${octets[1]}" -le 31 ]; } \
    || { [ "${octets[0]}" -eq 192 ] && [ "${octets[1]}" -eq 168 ]; }
}

resolve_bind_ip() {
  local published_host="$1"
  local configured_bind_ip="${SANCTUARY_DOCKER_PUBLISH_BIND_IP:-}"
  local resolved_output
  local resolved_addresses=()

  if [ -n "$configured_bind_ip" ]; then
    printf '%s\n' "$configured_bind_ip"
    return
  fi

  case "$published_host" in
    localhost|127.*)
      printf '%s\n' '127.0.0.1'
      return
      ;;
  esac

  if ! resolved_output="$(getent ahostsv4 "$published_host" | awk '$2 == "STREAM" {print $1}' | LC_ALL=C sort -u)"; then
    echo "Unable to resolve the Trezor published host to IPv4: $published_host" >&2
    return 1
  fi
  mapfile -t resolved_addresses <<< "$resolved_output"
  if [ "${#resolved_addresses[@]}" -ne 1 ] || [ -z "${resolved_addresses[0]}" ]; then
    echo "Trezor published host must resolve to exactly one IPv4 address: $published_host" >&2
    return 1
  fi
  printf '%s\n' "${resolved_addresses[0]}"
}

published_host="${SANCTUARY_DOCKER_PUBLISHED_HOST:-127.0.0.1}"
publish_bind_ip="$(resolve_bind_ip "$published_host")"

if ! is_ipv4 "$publish_bind_ip"; then
  echo "Trezor proof bind address is not a valid IPv4 address: $publish_bind_ip" >&2
  exit 1
fi
if [ "$publish_bind_ip" = '0.0.0.0' ]; then
  echo "Refusing wildcard Trezor proof port binding: $publish_bind_ip" >&2
  exit 1
fi
if ! is_private_or_link_local_ipv4 "$publish_bind_ip" \
  && [ "${SANCTUARY_TREZOR_ALLOW_PUBLIC_BIND:-0}" != '1' ]; then
  echo "Refusing public Trezor proof port binding without SANCTUARY_TREZOR_ALLOW_PUBLIC_BIND=1: $publish_bind_ip" >&2
  exit 1
fi

printf '%s\t%s\n' "$publish_bind_ip" "$published_host"
