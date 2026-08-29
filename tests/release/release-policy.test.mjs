import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const distribution = read('docs/reference/release-distribution.md');
const gates = read('docs/reference/release-gates.md');
const contributing = read('.github/CONTRIBUTING.md');
const bump = read('scripts/bump-version.sh');
const preparedVerifier = read('scripts/release/verify-prepared-release.mjs');
const authority = 'docs/reference/release-distribution.md';
const localSurfaces = [
  '.claude/commands/release.md',
  '.claude/commands/pre-release.md',
  '.claude/commands/cifix.md',
  'CLAUDE.md',
].filter(existsSync).map((path) => [path, read(path)]);

const releaseOutputs = [
  'package.json',
  'package-lock.json',
  'server/package.json',
  'gateway/package.json',
  'llm-egress-proxy/package.json',
  'llm-egress-proxy/package-lock.json',
  'docs/reference/changelog.md',
  'docs/reference/generated/hardware-wallet-compatibility.json',
  'docs/reference/generated/hardware-wallet-compatibility.md',
];

function shellArray(source, name) {
  const match = source.match(new RegExp(`${name}=\\(([\\s\\S]*?)\\)`));
  assert.ok(match, `missing ${name} shell array`);
  return match[1]
    .trim()
    .split(/\s+/)
    .map((line) => line.trim().replace(/^['"]|['"]$/g, ''));
}

test('tracked release surfaces point to one canonical policy', () => {
  assert.match(contributing, new RegExp(authority.replaceAll('.', '\\.')));
  assert.match(gates, /\[Release distribution\]\(release-distribution\.md\)/);
  assert.match(bump, new RegExp(authority.replaceAll('.', '\\.')));
  assert.match(distribution, /authoritative release and recovery policy/);

  for (const [path, surface] of localSurfaces) {
    assert.match(surface, new RegExp(authority.replaceAll('.', '\\.')), `${path} lacks canonical policy link`);
  }
});

test('canonical recovery is immutable and fail closed', () => {
  assert.match(distribution, /An RC fails validation[\s\S]*next unused RC number/);
  assert.match(distribution, /Publication stopped for a transient reason[\s\S]*identical/);
  assert.match(distribution, /ref, digest, manifest, or same-name asset differs[\s\S]*Stop/);
  assert.match(distribution, /pushed stable tag has a code or configuration defect[\s\S]*new patch version/);
  assert.match(distribution, /Never rewrite any pushed RC or stable tag/);
});

test('prepared mode is exclusive, freshly fetched, landed, evidence-checked, and skips PR delivery', () => {
  assert.match(distribution, /--prepared-version <X\.Y\.Z> --commit <40-lowercase-hex-sha>/);
  assert.match(distribution, /Never combine[\s\S]*missing, reordered, abbreviated, duplicate, or unknown/);
  assert.match(distribution, /freshly fetching `origin\/main` and all tags/);
  assert.match(distribution, /commit to be an ancestor of `origin\/main`/);
  assert.match(distribution, /package and lockfile version identity[\s\S]*changelog[\s\S]*generated hardware JSON\/Markdown/);
  assert.match(distribution, /skips the bump and protected-PR delivery steps completely/);
  assert.match(distribution, /resumes at first-unused-RC selection/);
  assert.match(distribution, /node scripts\/release\/verify-prepared-release\.mjs/);
  assert.match(preparedVerifier, /args\.length !== 4/);
  assert.match(preparedVerifier, /refs\/heads\/main:refs\/remotes\/origin\/main/);
  assert.match(preparedVerifier, /--tags[\s\S]*--prune/);
  assert.match(preparedVerifier, /merge-base[\s\S]*--is-ancestor/);
  assert.match(preparedVerifier, /bump-version\.sh[\s\S]*--check/);
  assert.match(preparedVerifier, /assertCleanWorktree\(\)[\s\S]*assertReleaseEvidence\(\)[\s\S]*assertCleanWorktree\(\)/);
});

test('release preparation declares the exact evidence allowlist', () => {
  for (const output of releaseOutputs) assert.match(distribution, new RegExp(output.replaceAll('.', '\\.')));
  assert.match(distribution, /Compare both the unstaged and staged path sets/);
  assert.match(distribution, /expected changed path is omitted or any unrelated path is staged/);

  const declared = shellArray(bump, 'DECLARED_OUTPUTS')
    .flatMap((entry) => entry === '${PACKAGE_FILES[@]}' ? shellArray(bump, 'PACKAGE_FILES') : entry);
  assert.deepEqual(declared.sort(), releaseOutputs.filter((path) => path !== 'docs/reference/changelog.md').sort());
});

test('merge proof and readiness happen before branch deletion and stable tagging', () => {
  const reported = distribution.indexOf('PR-reported merge commit');
  const ancestry = distribution.indexOf('prove that exact commit is its ancestor');
  const deletion = distribution.search(/delete the\s+preparation branch/);
  assert.ok(reported > -1 && ancestry > reported && deletion > ancestry);

  const readiness = distribution.indexOf('credential, signing-key, canary-receipt');
  const stable = distribution.indexOf('before the tag is created');
  assert.ok(readiness > -1 && stable > readiness);
  assert.match(distribution, /asset output path must be absolute/);
  assert.match(distribution, /outside every repository worktree/);
});

test('landed commit validation succeeds before an immutable RC tag is created', () => {
  const dispatch = distribution.indexOf('manually dispatch `release-candidate.yml`');
  const candidateSha = distribution.indexOf('locked `candidate_sha`');
  const validation = distribution.indexOf('`Validation Summary` succeeds');
  const rcTag = distribution.indexOf('Create the next unused RC tag');

  assert.ok(dispatch > -1);
  assert.ok(candidateSha > dispatch);
  assert.ok(validation > candidateSha);
  assert.ok(rcTag > validation);
});

test('owned release surfaces exclude stale or destructive mechanics', () => {
  const tracked = [distribution, gates, contributing, bump, preparedVerifier];
  const localCommands = localSurfaces
    .filter(([path]) => path.startsWith('.claude/commands/'))
    .map(([, value]) => value);
  for (const surface of [...tracked, ...localCommands]) {
    assert.doesNotMatch(surface, /\bgh run\b|gh api .*actions/i);
    assert.doesNotMatch(surface, /delete_branch_after_merge\s*["':=]+\s*true/i);
    assert.doesNotMatch(surface, /git push origin\s+main\s+--tags/);
    assert.doesNotMatch(surface, /git push origin\s+:refs\/tags|git tag -d\s+v/);
  }
});

test('bump script arms rollback before writes and validates generated parity', () => {
  const begin = bump.indexOf('begin_transaction\n');
  const write = bump.indexOf('"$NPM_BIN" version');
  assert.ok(begin > -1 && write > begin);
  assert.match(bump, /cp -p "\$TRANSACTION_DIR\/\$output" "\$output"/);
  assert.match(bump, /source\.packageLockSha256/);
  assert.match(bump, /cmp -s "\$HARDWARE_JSON"[\s\S]*cmp -s "\$HARDWARE_MARKDOWN"/);
});
