#!/usr/bin/env bash
# Write a compact CI diagnostic summary for logs captured by
# scripts/ci/run-with-log.sh.
#
# Usage:
#   scripts/ci/write-diagnostic-summary.sh DIAGNOSTIC_DIR [TITLE]
#
# The helper is intentionally best-effort: diagnostics must not hide the
# original build result. It appends a small markdown table to the provider
# step summary and writes DIAGNOSTIC_DIR/diagnostic-index.md for the uploaded
# artifact. The step summary itself never inlines log bodies; the full
# redacted logs remain in the diagnostic artifact.
#
# When a captured log has a non-zero `wrapped_exit` in its sidecar JSON, or no
# usable sidecar at all, this helper additionally echoes the tail of that log
# (256 KiB cap, wrapped in `::group::` blocks) to STDERR so the failure is
# visible in the runner's step output without depending on the artifacts API.
# A missing or malformed sidecar is how a step killed mid-run presents, since
# run-with-log.sh writes the sidecar only after the wrapped command returns.
# Logs that completed cleanly are never echoed. Logs exceeding the inline cap
# are still complete in the uploaded artifact.
# See .github/CONTRIBUTING.md ("Diagnosing CI failures").

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
source "$SCRIPT_DIR/provider-context.sh"

usage() {
  cat >&2 <<'USAGE'
Usage: scripts/ci/write-diagnostic-summary.sh DIAGNOSTIC_DIR [TITLE]
USAGE
}

