#!/usr/bin/env bash
set -euo pipefail

test_root="$(mktemp -d "${TMPDIR:-/tmp}/bootstrap-node-test.XXXXXX")"
fixture_root="$test_root/fixture/node-v24.19.0-linux-x64"
mkdir -p "$fixture_root/bin" "$test_root/mock-bin"
printf '#!/usr/bin/env bash\nprintf "v24.19.0\\n"\n' > "$fixture_root/bin/node"
chmod +x "$fixture_root/bin/node"
cat > "$fixture_root/bin/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = '--version' ]; then printf '0.0.0\n'; exit 0; fi
if [ "${1:-}" = 'install' ]; then
  printf '#!/usr/bin/env bash\nprintf "11.19.0\\n"\n' > "$0.next"
  chmod +x "$0.next"
  mv "$0.next" "$0"
  exit 0
fi
exit 1
FAKE_NPM
chmod +x "$fixture_root/bin/npm"
tar -cJf "$test_root/node.tar.xz" -C "$test_root/fixture" node-v24.19.0-linux-x64
fixture_sha="$(sha256sum "$test_root/node.tar.xz" | awk '{print $1}')"
printf 'reviewed npm archive\n' > "$test_root/npm.tgz"
npm_fixture_sha="$(sha512sum "$test_root/npm.tgz" | awk '{print $1}')"

cat > "$test_root/mock-bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
output=''
url=''
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
  printf '{"runtimes":{"node":"24.19.0","npm":"11.19.0"},"artifacts":{"nodeLinuxX64":{"url":"https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz","sha256":"%s"},"npm":{"url":"https://registry.npmjs.org/npm/-/npm-11.19.0.tgz","sha512":"%s"}}}\n' "$node_digest" "$npm_fixture_sha" > "$test_root/toolchain-lock.json"
}

write_lock "$fixture_sha"
export PATH="$test_root/mock-bin:$PATH"
export FAKE_NODE_ARCHIVE="$test_root/node.tar.xz"
export FAKE_NPM_ARCHIVE="$test_root/npm.tgz"
export FAKE_CURL_MARKER="$test_root/curl-called"
export SANCTUARY_TOOLCHAIN_LOCK_PATH="$test_root/toolchain-lock.json"
export RUNNER_TOOL_CACHE="$test_root/cache"
export GITHUB_PATH="$test_root/github-path"
export SANCTUARY_INSTALL_NPM=true

scripts/ci/bootstrap-node.sh >/dev/null
selected_bin="$(tail -1 "$GITHUB_PATH")"
[ "$($selected_bin/node --version)" = 'v24.19.0' ]
[ "$($selected_bin/npm --version)" = '11.19.0' ]
[ -f "$FAKE_CURL_MARKER" ]
[ "$(wc -l < "$FAKE_CURL_MARKER")" -eq 2 ]
mv "$FAKE_CURL_MARKER" "$FAKE_CURL_MARKER.first"
scripts/ci/bootstrap-node.sh >/dev/null
[ ! -e "$FAKE_CURL_MARKER" ]

SANCTUARY_INSTALL_NPM=invalid scripts/ci/bootstrap-node.sh >"$test_root/mode.log" 2>&1 && exit 1
grep -q 'must be true or false' "$test_root/mode.log"

write_lock "$(printf '0%.0s' {1..64})"
RUNNER_TOOL_CACHE="$test_root/bad-cache" GITHUB_PATH="$test_root/bad-path" \
  scripts/ci/bootstrap-node.sh >"$test_root/bad.log" 2>&1 && exit 1
grep -q 'SHA-256 mismatch' "$test_root/bad.log"

printf 'PASS: checksum-locked Node bootstrap installs once, reuses cache, and rejects drift\n'
