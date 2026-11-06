#!/usr/bin/env bash
set -euo pipefail

test_root="$(mktemp -d "${TMPDIR:-/tmp}/bootstrap-node-test.XXXXXX")"
trap 'rm -rf -- "$test_root"' EXIT
node_version=24.22.2
fixture_root="$test_root/fixture/node-v${node_version}-linux-x64"
mkdir -p "$fixture_root/bin" "$test_root/mock-bin"
printf '#!/usr/bin/env bash\nprintf "v%s\\n"\n' "$node_version" > "$fixture_root/bin/node"
chmod +x "$fixture_root/bin/node"
cat > "$fixture_root/bin/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = '--version' ]; then printf '0.0.0\n'; exit 0; fi
if [ "${1:-}" = 'install' ]; then
  [ "${FAIL_NPM_INSTALL:-false}" != 'true' ] || exit 42
  printf '#!/usr/bin/env bash\nprintf "12.0.2\\n"\n' > "$0.next"
  chmod +x "$0.next"
  mv "$0.next" "$0"
  exit 0
fi
exit 1
FAKE_NPM
chmod +x "$fixture_root/bin/npm"
tar -cJf "$test_root/node.tar.xz" -C "$test_root/fixture" "node-v${node_version}-linux-x64"
fixture_sha="$(sha256sum "$test_root/node.tar.xz" | awk '{print $1}')"
printf 'reviewed npm archive\n' > "$test_root/npm.tgz"
npm_fixture_sha="$(sha512sum "$test_root/npm.tgz" | awk '{print $1}')"

cat > "$test_root/mock-bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
output=''
url=''
if [ "${FAIL_CURL:-false}" = 'true' ]; then
  echo 'curl: (22) simulated download failure' >&2
  exit 22
fi
if [ "${TERMINATE_BOOTSTRAP:-false}" = 'true' ]; then
  kill -TERM "$PPID"
  exit 0
fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--output' ]; then output="$2"; shift 2
  elif [[ "$1" = https://* ]]; then url="$1"; shift
  else shift
  fi
done
[ -n "$output" ] && [ -n "$url" ]
if [[ "$url" = *registry.npmjs.org* ]]; then cp "$FAKE_NPM_ARCHIVE" "$output"
else cp "$FAKE_NODE_ARCHIVE" "$output"
fi
printf 'called\n' >> "$FAKE_CURL_MARKER"
MOCK
chmod +x "$test_root/mock-bin/curl"

write_lock() {
  local node_digest="$1"
  printf '{"runtimes":{"node":"%s","npm":"12.0.2"},"artifacts":{"nodeLinuxX64":{"url":"https://nodejs.org/dist/v%s/node-v%s-linux-x64.tar.xz","sha256":"%s"},"npm":{"url":"https://registry.npmjs.org/npm/-/npm-12.0.2.tgz","sha512":"%s"}}}\n' \
    "$node_version" "$node_version" "$node_version" "$node_digest" "$npm_fixture_sha" > "$test_root/toolchain-lock.json"
}

write_lock "$fixture_sha"
export PATH="$test_root/mock-bin:$PATH"
export FAKE_NODE_ARCHIVE="$test_root/node.tar.xz"
export FAKE_NPM_ARCHIVE="$test_root/npm.tgz"
export FAKE_CURL_MARKER="$test_root/curl-called"
export SANCTUARY_TOOLCHAIN_LOCK_PATH="$test_root/toolchain-lock.json"
export SANCTUARY_NODE_TOOL_CACHE="$test_root/cache"
export GITHUB_PATH="$test_root/github-path"
export SANCTUARY_INSTALL_NPM=true

grep -F 'cache_root="${SANCTUARY_NODE_TOOL_CACHE:-${HOME:?HOME is required}/.cache/sanctuary-toolcache}"' scripts/ci/bootstrap-node.sh >/dev/null
if grep -q 'RUNNER_TOOL_CACHE' scripts/ci/bootstrap-node.sh; then
  echo 'bootstrap must not use Forgejo runner-owned RUNNER_TOOL_CACHE' >&2
  exit 1
fi

scripts/ci/bootstrap-node.sh >/dev/null
selected_bin="$(tail -1 "$GITHUB_PATH")"
[ "$($selected_bin/node --version)" = "v$node_version" ]
[ "$($selected_bin/npm --version)" = '12.0.2' ]
[ -f "$FAKE_CURL_MARKER" ]
[ "$(wc -l < "$FAKE_CURL_MARKER")" -eq 2 ]
mv "$FAKE_CURL_MARKER" "$FAKE_CURL_MARKER.first"
scripts/ci/bootstrap-node.sh >/dev/null
[ ! -e "$FAKE_CURL_MARKER" ]

SANCTUARY_INSTALL_NPM=invalid scripts/ci/bootstrap-node.sh >"$test_root/mode.log" 2>&1 && exit 1
grep -q 'must be true or false' "$test_root/mode.log"

write_lock "$(printf '0%.0s' {1..64})"
SANCTUARY_NODE_TOOL_CACHE="$test_root/bad-cache" GITHUB_PATH="$test_root/bad-path" \
  scripts/ci/bootstrap-node.sh >"$test_root/bad.log" 2>&1 && exit 1
grep -q 'SHA-256 mismatch' "$test_root/bad.log"
write_lock "$fixture_sha"

FAIL_CURL=true SANCTUARY_NODE_TOOL_CACHE="$test_root/download-failure-cache" \
  GITHUB_PATH="$test_root/download-failure-path" scripts/ci/bootstrap-node.sh >"$test_root/download-failure.log" 2>&1 && exit 1
grep -q 'download failed' "$test_root/download-failure.log"
if find "$test_root/download-failure-cache" -name '.node-*' -print -quit | grep -q .; then
  echo 'bootstrap left a Node staging directory after a download failure' >&2
  exit 1
fi

npm_failure_cache="$test_root/npm-failure-cache"
FAIL_NPM_INSTALL=true SANCTUARY_NODE_TOOL_CACHE="$npm_failure_cache" \
  GITHUB_PATH="$test_root/npm-failure-path" scripts/ci/bootstrap-node.sh \
  >"$test_root/npm-failure.log" 2>&1 && exit 1
grep -q 'npm installation failed' "$test_root/npm-failure.log"
if find "$npm_failure_cache" \( -name '.node-*' -o -name '.npm-*' \) -print -quit | grep -q .; then
  echo 'bootstrap left a staging directory after an npm installation failure' >&2
  exit 1
fi

signal_cache="$test_root/signal-cache"
TERMINATE_BOOTSTRAP=true SANCTUARY_NODE_TOOL_CACHE="$signal_cache" \
  GITHUB_PATH="$test_root/signal-path" scripts/ci/bootstrap-node.sh >"$test_root/signal.log" 2>&1 &
bootstrap_pid=$!
if wait "$bootstrap_pid"; then
  echo 'bootstrap unexpectedly succeeded after its mocked download sent SIGTERM' >&2
  exit 1
else
  status=$?
  [ "$status" -eq 143 ] || { echo "unexpected bootstrap signal status: $status" >&2; exit 1; }
fi
if find "$signal_cache" -name '.node-*' -print -quit | grep -q .; then
  echo 'bootstrap left a Node staging directory after SIGTERM' >&2
  exit 1
fi

quarantine_cache="$test_root/quarantine-cache"
quarantine_install="$quarantine_cache/sanctuary-node/$node_version/x64"
mkdir -p "$quarantine_install/bin"
printf '#!/usr/bin/env bash\nprintf "wrong-version\\n"\n' > "$quarantine_install/bin/node"
chmod +x "$quarantine_install/bin/node"
printf 'preserve me\n' > "$(dirname "$quarantine_install")/neighbor"
FAIL_CURL=true SANCTUARY_NODE_TOOL_CACHE="$quarantine_cache" \
  GITHUB_PATH="$test_root/quarantine-path" scripts/ci/bootstrap-node.sh \
  >"$test_root/quarantine.log" 2>&1 && exit 1
grep -q 'download failed' "$test_root/quarantine.log"
quarantined="$(find "$(dirname "$quarantine_install")" -maxdepth 1 -type d -name 'x64.invalid.*' -print -quit)"
[ -n "$quarantined" ] && [ -x "$quarantined/bin/node" ]
[ "$(cat "$(dirname "$quarantine_install")/neighbor")" = 'preserve me' ]
if find "$(dirname "$quarantine_install")" \( -name '.node-*' -o -name '.npm-*' \) -print -quit | grep -q .; then
  echo 'bootstrap left a staging directory after invalid-cache quarantine' >&2
  exit 1
fi

printf 'PASS: checksum-locked Node bootstrap installs once, reuses cache, and cleans exact staging paths on failure and signal\n'
