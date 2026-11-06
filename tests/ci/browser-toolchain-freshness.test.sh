#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKFLOW="$ROOT_DIR/.github/workflows/browser-toolchain-freshness.yml"
grep -Fq 'FORGEJO_TOKEN: ${{ github.token }}' "$WORKFLOW"
grep -Fq 'github.event.repository.default_branch' "$WORKFLOW"
if grep -Eq 'enable-openid-connect|ACTIONS_ID_TOKEN_REQUEST|BROWSER_FRESHNESS_AUDIENCE|secrets\.|steps\.oidc|permissions:' "$WORKFLOW"; then
  echo 'freshness workflow must use the built-in repository token without OIDC or PAT configuration' >&2
  exit 1
fi
TEMP_DIR="$(mktemp -d)"
SERVER_PID=''
cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

cat > "$TEMP_DIR/server.mjs" <<'NODE'
import http from 'node:http';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (req.url.startsWith('/api/')) appendFileSync(process.env.REQUEST_LOG, `AUTH ${req.headers.authorization}\n`);
  res.setHeader('content-type', 'application/json');
  if (req.url === '/npm-hang') return;
  if (req.url === '/npm-error') { res.statusCode = 503; return res.end('{}'); }
  if (req.url === '/npm') return res.end(JSON.stringify({ version: '1.65.0' }));
  if (req.url === '/chrome') return res.end(JSON.stringify({ channels: { Stable: { version: '157.0.1.2' } } }));
  if (req.url.startsWith('/api/repos/example/project/issues?')) {
    const mode = readFileSync(process.env.ISSUE_MODE_FILE, 'utf8');
    if (mode === 'hang') return;
    return res.end(mode === 'unrelated'
      ? JSON.stringify([{ number: 7, title: 'Browser toolchain freshness', body: 'This issue is not owned by the freshness automation.' }])
      : '[]');
  }
  if (req.url === '/api/repos/example/project/issues' && req.method === 'POST') {
    appendFileSync(process.env.REQUEST_LOG, `${req.method} ${req.url} ${body}\n`);
    return res.end(JSON.stringify({ number: 10 }));
  }
  if (req.url.startsWith('/api/repos/example/project/issues/') && req.method === 'PATCH') {
    appendFileSync(process.env.REQUEST_LOG, `${req.method} ${req.url} ${body}\n`);
    return res.end('{}');
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'unexpected request' }));
});
server.listen(0, '127.0.0.1', () => {
  writeFileSync(process.env.PORT_FILE, String(server.address().port));
});
NODE
printf 'empty' > "$TEMP_DIR/issue-mode"
PORT_FILE="$TEMP_DIR/port" REQUEST_LOG="$TEMP_DIR/requests.log" \
  ISSUE_MODE_FILE="$TEMP_DIR/issue-mode" node "$TEMP_DIR/server.mjs" &
SERVER_PID=$!
for _ in $(seq 1 50); do [ -s "$TEMP_DIR/port" ] && break; sleep 0.1; done
[ -s "$TEMP_DIR/port" ] || { echo 'fixture server did not start' >&2; exit 1; }
PORT="$(cat "$TEMP_DIR/port")"
mkdir -p "$TEMP_DIR/config" "$TEMP_DIR/.github/workflows"
cat > "$TEMP_DIR/config/browser-toolchain.json" <<'JSON'
{"playwrightVersion":"1.64.1","browserVersion":"156.0.8078.80","minimumBrowserVersion":"156.0.8078.73","browserSha256":"b711c720f774be355197f32edf37e0651418ba036d92446ee2da19ac017540a7"}
JSON
cat > "$TEMP_DIR/package-lock.json" <<'JSON'
{"packages":{"node_modules/playwright-core":{"version":"1.64.1"}}}
JSON
cat > "$TEMP_DIR/.github/workflows/ci.yml" <<'YAML'
jobs:
  browser:
    container:
      image: nexus.tabineko.dev/nekoguntai-castle/counting-cats-ci-playwright:pw1.64.1-chrome156.0.8078.79@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
YAML

output="$(PLAYWRIGHT_LATEST_URL="http://127.0.0.1:$PORT/npm" \
  CHROME_STABLE_URL="http://127.0.0.1:$PORT/chrome" \
  FORGEJO_API_URL="http://127.0.0.1:$PORT/api" \
  FORGEJO_REPOSITORY=example/project FORGEJO_TOKEN=fixture-secret \
  node "$ROOT_DIR/scripts/ci/check-browser-toolchain-freshness.mjs" "$TEMP_DIR")"
