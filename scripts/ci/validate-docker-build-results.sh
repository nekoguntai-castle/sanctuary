#!/bin/bash
set -euo pipefail

if [ "$#" -ne 7 ]; then
  echo "Usage: $0 DETECT_RESULT FRONTEND_REQUESTED FRONTEND_RESULT BACKEND_REQUESTED BACKEND_RESULT GRAFANA_REQUESTED GRAFANA_RESULT" >&2
  exit 2
fi

detect_result="$1"
shift

validate_result() {
  local requested="$1" actual="$2" label="$3"
  case "$requested" in
    true)
      [ "$actual" = success ] \
        || { echo "$label was requested but result was $actual" >&2; return 1; }
      ;;
    false)
      [ "$actual" = skipped ] \
        || { echo "$label was not requested but result was $actual" >&2; return 1; }
      ;;
    *)
      echo "$label scope output is missing or invalid: $requested" >&2
      return 1
      ;;
  esac
}

[ "$detect_result" = success ] \
  || { echo "Image scope detection failed: $detect_result" >&2; exit 1; }
validate_result "$1" "$2" "Frontend image"
validate_result "$3" "$4" "Backend image"
validate_result "$5" "$6" "Grafana migration image"
