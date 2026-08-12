#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/provider-context.sh
. "$script_dir/provider-context.sh"

fail() {
  echo "bootstrap-node: $*" >&2
  exit 1
}

read_lock_field() {
  local field="$1"
  node -e '
    const fs = require("node:fs");
    const [file, field] = process.argv.slice(1);
    const lock = JSON.parse(fs.readFileSync(file, "utf8"));
    const value = field.split(".").reduce((current, key) => current?.[key], lock);
    if (typeof value !== "string" || value.length === 0) process.exit(1);
    process.stdout.write(value);
  ' "$toolchain_lock" "$field" || fail "missing string lock field: $field"
}

verify_install() {
  local install_root="$1"
  [ -x "$install_root/bin/node" ] || return 1
  [ "$($install_root/bin/node --version)" = "v$expected_version" ]
}

install_locked_node() {
  local install_root="$1"
  local cache_parent
  cache_parent="$(dirname "$install_root")"
  mkdir -p "$cache_parent"

  exec 9>"${cache_parent}/.install.lock"
  command -v flock >/dev/null 2>&1 || fail 'flock is required for the shared tool cache'
  flock 9
  verify_install "$install_root" && return 0

  if [ -e "$install_root" ]; then
    mv "$install_root" "${install_root}.invalid.$(date +%s).$$"
  fi

  local staging archive extracted
  staging="$(mktemp -d "${cache_parent}/.node-${expected_version}.XXXXXX")"
  archive="$staging/node.tar.xz"
  extracted="$staging/extracted"
  mkdir -p "$extracted"
  curl --fail --silent --show-error --location --output "$archive" "$archive_url"
  printf '%s  %s\n' "$archive_sha256" "$archive" | sha256sum --check --status \
    || fail "SHA-256 mismatch for $archive_url"
  tar -xJf "$archive" --strip-components=1 -C "$extracted"
  verify_install "$extracted" || fail "archive did not contain Node.js $expected_version"
  mv "$extracted" "$install_root"
}

install_locked_npm() {
  local install_root="$1"
  local npm_bin="$install_root/bin/npm"
  if [ -x "$npm_bin" ] && [ "$(PATH="$install_root/bin:$PATH" "$npm_bin" --version)" = "$expected_npm_version" ]; then
    return 0
  fi

  local staging archive
  staging="$(mktemp -d "$(dirname "$install_root")/.npm-${expected_npm_version}.XXXXXX")"
  archive="$staging/npm.tgz"
  curl --fail --silent --show-error --location --output "$archive" "$npm_archive_url"
  printf '%s  %s\n' "$npm_archive_sha512" "$archive" | sha512sum --check --status \
    || fail "SHA-512 mismatch for $npm_archive_url"
  PATH="$install_root/bin:$PATH" "$npm_bin" install --global --audit=false --fund=false "$archive"
  [ "$(PATH="$install_root/bin:$PATH" "$npm_bin" --version)" = "$expected_npm_version" ] \
    || fail "npm installation did not select $expected_npm_version"
}

main() {
  [ "$#" -eq 0 ] || fail 'unexpected arguments'
  local repository_root
  repository_root="$(cd "$script_dir/../.." && pwd)"
  toolchain_lock="${SANCTUARY_TOOLCHAIN_LOCK_PATH:-$repository_root/config/ci-toolchain-lock.json}"
  [ -f "$toolchain_lock" ] || fail "toolchain lock not found: $toolchain_lock"

  expected_version="$(read_lock_field runtimes.node)"
  archive_url="$(read_lock_field artifacts.nodeLinuxX64.url)"
  archive_sha256="$(read_lock_field artifacts.nodeLinuxX64.sha256)"
  [[ "$archive_url" = "https://nodejs.org/dist/v${expected_version}/node-v${expected_version}-linux-x64.tar.xz" ]] \
    || fail 'Node archive URL does not match the locked runtime version'
  [[ "$archive_sha256" =~ ^[a-f0-9]{64}$ ]] || fail 'Node archive SHA-256 must be exact lowercase hex'

  local cache_root install_root
  cache_root="${RUNNER_TOOL_CACHE:-$(ci_temp_dir)/sanctuary-toolcache}"
  install_root="$cache_root/sanctuary-node/$expected_version/x64"
  install_locked_node "$install_root"

  case "${SANCTUARY_INSTALL_NPM:-true}" in
    true)
      expected_npm_version="$(read_lock_field runtimes.npm)"
      npm_archive_url="$(read_lock_field artifacts.npm.url)"
      npm_archive_sha512="$(read_lock_field artifacts.npm.sha512)"
      [[ "$npm_archive_url" = "https://registry.npmjs.org/npm/-/npm-${expected_npm_version}.tgz" ]] \
        || fail 'npm archive URL does not match the locked runtime version'
      [[ "$npm_archive_sha512" =~ ^[a-f0-9]{128}$ ]] || fail 'npm archive SHA-512 must be exact lowercase hex'
      install_locked_npm "$install_root"
      ;;
    false) ;;
    *) fail 'SANCTUARY_INSTALL_NPM must be true or false' ;;
  esac

  [ -n "${GITHUB_PATH:-}" ] || fail 'GITHUB_PATH is required'
  printf '%s\n' "$install_root/bin" >> "$GITHUB_PATH"
  echo "bootstrap-node: selected Node.js $expected_version from the checksum-locked cache"
}

toolchain_lock=''
expected_version=''
archive_url=''
archive_sha256=''
expected_npm_version=''
npm_archive_url=''
npm_archive_sha512=''
main "$@"