[[ "$output" == *'Freshness issue created'* ]]
grep -q 'Playwright: package pin 1.64.1, upstream latest 1.65.0' "$TEMP_DIR/requests.log"
grep -q 'Chrome for Testing Stable: configured 156.0.8078.80, upstream latest 157.0.1.2' "$TEMP_DIR/requests.log"
grep -q 'image tag pw1.64.1-chrome156.0.8078.79 differs from browser-toolchain.json' "$TEMP_DIR/requests.log"
grep -q '^AUTH Bearer fixture-secret$' "$TEMP_DIR/requests.log"
if [[ "$output" == *fixture-secret* ]]; then
  echo 'freshness checker exposed its API token in output' >&2
  exit 1
fi
echo 'PASS: freshness checker compares both feeds and creates an issue without exposing the token'

if missing_token_output="$(env -u FORGEJO_TOKEN \
  PLAYWRIGHT_LATEST_URL="http://127.0.0.1:$PORT/npm" \
  CHROME_STABLE_URL="http://127.0.0.1:$PORT/chrome" \
  FORGEJO_API_URL="http://127.0.0.1:$PORT/api" \
  FORGEJO_REPOSITORY=example/project \
  node "$ROOT_DIR/scripts/ci/check-browser-toolchain-freshness.mjs" "$TEMP_DIR" 2>&1)"; then
  echo 'freshness checker accepted a missing write token' >&2
  exit 1
fi
[[ "$missing_token_output" == *'FORGEJO_API_URL, FORGEJO_REPOSITORY and FORGEJO_TOKEN are required'* ]]
echo 'PASS: missing issue token fails visibly'

: > "$TEMP_DIR/requests.log"
printf 'unrelated' > "$TEMP_DIR/issue-mode"
unrelated_output="$(PLAYWRIGHT_LATEST_URL="http://127.0.0.1:$PORT/npm" \
  CHROME_STABLE_URL="http://127.0.0.1:$PORT/chrome" \
  FORGEJO_API_URL="http://127.0.0.1:$PORT/api" \
  FORGEJO_REPOSITORY=example/project FORGEJO_TOKEN=fixture-secret \
  node "$ROOT_DIR/scripts/ci/check-browser-toolchain-freshness.mjs" "$TEMP_DIR")"
[[ "$unrelated_output" == *'Freshness issue created'* ]]
grep -q '^POST /api/repos/example/project/issues .*browser-toolchain-freshness:managed' "$TEMP_DIR/requests.log"
if grep -q '^PATCH /api/repos/example/project/issues/7 ' "$TEMP_DIR/requests.log"; then
  echo 'freshness checker modified an unrelated same-title issue' >&2
  exit 1
fi
echo 'PASS: same-title unrelated issues are left untouched'

if feed_error="$(PLAYWRIGHT_LATEST_URL="http://127.0.0.1:$PORT/npm-error" \
  CHROME_STABLE_URL="http://127.0.0.1:$PORT/chrome" \
  FORGEJO_API_URL="http://127.0.0.1:$PORT/api" \
  FORGEJO_REPOSITORY=example/project FORGEJO_TOKEN=fixture-secret \
  node "$ROOT_DIR/scripts/ci/check-browser-toolchain-freshness.mjs" "$TEMP_DIR" 2>&1)"; then
  echo 'freshness checker accepted an upstream HTTP error' >&2
  exit 1
fi
[[ "$feed_error" == *'upstream version feed failed: npm HTTP 503'* ]]
echo 'PASS: upstream HTTP errors fail visibly'

if fetch_timeout="$(FRESHNESS_FETCH_TIMEOUT_MS=100 \
  PLAYWRIGHT_LATEST_URL="http://127.0.0.1:$PORT/npm-hang" \
  CHROME_STABLE_URL="http://127.0.0.1:$PORT/chrome" \
  FORGEJO_API_URL="http://127.0.0.1:$PORT/api" \
  FORGEJO_REPOSITORY=example/project FORGEJO_TOKEN=fixture-secret \
  node "$ROOT_DIR/scripts/ci/check-browser-toolchain-freshness.mjs" "$TEMP_DIR" 2>&1)"; then
  echo 'freshness checker did not time out a stalled feed' >&2
  exit 1
