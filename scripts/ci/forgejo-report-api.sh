#!/usr/bin/env bash
# Shared, read-only Forgejo Actions API helpers for CI reporting scripts.
# Source this file; it intentionally performs no work at load time.

forgejo_report_error() {
  echo "forgejo-report-api: $*" >&2
  return 1
}

forgejo_report_resolve_context() {
  local token api_base repository owner repo

  token="${SANCTUARY_FORGE_TOKEN:-${FORGEJO_TOKEN:-}}"
  [ -n "$token" ] || forgejo_report_error \
    'no API token in SANCTUARY_FORGE_TOKEN / FORGEJO_TOKEN' || return 1
  case "$token" in
    *$'\r'*|*$'\n'*|*'\'*|*'"'*)
      forgejo_report_error 'API token contains characters unsafe for curl config input'
      return 1
      ;;
  esac

  api_base="${SANCTUARY_FORGE_API_URL:-${FORGEJO_API_URL:-${FORGEJO_URL:-}}}"
  [ -n "$api_base" ] || forgejo_report_error \
    'no Forgejo API URL in SANCTUARY_FORGE_API_URL / FORGEJO_API_URL / FORGEJO_URL' || return 1
  api_base="${api_base%/}"
  case "$api_base" in
    http://*|https://*) ;;
    *) forgejo_report_error 'Forgejo API URL must use http or https'; return 1 ;;
  esac
  case "$api_base" in
    */api/v1) ;;
    *) api_base="$api_base/api/v1" ;;
  esac

  repository="${FORGEJO_REPOSITORY:-}"
  if [ -n "$repository" ]; then
    case "$repository" in
      */*)
        owner="${repository%%/*}"
        repo="${repository#*/}"
        ;;
      *) forgejo_report_error 'FORGEJO_REPOSITORY must be owner/repo'; return 1 ;;
    esac
    if [ -z "$owner" ] || [ -z "$repo" ] || [[ "$repo" == */* ]]; then
      forgejo_report_error 'FORGEJO_REPOSITORY must contain exactly one owner/name pair'
      return 1
    fi
  else
    owner="${SANCTUARY_FORGE_OWNER:-${FORGEJO_OWNER:-}}"
    repo="${SANCTUARY_FORGE_REPO:-${FORGEJO_REPO:-}}"
    if [ -z "$owner" ] || [ -z "$repo" ]; then
      forgejo_report_error \
        'cannot resolve repository (set FORGEJO_REPOSITORY or an owner/repo pair)'
      return 1
    fi
  fi

  if [[ ! "$owner" =~ ^[A-Za-z0-9._-]+$ ]] || [[ ! "$repo" =~ ^[A-Za-z0-9._-]+$ ]]; then
    forgejo_report_error 'Forgejo owner and repository contain unsupported characters'
    return 1
  fi

  FORGEJO_REPORT_TOKEN="$token"
  FORGEJO_REPORT_REPO_API="$api_base/repos/$owner/$repo"
  export -n SANCTUARY_FORGE_TOKEN FORGEJO_TOKEN FORGEJO_REPORT_TOKEN 2>/dev/null || true
}

forgejo_report_get() {
  local relative_path="$1"
  local output_file="$2"
  local max_bytes="${3:-}"
  local accept="${4:-application/json}"
  local http_code partial_file header_file
  local -a curl_args

  case "$relative_path" in
    /*|*'..'*) forgejo_report_error 'refusing unsafe API-relative path'; return 1 ;;
  esac
  if [ -n "$max_bytes" ] && { [[ ! "$max_bytes" =~ ^[1-9][0-9]*$ ]]; }; then
    forgejo_report_error 'maximum response size must be a positive integer'
    return 1
  fi
  case "$accept" in
    application/json|application/zip) ;;
    *) forgejo_report_error 'unsupported response media type'; return 1 ;;
  esac

  partial_file="${output_file}.partial.$$"
  header_file="${partial_file}.headers"
  curl_args=(
    --silent --show-error --connect-timeout 10 --max-time 60
    --header "Accept: $accept"
  )
  if [ -n "$max_bytes" ]; then
    command -v python3 >/dev/null 2>&1 || {
      forgejo_report_error 'bounded responses require python3'
      return 1
    }
    if ! (
      set -o pipefail
      printf 'header = "Authorization: token %s"\n' "$FORGEJO_REPORT_TOKEN" |
        curl --config - "${curl_args[@]}" --dump-header "$header_file" --output - \
          "$FORGEJO_REPORT_REPO_API/$relative_path" |
        python3 -c '
import sys

path = sys.argv[1]
limit = int(sys.argv[2])
total = 0
with open(path, "wb") as output:
    while True:
        chunk = sys.stdin.buffer.read(min(65536, limit - total + 1))
        if not chunk:
            break
        if total + len(chunk) > limit:
            raise SystemExit(3)
        output.write(chunk)
        total += len(chunk)
' "$partial_file" "$max_bytes"
    ); then
      rm -f -- "$partial_file" "$header_file"
      forgejo_report_error "GET $relative_path failed at the transport boundary"
      return 1
    fi
    http_code="$(awk '/^HTTP\/[0-9.]+ [0-9][0-9][0-9]/{code=$2} END{print code}' "$header_file")"
    rm -f -- "$header_file"
  else
    curl_args+=(--output "$partial_file" --write-out '%{http_code}')
    if ! http_code="$(
      printf 'header = "Authorization: token %s"\n' "$FORGEJO_REPORT_TOKEN" |
        curl --config - "${curl_args[@]}" "$FORGEJO_REPORT_REPO_API/$relative_path"
    )"; then
      rm -f -- "$partial_file"
      forgejo_report_error "GET $relative_path failed at the transport boundary"
      return 1
    fi
  fi
  if [ "$http_code" != '200' ]; then
    rm -f -- "$partial_file"
    forgejo_report_error "GET $relative_path returned HTTP $http_code"
    return 1
  fi
  mv -- "$partial_file" "$output_file"
}
