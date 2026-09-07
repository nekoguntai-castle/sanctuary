#!/bin/bash
# PreToolUse hook: refuse edits to files that should not be hand-modified by Claude.
# - Lock files: npm records no "overrides" key in package-lock.json, so a hand-edit
#   can silently drift a resolved version away from the pin that package.json
#   declares. The effective pins live in package.json (protobufjs, hono, ...) and
#   docs/site/package.json (uuid, ...) -- never in a workspace member, whose
#   "overrides" npm ignores. Change deps via the package manager.
#   Known limit: the matcher in .claude/settings.json is Edit|Write|NotebookEdit,
#   so this hook does not see a lock file rewritten from Bash (jq/sed/mv).
#   tests/ci/npmOverridesApplied.test.ts is what actually catches the drift.
# - .env / .env.* : secrets surface; user-managed.
# - Applied Prisma migration SQL: migrations are immutable once created. Edit the
#   schema and generate a new migration via the /migration skill instead.

set -u

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Normalize to basename for some checks
BASENAME=$(basename "$FILE_PATH")

block() {
  echo "BLOCKED: $1" >&2
  exit 2
}

case "$BASENAME" in
  package-lock.json|yarn.lock|pnpm-lock.yaml)
    block "Do not hand-edit lock files. Add/remove deps via the package manager so the override pins in package.json stay enforced. ($FILE_PATH)"
    ;;
esac

case "$BASENAME" in
  .env|.env.*|.envrc)
    block "Do not edit .env files. They contain secrets and are user-managed. Ask the user to make the change. ($FILE_PATH)"
    ;;
esac

# Block edits to already-applied migration SQL.
case "$FILE_PATH" in
  */prisma/migrations/*/migration.sql)
    block "Prisma migration SQL is immutable once created. Edit server/prisma/schema.prisma and generate a new migration via the /migration skill. ($FILE_PATH)"
    ;;
esac

exit 0