fi
[[ "$fetch_timeout" == *'npm version feed timed out after 100 ms'* ]]
echo 'PASS: stalled upstream feeds time out'

printf 'hang' > "$TEMP_DIR/issue-mode"
if api_timeout="$(FRESHNESS_FETCH_TIMEOUT_MS=100 \
  PLAYWRIGHT_LATEST_URL="http://127.0.0.1:$PORT/npm" \
  CHROME_STABLE_URL="http://127.0.0.1:$PORT/chrome" \
  FORGEJO_API_URL="http://127.0.0.1:$PORT/api" \
  FORGEJO_REPOSITORY=example/project FORGEJO_TOKEN=fixture-secret \
  node "$ROOT_DIR/scripts/ci/check-browser-toolchain-freshness.mjs" "$TEMP_DIR" 2>&1)"; then
  echo 'freshness checker did not time out a stalled issue API' >&2
  exit 1
fi
[[ "$api_timeout" == *'Forgejo API GET timed out after 100 ms'* ]]
echo 'PASS: stalled issue API calls time out'


# Sandbox revision findings are independent of the version-feed findings above.
printf 'empty' > "$TEMP_DIR/issue-mode"
write_sandbox_fixture() {
  node --input-type=module - "$TEMP_DIR" "$1" "$2" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
const [root, revision, suffix] = process.argv.slice(2);
const configPath = `${root}/config/browser-toolchain.json`;
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (revision === 'absent') delete config.sandboxPolicyRevision;
else config.sandboxPolicyRevision = JSON.parse(revision);
writeFileSync(configPath, JSON.stringify(config));
writeFileSync(`${root}/.github/workflows/ci.yml`, `jobs:\n  browser:\n    container:\n      image: nexus.tabineko.dev/nekoguntai-castle/sanctuary-ci-playwright:pw${config.playwrightVersion}-chrome${config.browserVersion}${suffix}@sha256:${'a'.repeat(64)}\n`);
NODE
}
run_sandbox_freshness() {
  PLAYWRIGHT_LATEST_URL="http://127.0.0.1:$PORT/npm" \
    CHROME_STABLE_URL="http://127.0.0.1:$PORT/chrome" \
    FORGEJO_API_URL="http://127.0.0.1:$PORT/api" \
    FORGEJO_REPOSITORY=example/project FORGEJO_TOKEN=fixture-secret \
    node "$ROOT_DIR/scripts/ci/check-browser-toolchain-freshness.mjs" "$TEMP_DIR"
}
for invalid_revision in 0 -1 1.5 '"1"' null 9007199254740992; do
  write_sandbox_fixture "$invalid_revision" '-sandbox1'
  : > "$TEMP_DIR/requests.log"
  if invalid_output="$(run_sandbox_freshness 2>&1)"; then
    echo "freshness checker accepted invalid sandbox revision $invalid_revision" >&2
    exit 1
  fi
  [[ "$invalid_output" == *'invalid sandboxPolicyRevision'* ]]
  [ ! -s "$TEMP_DIR/requests.log" ]
done
echo 'PASS: invalid sandbox policy revisions fail before issue API access'

for suffix in '' '-sandbox2'; do
  write_sandbox_fixture 1 "$suffix"
  : > "$TEMP_DIR/requests.log"
  run_sandbox_freshness >/dev/null
  grep -Fq 'image tag sandbox policy differs from browser-toolchain.json' "$TEMP_DIR/requests.log"
done
write_sandbox_fixture absent '-sandbox1'
: > "$TEMP_DIR/requests.log"
run_sandbox_freshness >/dev/null
grep -Fq 'image tag sandbox policy differs from browser-toolchain.json' "$TEMP_DIR/requests.log"
echo 'PASS: missing or mismatched tag/config sandbox revisions produce a drift finding'

write_sandbox_fixture 1 '-sandbox1'
: > "$TEMP_DIR/requests.log"
run_sandbox_freshness >/dev/null
if grep -Fq 'image tag sandbox policy differs from browser-toolchain.json' "$TEMP_DIR/requests.log"; then
  echo 'matching sandbox revisions produced a false drift finding' >&2
  exit 1
fi
echo 'PASS: matching sandbox revisions do not produce a policy drift finding'
