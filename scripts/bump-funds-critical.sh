#!/usr/bin/env bash
# Coordinated bump for a single funds-critical package pinned in
# config/ci-toolchain-lock.json (fundsCriticalPackages). Renovate cannot open
# a passing PR for these packages (scripts/ci/check-supply-chain-locks.mjs
# enforces one reviewed version+integrity across every listed manifest and
# lockfile) so a bump has to touch all of them together. This script drives
# that mechanical part; it never runs Docker and never regenerates vectors.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

LOCK_CONFIG="config/ci-toolchain-lock.json"
SCOPE_CONFIG="config/signing-dependency-scope.json"
NPM_BIN="${SANCTUARY_BUMP_NPM_BIN:-npm}"
REPORT_BIN="${SANCTUARY_BUMP_REPORT_BIN:-}"
GATE_BIN="${SANCTUARY_BUMP_GATE_BIN:-}"
TIMEOUT_SECONDS="${SANCTUARY_BUMP_TIMEOUT_SECONDS:-30}"

DRY_RUN=false
ALLOW_DIRTY=false
PACKAGE=""
NEW_VERSION=""

fail() { echo -e "${RED}bump-funds-critical:${NC} $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: scripts/bump-funds-critical.sh <package> <version> [--dry-run] [--allow-dirty]

Bumps one funds-critical package (config/ci-toolchain-lock.json
fundsCriticalPackages) to an exact new version across every manifest and
lockfile the lock config lists for it, then re-pins the lock config and runs
the supply-chain gate. Prints the remaining manual steps (vector
regeneration, version-string files, upstream tarball review) that this
script does not perform.

Arguments:
  <package>      Exact name of a fundsCriticalPackages entry.
  <version>      Exact new version (no range operators).

Options:
  --dry-run      Report what would change without touching any file.
  --allow-dirty  Skip the clean working tree requirement.
  -h, --help     Show this help and exit.

This script never runs Docker, never regenerates verification vectors, and
never touches Prisma. See "Bumping a funds-critical package" in
docs/reference/ci-cd-strategy.md for the full procedure.
EOF
}

