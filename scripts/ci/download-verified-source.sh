#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "download-verified-source: $*" >&2
  exit 1
}

if [ "$#" -ne 4 ]; then
  fail 'usage: LABEL URL SHA256 DESTINATION'
fi

readonly label="$1"
readonly url="$2"
readonly expected_sha256="$3"
readonly destination="$4"
readonly attempts="${SANCTUARY_DOWNLOAD_ATTEMPTS:-6}"
readonly delay_seconds="${SANCTUARY_DOWNLOAD_RETRY_DELAY_SECONDS:-5}"

[[ "$expected_sha256" =~ ^[0-9a-f]{64}$ ]] || fail 'SHA256 must be 64 lowercase hexadecimal characters'
[[ "$attempts" =~ ^[1-9][0-9]*$ ]] || fail 'SANCTUARY_DOWNLOAD_ATTEMPTS must be a positive integer'
[[ "$delay_seconds" =~ ^[0-9]+$ ]] || fail 'SANCTUARY_DOWNLOAD_RETRY_DELAY_SECONDS must be a non-negative integer'
mkdir -p "$(dirname "$destination")"
[ ! -e "$destination" ] || fail "destination already exists: $destination"
readonly partial="$(mktemp "${destination}.partial.XXXXXX")"
trap 'rm -f "$partial"' EXIT INT TERM

is_retryable_failure() {
  local curl_status="$1"
  local http_status="$2"
  if [ "$curl_status" -eq 22 ]; then
    case "$http_status" in
      408|429|5??) return 0 ;;
      *) return 1 ;;
    esac
  fi
  case "$curl_status" in
    5|6|7|18|28|52|55|56|92) return 0 ;;
    *) return 1 ;;
  esac
}

for attempt in $(seq 1 "$attempts"); do
  : > "$partial"
  echo "Downloading $label, attempt $attempt/$attempts" >&2
  set +e
  http_status="$(curl --fail --location --silent --show-error \
    --connect-timeout 30 --max-time 180 \
    --user-agent 'sanctuary-pinned-source-proof/1' \
    --output "$partial" --write-out '%{http_code}' "$url")"
  curl_status=$?
  set -e

  if [ "$curl_status" -eq 0 ]; then
    actual_sha256="$(sha256sum "$partial" | awk '{print $1}')"
    if [ "$actual_sha256" != "$expected_sha256" ]; then
      fail "$label checksum mismatch: expected=$expected_sha256 actual=$actual_sha256"
    fi
    mv "$partial" "$destination"
    trap - EXIT INT TERM
    exit 0
  fi

  if ! is_retryable_failure "$curl_status" "$http_status"; then
    fail "$label download failed permanently: curl=$curl_status http=$http_status"
  fi
  if [ "$attempt" -eq "$attempts" ]; then
    fail "$label download exhausted retries: curl=$curl_status http=$http_status"
  fi
  sleep $((attempt * delay_seconds))
done
