const NODE_STAGING = 'active_staging="$(mktemp -d "${cache_parent}/.node-${expected_version}.XXXXXX")"';
const NPM_STAGING = 'active_staging="$(mktemp -d "${active_staging_parent}/.npm-${expected_npm_version}.XXXXXX")"';
const CLEANUP_TARGET = 'rm -rf -- "$staging" || return';

function shellLines(source) {
  return source.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function hasExactLifecycleCommands(lines) {
  const removals = lines.filter(line => /\brm\b/.test(line));
  const temporaryDirectories = lines.filter(line => /\bmktemp\b/.test(line));
  return removals.length === 1 && removals[0] === CLEANUP_TARGET
    && temporaryDirectories.length === 2
    && temporaryDirectories.includes(NODE_STAGING)
    && temporaryDirectories.includes(NPM_STAGING);
}

function hasOnlyExpectedStateAssignments(lines) {
  const assignments = lines.filter(line => /\bactive_staging(?:_parent|_kind)?=/.test(line));
  const expected = [
    "active_staging=''", "active_staging=''", NODE_STAGING, NPM_STAGING,
    "active_staging_parent=''", "active_staging_parent=''",
    'active_staging_parent="$cache_parent"',
    'active_staging_parent="$(dirname "$install_root")"',
    "active_staging_kind=''", "active_staging_kind=''",
    'active_staging_kind=node', 'active_staging_kind=npm',
  ].sort();
  return JSON.stringify(assignments.sort()) === JSON.stringify(expected);
}

function hasExactTrapCommands(lines) {
  const traps = lines.filter(line => /\btrap\b/.test(line));
  const expected = [
    'trap cleanup_on_exit EXIT', "trap 'exit 129' HUP", "trap 'exit 130' INT",
    "trap 'exit 143' TERM", 'trap - EXIT',
  ].sort();
  return JSON.stringify(traps.sort()) === JSON.stringify(expected);
}

function hasNarrowCleanupBody(cleanup) {
  return cleanup.startsWith('cleanup_active_staging() {')
    && cleanup.includes('local staging="$active_staging" expected_prefix')
    && cleanup.includes('expected_prefix="$active_staging_parent/.node-${expected_version}."')
    && cleanup.includes('expected_prefix="$active_staging_parent/.npm-${expected_npm_version}."')
    && (cleanup.match(/\[\[ "\$staging" == "\$expected_prefix"\* \]\]/g) ?? []).length === 2
    && cleanup.includes('[[ -d "$staging" && ! -L "$staging" ]]')
    && cleanup.includes(`${CLEANUP_TARGET}\n  active_staging=''`)
    && cleanup.includes("  active_staging_parent=''\n  active_staging_kind=''");
}

function hasSignalAndExitCleanup(source) {
  return source.includes('trap cleanup_on_exit EXIT')
    && source.includes("trap 'exit 129' HUP")
    && source.includes("trap 'exit 130' INT")
    && source.includes("trap 'exit 143' TERM")
    && source.includes('cleanup_active_staging || cleanup_status=$?')
    && source.includes('local status=$? cleanup_status=0')
    && source.includes('trap - EXIT')
    && source.includes('if [[ $status -eq 0 && $cleanup_status -ne 0 ]]; then status=$cleanup_status; fi');
}

function hasLockedVersionValidation(source) {
  return source.includes('[[ "$expected_version" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+$ ]]')
    && source.includes('[[ "$expected_npm_version" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+$ ]]');
}

function hasInstallCleanupOrdering(source) {
  const nodeCreate = source.indexOf(NODE_STAGING);
  const nodeKind = source.indexOf('active_staging_kind=node');
  const nodeCleanup = source.indexOf('  cleanup_active_staging\n', nodeCreate);
  const npmCreate = source.indexOf(NPM_STAGING);
  const npmKind = source.indexOf('active_staging_kind=npm');
  const npmCleanup = source.indexOf('  cleanup_active_staging\n', npmCreate);
  return nodeKind >= 0 && nodeCreate > nodeKind && nodeCleanup > nodeCreate
    && npmKind >= 0 && npmCreate > npmKind && npmCleanup > npmCreate
    && nodeCleanup < npmCreate && source.indexOf('trap cleanup_on_exit EXIT') < nodeCreate;
}

/** Proves bootstrap cleanup is limited to its two locked mktemp staging trees. */
export function provesBootstrapStagingLifecycle(source) {
  if (typeof source !== 'string') return false;
  const lines = shellLines(source);
  const cleanup = source.slice(source.indexOf('cleanup_active_staging() {'), source.indexOf('\n}\n\ncleanup_on_exit()'));
  return hasExactLifecycleCommands(lines)
    && hasOnlyExpectedStateAssignments(lines)
    && hasExactTrapCommands(lines)
    && hasNarrowCleanupBody(cleanup)
    && hasSignalAndExitCleanup(source)
    && hasLockedVersionValidation(source)
    && hasInstallCleanupOrdering(source);
}