parse_args() {
  local positional=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -h|--help) usage; exit 0 ;;
      --dry-run) DRY_RUN=true; shift ;;
      --allow-dirty) ALLOW_DIRTY=true; shift ;;
      --) shift; while [[ $# -gt 0 ]]; do positional+=("$1"); shift; done ;;
      -*) usage; fail "unknown option: $1" ;;
      *) positional+=("$1"); shift ;;
    esac
  done
  [[ ${#positional[@]} -eq 2 ]] || { usage; fail "expected exactly a package and a version"; }
  PACKAGE="${positional[0]}"
  NEW_VERSION="${positional[1]}"
  [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]] \
    || fail "version must be an exact semver (no ranges): $NEW_VERSION"
}

require_tools() {
  command -v jq >/dev/null || fail "jq is required"
  command -v node >/dev/null || fail "node is required"
  command -v "$NPM_BIN" >/dev/null || fail "npm command is unavailable: $NPM_BIN"
  command -v timeout >/dev/null || fail "timeout (GNU coreutils) is required"
  [[ -f "$LOCK_CONFIG" ]] || fail "missing $LOCK_CONFIG"
}

policy_names() { jq -r '.fundsCriticalPackages[].name' "$LOCK_CONFIG"; }

policy_field() {
  jq -r --arg name "$PACKAGE" --arg field "$1" \
    '.fundsCriticalPackages[] | select(.name == $name) | .[$field] // empty' "$LOCK_CONFIG"
}

policy_array() {
  jq -r --arg name "$PACKAGE" --arg field "$1" \
    '.fundsCriticalPackages[] | select(.name == $name) | .[$field][]?' "$LOCK_CONFIG"
}

validate_package() {
  local names
  names="$(policy_names)"
  grep -qxF "$PACKAGE" <<<"$names" \
    || fail "unknown funds-critical package: $PACKAGE. Valid packages: $(tr '\n' ',' <<<"$names" | sed 's/,$//')"
}

check_clean_tree() {
  $ALLOW_DIRTY && return 0
  command -v git >/dev/null || fail "git is required (or pass --allow-dirty)"
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "not a git working tree (or pass --allow-dirty)"
  [[ -z "$(git status --porcelain)" ]] \
    || fail "working tree is dirty; commit or stash first, or pass --allow-dirty"
}

fetch_registry_integrity() {
  local spec="${PACKAGE}@${NEW_VERSION}" out
  if ! out="$(timeout "$TIMEOUT_SECONDS" "$NPM_BIN" view "$spec" dist.integrity 2>/dev/null)"; then
    fail "version does not exist on the registry (or the registry call failed): $spec"
  fi
  out="$(tr -d '[:space:]' <<<"$out")"
  [[ -n "$out" ]] || fail "version does not exist on the registry: $spec"
  [[ "$out" =~ ^sha512-[A-Za-z0-9+/=]+$ ]] || fail "registry returned a malformed integrity for $spec: $out"
  echo "$out"
}

# Reads a manifest and reports whether it declares $PACKAGE in
# dependencies/devDependencies/overrides, without writing anything.
manifest_declares_package() {
  jq -e --arg name "$PACKAGE" \
    '(.dependencies[$name]? // .devDependencies[$name]? // .overrides[$name]?) != null' \
    "$1" >/dev/null
}

update_manifest() {
  local file=$1
  node - "$file" "$PACKAGE" "$NEW_VERSION" <<'NODE'
const fs = require('node:fs');
const [, , file, name, version] = process.argv;
const raw = fs.readFileSync(file, 'utf8');
const data = JSON.parse(raw);
let touched = false;
for (const section of ['dependencies', 'devDependencies', 'overrides']) {
  if (data[section] && Object.prototype.hasOwnProperty.call(data[section], name)) {
    data[section][name] = version;
    touched = true;
  }
}
if (!touched) { process.stderr.write('missing declaration'); process.exit(1); }
const trailer = raw.endsWith('\n') ? '\n' : '';
fs.writeFileSync(file, JSON.stringify(data, null, 2) + trailer);
NODE
}

update_lock_config() {
  node - "$LOCK_CONFIG" "$PACKAGE" "$NEW_VERSION" "$1" <<'NODE'
const fs = require('node:fs');
const [, , file, name, version, integrity] = process.argv;
const raw = fs.readFileSync(file, 'utf8');
const data = JSON.parse(raw);
const entry = (data.fundsCriticalPackages || []).find((p) => p.name === name);
if (!entry) { process.stderr.write('missing policy entry'); process.exit(1); }
entry.version = version;
entry.integrity = integrity;
const trailer = raw.endsWith('\n') ? '\n' : '';
fs.writeFileSync(file, JSON.stringify(data, null, 2) + trailer);
NODE
}

# Fails loudly (leaving the tree untouched for inspection) unless every
# packages[] entry that changed between the before/after lockfile snapshots
# belongs to the target's dependency closure. npm legitimately updates the
# workspace root dependency metadata and may re-resolve nested transitive
# dependencies when an exact package pin moves; unrelated lockfile churn must
# still fail closed. Resolution is path-aware: package names alone are not
# sufficient because an unrelated nested copy may share the same name.
assert_lockfile_scope() {
  local before=$1 after=$2
  node - "$before" "$after" "$PACKAGE" <<'NODE'
const fs = require('node:fs');
const [, , beforeFile, afterFile, name] = process.argv;
const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8')).packages || {};
const after = JSON.parse(fs.readFileSync(afterFile, 'utf8')).packages || {};
const packageName = (key) => {
  const marker = '/node_modules/';
  const start = key.lastIndexOf(marker);
  if (start >= 0) return key.slice(start + marker.length).startsWith('@')
    ? key.slice(start + marker.length).split('/').slice(0, 2).join('/')
    : key.slice(start + marker.length).split('/')[0];
  if (key.startsWith('node_modules/')) return key.slice('node_modules/'.length).startsWith('@')
    ? key.slice('node_modules/'.length).split('/').slice(0, 2).join('/')
    : key.slice('node_modules/'.length).split('/')[0];
  return null;
};
const packageKeysByName = (lock, packageToFind) => Object.keys(lock)
  .filter((key) => packageName(key) === packageToFind);
const resolveDependency = (lock, fromKey, dependency) => {
  let directory = fromKey;
  while (true) {
    const candidate = `${directory}/node_modules/${dependency}`.replace(/^\//, '');
    if (lock[candidate] !== undefined) return candidate;
    const marker = directory.lastIndexOf('/node_modules/');
    if (marker < 0) {
      const rootCandidate = `node_modules/${dependency}`;
      return lock[rootCandidate] === undefined ? null : rootCandidate;
    }
    directory = directory.slice(0, marker);
  }
};
const allowedPackagePaths = new Set();
const pending = [];
for (const lock of [before, after]) {
  for (const targetPath of packageKeysByName(lock, name)) {
    allowedPackagePaths.add(targetPath);
    pending.push([lock, targetPath]);
  }
}
const visited = new Set();
while (pending.length) {
  const [lock, currentPath] = pending.pop();
  const lockId = lock === before ? 'before' : 'after';
  const visitKey = `${lockId}:${currentPath}`;
  if (visited.has(visitKey)) continue;
  visited.add(visitKey);
  const entry = lock[currentPath];
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(entry?.[section] ?? {})) {
      const resolvedPath = resolveDependency(lock, currentPath, dependency);
      if (!resolvedPath) continue;
      allowedPackagePaths.add(resolvedPath);
      const dependencyLockId = lock === before ? 'before' : 'after';
      const dependencyVisitKey = `${dependencyLockId}:${resolvedPath}`;
      if (!visited.has(dependencyVisitKey)) pending.push([lock, resolvedPath]);
    }
  }
}
const targetOnlyMetadata = (beforeEntry, afterEntry) => {
  const withoutTarget = (entry) => {
    const copy = structuredClone(entry ?? {});
    for (const section of ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies', 'overrides']) {
      if (copy[section] && Object.prototype.hasOwnProperty.call(copy[section], name)) delete copy[section][name];
    }
    return copy;
  };
  return JSON.stringify(withoutTarget(beforeEntry)) === JSON.stringify(withoutTarget(afterEntry));
};
const manifestPackageKeys = new Set(['']);
try {
  const policy = JSON.parse(fs.readFileSync('config/ci-toolchain-lock.json', 'utf8'));
  for (const entry of policy.fundsCriticalPackages ?? []) {
    if (entry.name !== name) continue;
    for (const manifest of entry.manifests ?? []) {
      manifestPackageKeys.add(manifest === 'package.json' ? '' : manifest.replace(/\/package\.json$/, ''));
    }
  }
} catch {}
const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
const offenders = [];
for (const key of keys) {
  if (JSON.stringify(before[key] ?? null) === JSON.stringify(after[key] ?? null)) continue;
  if (manifestPackageKeys.has(key) && targetOnlyMetadata(before[key], after[key])) continue;
  if (key !== '' && allowedPackagePaths.has(key)) continue;
  offenders.push(key === '' ? '<workspace-root>' : key);
}
if (offenders.length) { process.stderr.write(offenders.join('\n')); process.exit(1); }
NODE
}