fail() {
  echo "write-diagnostic-summary: $*" >&2
  exit 1
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage
  fail 'expected a diagnostic directory and optional title'
fi

DIAGNOSTIC_DIR="$1"
TITLE="${2:-CI diagnostics}"

if [ -z "$DIAGNOSTIC_DIR" ]; then
  fail 'diagnostic directory is empty'
fi

mkdir -p "$DIAGNOSTIC_DIR"

SUMMARY_TMP="$(mktemp)"
INDEX_TMP="$(mktemp)"
LOCK_SUMMARY_TMP="$(mktemp)"

cleanup() {
  rm -f "$SUMMARY_TMP" "$INDEX_TMP" "$LOCK_SUMMARY_TMP"
}
trap cleanup EXIT

python3 - "$DIAGNOSTIC_DIR" "$TITLE" "$INDEX_TMP" >"$SUMMARY_TMP" <<'PY'
import json
import sys
from pathlib import Path

diag_dir = Path(sys.argv[1])
title = sys.argv[2]
index_tmp = Path(sys.argv[3])


def md_escape(value):
    text = str(value)
    return text.replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ")


def rel(path):
    try:
        return path.relative_to(diag_dir).as_posix()
    except ValueError:
        return path.as_posix()


def log_from_status(status_path):
    suffix = ".status.json"
    text = status_path.as_posix()
    if text.endswith(suffix):
        return Path(text[:-len(suffix)])
    return status_path


records_by_log = {}

for log_path in sorted(diag_dir.rglob("*.log")):
    records_by_log[log_path] = {"log": log_path, "status": Path(f"{log_path}.status.json")}

for status_path in sorted(diag_dir.rglob("*.log.status.json")):
    log_path = log_from_status(status_path)
    records_by_log.setdefault(log_path, {"log": log_path, "status": status_path})
    records_by_log[log_path]["status"] = status_path

records = []
for log_path in sorted(records_by_log):
    status_path = records_by_log[log_path]["status"]
    log_exists = log_path.is_file()
    status_exists = status_path.is_file()
    parsed = None
    status_note = "ok"

    if status_exists:
        try:
            parsed = json.loads(status_path.read_text(encoding="utf-8"))
        except Exception as exc:
            status_note = f"malformed: {exc.__class__.__name__}"
    else:
        status_note = "missing sidecar"

    wrapped_exit = "n/a"
    sink_status = "n/a"
    truncated = "n/a"
    started_at = "n/a"
    ended_at = "n/a"
    if isinstance(parsed, dict):
        wrapped_exit = parsed.get("wrapped_exit", "n/a")
        sink_status = parsed.get("sink_status", "n/a")
        truncated = parsed.get("truncated", "n/a")
        started_at = parsed.get("started_at", "n/a")
        ended_at = parsed.get("ended_at", "n/a")

    try:
        size = log_path.stat().st_size if log_exists else "missing"
    except OSError:
        size = "unavailable"

    needs_attention = (
        not log_exists
        or status_note != "ok"
        or str(wrapped_exit) not in ("0", "n/a")
        or sink_status not in ("ok", "n/a")
        or str(truncated).lower() == "true"
    )

    records.append({
        "log": rel(log_path),
        "sidecar": rel(status_path),
        "size": size,
        "wrapped_exit": wrapped_exit,
        "sink_status": sink_status,
        "truncated": truncated,
        "started_at": started_at,
        "ended_at": ended_at,
        "status_note": status_note,
        "attention": needs_attention,
    })

summary_lines = [
    f"## {title} Diagnostics",
    "",
    f"- Artifact directory: `{md_escape(diag_dir.as_posix())}`",
]

if not records:
    summary_lines.extend([
        "- No diagnostic logs were found.",
        "",
    ])
else:
    attention_count = sum(1 for record in records if record["attention"])
    summary_lines.extend([
        f"- Diagnostic logs indexed: `{len(records)}`",
        f"- Records needing attention: `{attention_count}`",
        "",
        "| Log | Wrapped exit | Sink | Truncated | Bytes | Status |",
        "| --- | ---: | --- | --- | ---: | --- |",
    ])
    for record in records:
        summary_lines.append(
            "| `{log}` | `{wrapped_exit}` | `{sink_status}` | `{truncated}` | `{size}` | {status_note} |".format(
                log=md_escape(record["log"]),
                wrapped_exit=md_escape(record["wrapped_exit"]),
                sink_status=md_escape(record["sink_status"]),
                truncated=md_escape(record["truncated"]),
                size=md_escape(record["size"]),
                status_note=md_escape(record["status_note"]),
            )
        )
    summary_lines.append("")
    summary_lines.append("Full redacted logs and sidecar JSON are in the uploaded diagnostic artifact.")
    summary_lines.append("")

index_lines = [
    f"# {title} Diagnostic Index",
    "",
    f"Directory: `{diag_dir.as_posix()}`",
    "",
]

if not records:
    index_lines.append("No diagnostic logs were found.")
    index_lines.append("")
else:
    index_lines.extend([
        "| Log | Sidecar | Wrapped exit | Sink | Truncated | Bytes | Started | Ended | Status |",
        "| --- | --- | ---: | --- | --- | ---: | --- | --- | --- |",
    ])
    for record in records:
        index_lines.append(
            "| `{log}` | `{sidecar}` | `{wrapped_exit}` | `{sink_status}` | `{truncated}` | `{size}` | `{started_at}` | `{ended_at}` | {status_note} |".format(
                log=md_escape(record["log"]),
                sidecar=md_escape(record["sidecar"]),
                wrapped_exit=md_escape(record["wrapped_exit"]),
                sink_status=md_escape(record["sink_status"]),
                truncated=md_escape(record["truncated"]),
                size=md_escape(record["size"]),
                started_at=md_escape(record["started_at"]),
                ended_at=md_escape(record["ended_at"]),
                status_note=md_escape(record["status_note"]),
            )
        )
    index_lines.append("")

index_tmp.write_text("\n".join(index_lines), encoding="utf-8")

# Echo failed-log bodies to stderr so a non-zero wrapped_exit is
# investigable in the runner's web UI step output without relying on
# the artifacts API (which is unreliable on the current Forgejo
# version). Bounded per-log so the runner output stays readable; the
# full redacted log is still in the uploaded diagnostic artifact.
ECHO_TAIL_BYTES = 256 * 1024  # 256 KiB per failed log


def worth_echoing(record):
    # The step ran and reported a non-zero status.
    if str(record["wrapped_exit"]) not in ("0", "n/a"):
        return True
    # No usable sidecar. run-with-log.sh writes it after the wrapped command
    # returns, so "missing" or "malformed" is what a step killed mid-run looks
    # like -- the case that most needs a log tail was the one case that never
    # got one, because "n/a" was filtered out alongside a clean exit 0.
    return record["status_note"] != "ok"


failed_records = [r for r in records if worth_echoing(r)]
if failed_records:
    print("=" * 72, file=sys.stderr)
    print(
        f"{title}: dumping captured logs for {len(failed_records)} failed step(s)",
        file=sys.stderr,
    )
    print("=" * 72, file=sys.stderr)
    for record in failed_records:
        log_path = diag_dir / record["log"]
        print(
            f"::group::Failed log tail ({record['log']}, exit={record['wrapped_exit']})",
            file=sys.stderr,
        )
        try:
            with log_path.open("rb") as fp:
                fp.seek(0, 2)
                size = fp.tell()
                start = max(0, size - ECHO_TAIL_BYTES)
                fp.seek(start)
                body = fp.read().decode("utf-8", errors="replace")
                if start > 0:
                    print(
                        f"... [omitted first {start} bytes; tail follows]",
                        file=sys.stderr,
                    )
                print(body, file=sys.stderr)
        except OSError as exc:
            print(f"(could not read log: {exc})", file=sys.stderr)
        print("::endgroup::", file=sys.stderr)

print("\n".join(summary_lines))
PY

mv "$INDEX_TMP" "$DIAGNOSTIC_DIR/diagnostic-index.md"
ci_emit_summary < "$SUMMARY_TMP"

# The logs still exist here on successful jobs, before failure-only diagnostic
# artifact policy discards them. Aggregate locally so green runs retain the
# lock wait/hold evidence without uploading verbose success-path logs. This is
# observability-only: malformed or incomplete telemetry cannot replace the
# owning command's result.
if bash "$SCRIPT_DIR/aggregate-runner-locks.sh" "$DIAGNOSTIC_DIR" > "$LOCK_SUMMARY_TMP"; then
  ci_emit_summary < "$LOCK_SUMMARY_TMP"
else
  ci_emit_warning 'Runner-lock aggregation failed; the owning job result is unchanged'
fi
