#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo 'Usage: scripts/ci/aggregate-runner-locks.sh DIAGNOSTIC_DIR [--json-out FILE]' >&2
}

fail() {
  echo "aggregate-runner-locks: $*" >&2
  exit 1
}

[ "$#" -ge 1 ] && [ "$#" -le 3 ] || { usage; fail 'invalid arguments'; }
diagnostic_dir="$1"
shift
json_out="$diagnostic_dir/runner-lock-summary.json"
if [ "$#" -gt 0 ]; then
  [ "$#" -eq 2 ] && [ "$1" = '--json-out' ] || { usage; fail 'invalid arguments'; }
  json_out="$2"
fi

[ -d "$diagnostic_dir" ] || fail "diagnostic directory not found: $diagnostic_dir"
mkdir -p "$(dirname "$json_out")"

python3 - "$diagnostic_dir" "$json_out" <<'PY'
import json
import os
import re
import sys
import tempfile
from collections import defaultdict, deque
from pathlib import Path

root = Path(sys.argv[1])
json_out = Path(sys.argv[2])
acquired_re = re.compile(r"runner-lock: acquired ([A-Za-z0-9._-]+) after ([0-9]+)s")
released_re = re.compile(r"runner-lock: released ([A-Za-z0-9._-]+) held ([0-9]+)s status=([0-9]+)")
timeout_re = re.compile(r"runner-lock: timeout ([A-Za-z0-9._-]+) after ([0-9]+)s")
records = []


def relative(path):
    return path.relative_to(root).as_posix()


for log_path in sorted(root.rglob("*.log")):
    # Only run-with-log-owned logs have an atomic status sidecar. Some lanes
    # tee nested attempt logs into that canonical outer log; consuming the
    # sidecar-less copies would count one physical lock invocation twice.
    if not Path(f"{log_path}.status.json").is_file():
        continue
    pending = defaultdict(deque)
    try:
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        continue
    for line_number, line in enumerate(lines, start=1):
        match = acquired_re.fullmatch(line)
        if match:
            pending[match.group(1)].append({
                "source": relative(log_path),
                "line": line_number,
                "lock": match.group(1),
                "wait_seconds": int(match.group(2)),
                "hold_seconds": None,
                "status": None,
                "outcome": "incomplete",
            })
            continue
        match = released_re.fullmatch(line)
        if match:
            lock_name = match.group(1)
            if pending[lock_name]:
                record = pending[lock_name].popleft()
                record.update({
                    "hold_seconds": int(match.group(2)),
                    "status": int(match.group(3)),
                    "outcome": "success" if match.group(3) == "0" else "child-failure",
                })
                records.append(record)
            else:
                records.append({
                    "source": relative(log_path),
                    "line": line_number,
                    "lock": lock_name,
                    "wait_seconds": None,
                    "hold_seconds": int(match.group(2)),
                    "status": int(match.group(3)),
                    "outcome": "incomplete",
                })
            continue
        match = timeout_re.fullmatch(line)
        if match:
            records.append({
                "source": relative(log_path),
                "line": line_number,
                "lock": match.group(1),
                "wait_seconds": int(match.group(2)),
                "hold_seconds": None,
                "status": None,
                "outcome": "timeout",
            })
    for queue in pending.values():
        records.extend(queue)

records.sort(key=lambda item: (item["source"], item["line"], item["lock"]))
grouped = defaultdict(list)
for record in records:
    grouped[record["lock"]].append(record)

aggregates = []
for lock_name in sorted(grouped):
    rows = grouped[lock_name]
    waits = [row["wait_seconds"] for row in rows if row["wait_seconds"] is not None]
    holds = [row["hold_seconds"] for row in rows if row["hold_seconds"] is not None]
    aggregates.append({
        "lock": lock_name,
        "invocations": len(rows),
        "contended": sum(value >= 1 for value in waits),
        "timeouts": sum(row["outcome"] == "timeout" for row in rows),
        "failures": sum(row["outcome"] == "child-failure" for row in rows),
        "incomplete": sum(row["outcome"] == "incomplete" for row in rows),
        "total_wait_seconds": sum(waits) if waits else None,
        "known_waits": len(waits),
        "total_hold_seconds": sum(holds) if holds else None,
        "known_holds": len(holds),
    })

report = {
    "schema_version": 1,
    "precision": "whole-seconds",
    "source_directory": root.as_posix(),
    "invocations": records,
    "aggregates": aggregates,
}
json_out.parent.mkdir(parents=True, exist_ok=True)
fd, temp_name = tempfile.mkstemp(prefix=f".{json_out.name}.", dir=json_out.parent)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")
    os.replace(temp_name, json_out)
finally:
    if os.path.exists(temp_name):
        os.unlink(temp_name)


def value_with_coverage(total, known, count):
    if total is None:
        return "n/a"
    suffix = "" if known == count else f" ({known}/{count} known)"
    return f"{total}s{suffix}"


print("### Runner Lock Wait/Hold")
print("")
print("Whole-second measurements from this job's captured logs; unavailable values are never treated as zero.")
print("")
if not aggregates:
    print("No runner-lock records were found.")
    raise SystemExit(0)
print("| Lock | Invocations | Contended | Wait total | Hold total | Timeouts | Failures | Incomplete |")
print("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
for row in aggregates:
    count = row["invocations"]
    print(
        f"| `{row['lock']}` | {count} | {row['contended']} | "
        f"{value_with_coverage(row['total_wait_seconds'], row['known_waits'], count)} | "
        f"{value_with_coverage(row['total_hold_seconds'], row['known_holds'], count)} | "
        f"{row['timeouts']} | {row['failures']} | {row['incomplete']} |"
    )
PY
