import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, renameSync, readFileSync, rmSync, symlinkSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', ...options });
const realGit = run('which', ['git']).stdout.trim();
const root = process.cwd();
function write(base, file, contents = '', executable = false) {
  const target = path.join(base, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, executable ? { mode: 0o755 } : {});
}
function ownedDirectory(t, prefix) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function gitFixture(t) {
  const repo = ownedDirectory(t, 'backend-git-proof-');
  assert.equal(run(realGit, ['init', '-q', repo]).status, 0);
  assert.equal(run(realGit, ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']).status, 0);
  return repo;
}
function fixture(t) {
  const repo = gitFixture(t);
  const dir = ownedDirectory(t, 'backend-entry-proof-');
  for (const file of ['package.json', 'package-lock.json', 'server/package.json', 'server/vitest.config.ts', 'server/tsconfig.json', 'server/prisma/schema.prisma', 'shared/package.json', 'config/hardware-physical-evidence-trust.json', 'src/hooks/send/useUsbSigning.ts']) write(dir, file);
  write(dir, 'scripts/ci/backend-docker-test.sh', readFileSync('scripts/ci/backend-docker-test.sh'));
  write(dir, 'scripts/ci/prepare-integration-db.sh', `#!/bin/bash
count=0
[[ ! -f "$PROOF_DB_COUNTER" ]] || read -r count < "$PROOF_DB_COUNTER"
count=$((count + 1))
printf '%s\\n' "$count" > "$PROOF_DB_COUNTER"
echo "db:$PWD:$count" >> "$PROOF_LOG"
if [[ "$count" -gt 1 ]]; then exit "\${PROOF_READMIT_STATUS:-0}"; fi
exit "\${PROOF_DB_STATUS:-0}"
`);
  write(dir, 'scripts/ci/backend-integration-groups.sh', `#!/bin/bash
echo "group:$1" >> "$PROOF_LOG"
if [[ "$1" == --check ]]; then exit "\${PROOF_GROUP_CHECK_STATUS:-0}"; fi
[[ "\${PROOF_GROUP_LIST_STATUS:-0}" == 0 ]] || exit "$PROOF_GROUP_LIST_STATUS"
[[ "\${PROOF_EMPTY_GROUP:-0}" != 1 ]] || exit 0
printf '%s\\n' tests/integration/ops/first.test.ts tests/integration/ops/second.test.ts
`);
  for (const spec of ['first', 'second']) write(dir, `server/tests/integration/ops/${spec}.test.ts`);
  const tool = `#!/bin/bash
set -eu
name="\${0##*/}"
echo "$name:$PWD:$*" >> "$PROOF_LOG"
if [[ "$name" == vitest && "\${1:-}" == list ]]; then
  [[ "\${PROOF_EMPTY_DISCOVERY:-0}" == 1 ]] || echo tests/unit/example.test.ts
elif [[ "$name" == vitest ]]; then
  status="\${PROOF_TEST_STATUS:-0}"
  for arg in "$@"; do
    case "$arg" in
      --outputFile.junit=*)
        report="\${arg#*=}"
        printf '%s\\n' "\${report##*/}" > "$report"
        if [[ "$report" == *junit-main.xml ]]; then status="\${PROOF_MAIN_STATUS:-0}";
        else status="\${PROOF_DESTRUCTIVE_STATUS:-0}"; fi
        ;;
    esac
  done
  exit "$status"
fi
`;
  for (const binary of ['npm', 'prisma', 'vitest', 'tsc']) write(dir, `node_modules/.bin/${binary}`, tool, true);
  mkdirSync(path.join(dir, 'output'));
  return { dir, env: { ...process.env, SANCTUARY_BACKEND_SOURCE_SHA: run(realGit, ['-C', repo, 'rev-parse', 'HEAD']).stdout.trim(), SANCTUARY_BACKEND_GIT_OBJECTS: path.join(repo, '.git/objects'), SANCTUARY_BACKEND_TEST_OUTPUT: path.join(dir, 'output'), PROOF_LOG: path.join(dir, 'commands.log'), PROOF_DB_COUNTER: path.join(dir, 'db-count') } };
}
function execute(f, mode, overrides = {}) {
  return run('bash', [path.join(f.dir, 'scripts/ci/backend-docker-test.sh'), mode], { env: { ...f.env, ...overrides } });
}
for (const [mode, expected] of [['unit-coverage', 'run --coverage tests/unit --no-file-parallelism --maxWorkers=1']]) {
  test(`${mode} prepares before exact serial scope and preserves failed scope status`, (t) => {
    const f = fixture(t);
    const result = execute(f, mode, { PROOF_TEST_STATUS: '23' });
    assert.equal(result.status, 23, result.stderr);
    const log = readFileSync(f.env.PROOF_LOG, 'utf8');
    assert.ok(log.indexOf('npm:') < log.indexOf('prisma:'));
    assert.ok(log.indexOf('db:') < log.lastIndexOf('vitest:'));
    assert.ok(log.includes(`vitest:${f.dir}/server:${expected}`), log);
    assert.doesNotMatch(log, /group:|db:.*:2/);
    assert.equal(readFileSync(path.join(f.dir, 'output/exit-status.txt'), 'utf8').trim(), '23');
  });
}
test('prepare-only performs discovery and DB admission without running tests', (t) => {
  const f = fixture(t); const result = execute(f, 'prepare-only');
  assert.equal(result.status, 0, result.stderr);
  const log = readFileSync(f.env.PROOF_LOG, 'utf8');
  assert.match(log, /db:/); assert.doesNotMatch(log, /vitest:.*:run /);
  assert.equal(run(realGit, ['-C', f.dir, 'rev-parse', 'HEAD']).stdout.trim(), f.env.SANCTUARY_BACKEND_SOURCE_SHA);
});
test('failed DB admission prevents test execution', (t) => {
  const f = fixture(t); assert.equal(execute(f, 'full', { PROOF_DB_STATUS: '19' }).status, 19);
  assert.doesNotMatch(readFileSync(f.env.PROOF_LOG, 'utf8'), /vitest:.*:run /);
});
test('empty discovery refuses DB admission and test execution', (t) => {
  const f = fixture(t); assert.notEqual(execute(f, 'full', { PROOF_EMPTY_DISCOVERY: '1' }).status, 0);
  assert.doesNotMatch(readFileSync(f.env.PROOF_LOG, 'utf8'), /db:|vitest:.*:run /);
});
test('missing actual Git object rejects preparation', (t) => {
  const f = fixture(t); assert.notEqual(execute(f, 'full', { SANCTUARY_BACKEND_SOURCE_SHA: 'f'.repeat(40) }).status, 0);
});
test('ordinary checkout and worktree resolve the same real common object directory', (t) => {
  const repo = gitFixture(t); const worktree = ownedDirectory(t, 'backend-git-worktree-proof-');
  assert.equal(run(realGit, ['-C', repo, 'worktree', 'add', '--detach', worktree, 'HEAD']).status, 0);
  for (const checkout of [repo, worktree]) {
    const result = run('bash', ['-c', 'source "$1"; resolve_backend_git_inputs "$2"; printf "%s" "$SANCTUARY_BACKEND_GIT_OBJECTS"', 'proof', path.join(root, 'scripts/ci/backend-docker-inputs.sh'), checkout]);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, path.join(repo, '.git/objects'));
  }
});
test('external alternates fail closed rather than mounting a private Git directory', (t) => {
  const repo = gitFixture(t); write(repo, '.git/objects/info/alternates', '/absent/object-store\n');
  const result = run('bash', ['-c', 'source "$1"; resolve_backend_git_inputs "$2"', 'proof', path.join(root, 'scripts/ci/backend-docker-inputs.sh'), repo]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /alternates/);
});

test('missing required support input prevents dependency/build/DB work', (t) => {
  const f = fixture(t);
  renameSync(path.join(f.dir, 'config/hardware-physical-evidence-trust.json'), path.join(f.dir, 'omitted-support'));
  const result = execute(f, 'full');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing backend test input/);
});