update_lockfile() {
  local lockfile=$1 dir before offenders status=0
  dir="$(dirname "$lockfile")"
  before="$(mktemp)"
  cp -p "$lockfile" "$before"
  # No package spec on purpose: the manifests already carry the exact pin, and
  # `npm install <pkg>@<ver>` would rewrite it to a caret range (save-prefix).
  (cd "$dir" && "$NPM_BIN" install --package-lock-only --ignore-scripts --no-audit --no-fund) \
    || { rm -f "$before"; fail "npm install --package-lock-only failed in $dir"; }
  offenders="$(assert_lockfile_scope "$before" "$lockfile" 2>&1)" || status=$?
  rm -f "$before"
  if [[ $status -ne 0 ]]; then
    fail "$lockfile changed entries outside ${PACKAGE}; leaving the tree for inspection:
$offenders"
  fi
}

matches_signing_scope() {
  local exact prefix
  while IFS= read -r exact; do [[ "$PACKAGE" == "$exact" ]] && return 0; done \
    < <(jq -r '.exactPackageNames[]?' "$SCOPE_CONFIG")
  while IFS= read -r prefix; do [[ "$PACKAGE" == "$prefix"* ]] && return 0; done \
    < <(jq -r '.packageNamePrefixes[]?' "$SCOPE_CONFIG")
  return 1
}

repin_hardware_compatibility_statement() {
  local json=docs/reference/generated/hardware-wallet-compatibility.json
  local markdown=docs/reference/generated/hardware-wallet-compatibility.md
  local generated_at
  generated_at="$(jq -r '.generatedAt' "$json")"
  if [[ -n "$REPORT_BIN" ]]; then
    "$REPORT_BIN" --as-of "$generated_at" --json "$json" --markdown "$markdown"
  else
    npx tsx scripts/ci/hardware-compatibility-report.ts --as-of "$generated_at" --json "$json" --markdown "$markdown"
  fi
}

run_supply_chain_gate() {
  if [[ -n "$GATE_BIN" ]]; then "$GATE_BIN"; else "$NPM_BIN" run check:supply-chain-locks; fi
}

