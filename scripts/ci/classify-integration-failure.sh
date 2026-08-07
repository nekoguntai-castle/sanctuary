#!/usr/bin/env bash
set -uo pipefail

# Decides whether a failed backend-integration attempt may be retried.
#
# Exit 0  -> the log carries a database-loss signature; retrying is legitimate.
# Exit 1  -> anything else, including assertion failures. Do not retry.
#
# Why this exists
# ---------------
# test.yml used to wrap the whole integration group in a bare three-attempt
# loop that retried on ANY non-zero exit. It was written to self-heal a
# suspected mid-run Postgres wipe ("service container OOM-killed and recreated
# empty under shared-runner load"), but sanctuary#612 disproved that: the real
# cause was Docker DNS returning several containers for the `postgres` alias
# and rotating between them per connection, fixed in ff05e575.
#
# What the blanket retry still did was hide genuine flakiness. A spec that
# fails 1-in-5 survives three blind attempts about 124 times out of 125, which
# is indistinguishable from healthy at this repo's commit rate (sanctuary#713).
# It also tripled the time to report an honest regression.
#
# Scope of the signature list
# ---------------------------
# Connectivity and missing schema only. The *symptoms* #612 observed downstream
# of alias rotation — bulk 401s, advisory-lock timeouts, foreign-key violations
# — are deliberately excluded. Each is equally consistent with a real
# regression, and retrying them is exactly the assertion-blindness this
# replaces. If the database genuinely vanishes, Prisma reports it at the
# connection or schema layer first, and that is what this matches.

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ci/classify-integration-failure.sh LOG_FILE

Exits 0 if LOG_FILE shows a retryable database-loss failure, 1 otherwise.
A missing or unreadable log is treated as not retryable (fail closed).
EOF
}

# Connection-level and schema-level failures. Nothing an assertion can emit.
DATABASE_LOSS_PATTERN='P1001|P1017|P2021|Can.t reach database server|Connection terminated unexpectedly|ECONNREFUSED|the database system is (starting up|shutting down)|terminating connection due to administrator command|relation "[^"]+" does not exist|table "?public\.[a-z_]+"? does not exist|does not exist in the current database'

main() {
  if [ "$#" -ne 1 ]; then
    usage
    exit 1
  fi

  local log_file="$1"

  # Fail closed. An absent log is not evidence of infrastructure trouble, and
  # guessing "retryable" here would resurrect the blind behaviour by accident.
  if [ ! -r "$log_file" ]; then
    echo "classify-integration-failure: no readable log at ${log_file}; not retrying" >&2
    exit 1
  fi

  if grep -Eiq "$DATABASE_LOSS_PATTERN" "$log_file"; then
    echo "classify-integration-failure: database-loss signature found; retry permitted"
    exit 0
  fi

  echo "classify-integration-failure: no database-loss signature; treating as a real failure"
  exit 1
}

main "$@"
