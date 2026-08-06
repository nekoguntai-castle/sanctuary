#!/bin/bash
# Block Claude from running npm/npx commands that start dev servers directly on the host.
# Sanctuary should only run via Docker containers (./start.sh or docker compose).

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Allow docker/git commands (even if they mention npm in arguments/messages)
if echo "$COMMAND" | grep -qE '^(docker|docker compose|docker-compose|git) '; then
  exit 0
fi

# Block commands that start with npm run dev/preview/start or npx vite (but not npx vitest)
if echo "$COMMAND" | grep -qE '^(npm run (dev|preview|start|serve)|npx vite([^s]|$)|yarn (dev|preview|start|serve)|pnpm (dev|preview|start|serve))'; then
  echo "BLOCKED: Do not run dev servers directly on the host. Use ./start.sh or docker compose instead." >&2
  exit 2
fi

# Block node_modules/.bin/vite invocations (but not vitest)
if echo "$COMMAND" | grep -qE '(^|/)node_modules/.bin/vite([^s]|$)'; then
  echo "BLOCKED: Do not run dev servers directly on the host. Use ./start.sh or docker compose instead." >&2
  exit 2
fi

exit 0