# Lists files still mentioning the old version literal, ignoring the files
# this script already rewrote (which now contain the new version). Used to
# discover version-string files (e.g. scripts/verify-addresses tests) that
# need a manual update, without hardcoding their paths.
find_stale_version_references() {
  local old_version=$1
  grep -rIl -F "$old_version" . \
    --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
    --exclude-dir=coverage --exclude-dir=build --exclude-dir=.tmp --exclude-dir=.claude \
    2>/dev/null | sed 's#^\./##' | sort
}

print_manual_checklist() {
  local old_version=$1 manifests_intersect_verifiers=false manifest
  while IFS= read -r manifest; do
    [[ "$manifest" == scripts/verify-addresses/* || "$manifest" == scripts/verify-psbt/* ]] \
      && manifests_intersect_verifiers=true
  done < <(policy_array manifests)

  echo
  echo -e "${YELLOW}Remaining MANUAL steps for ${PACKAGE}@${NEW_VERSION}:${NC}"
  if $manifests_intersect_verifiers; then
    cat <<EOF
  1. Regenerate address vectors (Docker + 5 Bitcoin Core containers required):
       cd scripts/verify-addresses && npm run generate:repeatable && npm run verify:repeatable
  2. Regenerate PSBT vectors:
       scripts/ci/run-psbt-core-subject.sh live
  3. Prove the regenerated vector data is byte-identical to the previous
     vectors apart from version labels / provenance "version" / "sourceSha256".
EOF
  fi
  echo "  * Update any version-string reference to the old version (${old_version}) that this script did not touch:"
  local stale
  stale="$(find_stale_version_references "$old_version")"
  if [[ -n "$stale" ]]; then
    echo "$stale" | sed 's/^/      - /'
  else
    echo "      (none found by grep -F \"${old_version}\")"
  fi
  cat <<EOF
  * Review the upstream tarball diff before trusting the new version (in a
    scratch directory): npm pack ${PACKAGE}@${old_version} ${PACKAGE}@${NEW_VERSION},
    extract each tarball into its own directory, then diff -ru the two trees.
  * Re-run: npm run check:supply-chain-locks (already run by this script; re-run after any manual edit above).
See "Bumping a funds-critical package" in docs/reference/ci-cd-strategy.md.
EOF
}

main() {
  parse_args "$@"
  require_tools
  validate_package
  check_clean_tree

  local new_integrity
  new_integrity="$(fetch_registry_integrity)"

  local old_version old_integrity
  old_version="$(policy_field version)"
  old_integrity="$(policy_field integrity)"

  if [[ "$old_version" == "$NEW_VERSION" && "$old_integrity" == "$new_integrity" ]]; then
    echo -e "${GREEN}${PACKAGE} is already at ${NEW_VERSION}; nothing to change.${NC}"
    exit 0
  fi

  mapfile -t manifests < <(policy_array manifests)
  mapfile -t lockfiles < <(policy_array lockfiles)

  local manifest
  for manifest in "${manifests[@]}"; do
    [[ -f "$manifest" ]] || fail "listed manifest is missing: $manifest"
    manifest_declares_package "$manifest" || fail "$manifest does not declare $PACKAGE"
  done

  if $DRY_RUN; then
    echo -e "${YELLOW}[dry-run] Would bump ${PACKAGE}: ${old_version} -> ${NEW_VERSION}${NC}"
    echo "[dry-run] Would edit manifests: ${manifests[*]}"
    echo "[dry-run] Would update lockfiles via npm: ${lockfiles[*]}"
    echo "[dry-run] Would re-pin $LOCK_CONFIG version+integrity"
    if matches_signing_scope; then
      echo "[dry-run] Would re-pin docs/reference/generated/hardware-wallet-compatibility.{json,md}"
    fi
    echo "[dry-run] Would run: npm run check:supply-chain-locks"
    exit 0
  fi

  echo -e "${YELLOW}Bumping ${PACKAGE}: ${old_version} -> ${NEW_VERSION}${NC}"
  for manifest in "${manifests[@]}"; do update_manifest "$manifest"; done

  local lockfile
  for lockfile in "${lockfiles[@]}"; do
    [[ -f "$lockfile" ]] || fail "listed lockfile is missing: $lockfile"
    update_lockfile "$lockfile"
  done

  update_lock_config "$new_integrity"

  if matches_signing_scope; then
    repin_hardware_compatibility_statement
  fi

  run_supply_chain_gate

  echo -e "${GREEN}${PACKAGE} bumped to ${NEW_VERSION} across every listed manifest and lockfile.${NC}"
  print_manual_checklist "$old_version"
}

main "$@"