for (const mode of ['full', 'integration']) {
  test(`${mode} keeps complete main scope then re-admits DB before destructive final process`, t => {
    const f = fixture(t);
    const result = execute(f, mode);
    assert.equal(result.status, 0, result.stderr);
    const lines = readFileSync(f.env.PROOF_LOG, 'utf8').trim().split('\n');
    const runs = lines.filter(line => line.startsWith('vitest:') && line.includes(':run '));
    assert.equal(runs.length, 2);
    const exclusions = '--exclude tests/integration/ops/first.test.ts --exclude tests/integration/ops/second.test.ts';
    const scope = mode === 'integration' ? 'tests/integration ' : '';
    assert.equal(runs[0], `vitest:${f.dir}/server:run ${scope}${exclusions} --no-file-parallelism --maxWorkers=1 --outputFile.junit=${f.dir}/output/junit-main.xml`);
    assert.equal(runs[1], `vitest:${f.dir}/server:run tests/integration/ops/first.test.ts tests/integration/ops/second.test.ts --no-file-parallelism --maxWorkers=1 --outputFile.junit=${f.dir}/output/junit-ops-destructive.xml`);
    assert.ok(lines.indexOf('group:--check') < lines.indexOf('group:ops-destructive'));
    assert.ok(lines.indexOf('group:ops-destructive') < lines.indexOf(runs[0]));
    const readmit = lines.findIndex(line => line.startsWith('db:') && line.endsWith(':2'));
    assert.ok(readmit > lines.indexOf(runs[0]) && readmit < lines.indexOf(runs[1]));
    assert.equal(readFileSync(path.join(f.dir, 'output/junit-main.xml'), 'utf8'), 'junit-main.xml\n');
    assert.equal(readFileSync(path.join(f.dir, 'output/junit-ops-destructive.xml'), 'utf8'), 'junit-ops-destructive.xml\n');
  });
}

for (const [label, overrides, expectedStatus, expectedRuns] of [
  ['group validation', { PROOF_GROUP_CHECK_STATUS: '21' }, 21, 0],
  ['group listing', { PROOF_GROUP_LIST_STATUS: '22' }, 22, 0],
  ['empty destructive group', { PROOF_EMPTY_GROUP: '1' }, 1, 0],
  ['main scope', { PROOF_MAIN_STATUS: '23' }, 23, 1],
  ['DB re-admission', { PROOF_READMIT_STATUS: '24' }, 24, 1],
  ['destructive scope', { PROOF_DESTRUCTIVE_STATUS: '25' }, 25, 2],
]) {
  test(`${label} failure stops later work and preserves its status`, t => {
    const f = fixture(t);
    const result = execute(f, 'full', overrides);
    assert.equal(result.status, expectedStatus, result.stderr);
    const log = readFileSync(f.env.PROOF_LOG, 'utf8');
    const runs = log.split('\n').filter(line => line.startsWith('vitest:') && line.includes(':run '));
    assert.equal(runs.length, expectedRuns);
    assert.equal(existsSync(path.join(f.dir, 'output/junit-main.xml')), expectedRuns >= 1);
    assert.equal(existsSync(path.join(f.dir, 'output/junit-ops-destructive.xml')), expectedRuns === 2);
    if (expectedRuns === 0 || label === 'main scope') assert.doesNotMatch(log, /db:.*:2/);
    assert.equal(readFileSync(path.join(f.dir, 'output/exit-status.txt'), 'utf8').trim(), String(expectedStatus));
  });
}

function outputOwnershipFixture(t) {
  const f = fixture(t);
  const tools = path.join(f.dir, 'node_modules/.bin');
  const realCp = run('which', ['cp']).stdout.trim();
  write(f.dir, 'server/coverage/nested/report.json', 'coverage proof');
  write(f.dir, 'server/junit.xml', 'junit proof');
  write(f.dir, 'node_modules/.bin/cp', `#!/bin/bash
printf 'copy:%s\\n' "$*" >> "$PROOF_LOG"
[[ "\${PROOF_COPY_STATUS:-0}" == 0 ]] || exit "$PROOF_COPY_STATUS"
exec "${realCp}" "$@"
`, true);
  write(f.dir, 'node_modules/.bin/chown', `#!/bin/bash
printf 'ownership:%s\\n' "$*" >> "$PROOF_LOG"
[[ -f "$SANCTUARY_BACKEND_TEST_OUTPUT/coverage/nested/report.json" ]] && echo retained >> "$PROOF_LOG"
exit "\${PROOF_CHOWN_STATUS:-0}"
`, true);
  f.env.PATH = `${tools}:${f.env.PATH}`;
  return f;
}

test('output normalization follows nested report retention with numeric owner and no-follow recursion', t => {
  const f = outputOwnershipFixture(t);
  const owner = statSync(f.env.SANCTUARY_BACKEND_TEST_OUTPUT);
  const result = execute(f, 'unit-coverage');
  assert.equal(result.status, 0, result.stderr);
  const lines = readFileSync(f.env.PROOF_LOG, 'utf8').trim().split('\n');
  const ownership = `ownership:-hR ${owner.uid}:${owner.gid} -- ${f.env.SANCTUARY_BACKEND_TEST_OUTPUT}`;
  assert.equal(lines.filter(line => line.startsWith('ownership:')).length, 1);
  assert.ok(lines.includes(ownership), lines.join('\n'));
  assert.ok(lines.indexOf(ownership) > lines.findLastIndex(line => line.startsWith('copy:')));
  assert.ok(lines.includes('retained'));
});

for (const [label, overrides, expected] of [
  ['normalization failure', { PROOF_CHOWN_STATUS: '37' }, 37],
  ['failed copy still normalizes', { PROOF_COPY_STATUS: '36' }, 36],
  ['subject failure precedes copy and ownership failures', { PROOF_TEST_STATUS: '23', PROOF_COPY_STATUS: '36', PROOF_CHOWN_STATUS: '37' }, 23],
  ['preparation failure still normalizes', { PROOF_DB_STATUS: '19', PROOF_CHOWN_STATUS: '37' }, 19],
]) {
  test(label, t => {
    const f = outputOwnershipFixture(t);
    const result = execute(f, 'unit-coverage', overrides);
    assert.equal(result.status, expected, result.stderr);
    assert.match(readFileSync(f.env.PROOF_LOG, 'utf8'), /ownership:-hR /);
  });
}

test('symlink output root refuses preparation and normalization', t => {
  const f = outputOwnershipFixture(t);
  const target = ownedDirectory(t, 'backend-output-outside-');
  renameSync(f.env.SANCTUARY_BACKEND_TEST_OUTPUT, `${f.env.SANCTUARY_BACKEND_TEST_OUTPUT}-old`);
  symlinkSync(target, f.env.SANCTUARY_BACKEND_TEST_OUTPUT);
  const result = execute(f, 'prepare-only');
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(f.env.PROOF_LOG), false);
  assert.deepEqual(run('ls', ['-A', target]).stdout.trim(), '');
});

for (const replacement of ['directory', 'symlink']) {
  test(`changed output root (${replacement}) refuses retention and normalization`, t => {
    const f = outputOwnershipFixture(t);
    const target = ownedDirectory(t, 'backend-output-replacement-');
    const tool = path.join(f.dir, 'node_modules/.bin/vitest');
    const mutation = replacement === 'directory' ? 'mkdir "$SANCTUARY_BACKEND_TEST_OUTPUT"' : 'ln -s "$PROOF_REPLACEMENT" "$SANCTUARY_BACKEND_TEST_OUTPUT"';
    writeFileSync(tool, readFileSync(tool, 'utf8').replace('  exit "$status"', `  mv "$SANCTUARY_BACKEND_TEST_OUTPUT" "$SANCTUARY_BACKEND_TEST_OUTPUT-old"
  ${mutation}
  exit "$status"`));
    const result = execute(f, 'unit-coverage', { PROOF_REPLACEMENT: target });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(readFileSync(f.env.PROOF_LOG, 'utf8'), /copy:|ownership:/);
    assert.equal(existsSync(path.join(target, 'coverage')), false);
  });
}

test('child symlink keeps outside sentinel unchanged and requests no-follow normalization', t => {
  const f = outputOwnershipFixture(t);
  const outside = ownedDirectory(t, 'backend-output-sentinel-');
  write(outside, 'sentinel', 'outside proof');
  const sentinel = path.join(outside, 'sentinel');
  const before = statSync(sentinel);
  symlinkSync(outside, path.join(f.env.SANCTUARY_BACKEND_TEST_OUTPUT, 'outside-link'));
  const result = execute(f, 'unit-coverage');
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(f.env.PROOF_LOG, 'utf8'), /ownership:-hR /);
  assert.equal(readFileSync(sentinel, 'utf8'), 'outside proof');
  const after = statSync(sentinel);
  assert.deepEqual([after.uid, after.gid, after.ino, after.mode], [before.uid, before.gid, before.ino, before.mode]);
});

test('changed output owner refuses normalization even with unchanged device and inode', t => {
  const f = outputOwnershipFixture(t);
  const realStat = run('which', ['stat']).stdout.trim();
  write(f.dir, 'node_modules/.bin/stat', `#!/bin/bash
identity=$("${realStat}" "$@") || exit $?
if [[ -f "$PROOF_DB_COUNTER" ]]; then
  prefix="\${identity%:*:*}"
  printf '%s:99999:99999\\n' "$prefix"
else
  printf '%s\\n' "$identity"
fi
`, true);
  const result = execute(f, 'unit-coverage');
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(readFileSync(f.env.PROOF_LOG, 'utf8'), /copy:|ownership:/);
});
