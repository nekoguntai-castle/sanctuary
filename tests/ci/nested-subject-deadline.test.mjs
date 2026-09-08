import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from './lib/yaml.mjs';

const ROOT = path.resolve('.');
const WRAPPER = path.join(ROOT, 'scripts/ci/run-in-isolated-workspace.sh');
const FACADE = path.join(ROOT, 'scripts/ci/cleanup-ci-callsite.sh');
const VERIFY = path.join(ROOT, 'scripts/ownership/verify-ci-cleanup-upload.mjs');

function invoke(command, args, environment, directory) {
  const log = path.join(directory, `command-${invoke.sequence++}.log`);
  const fd = openSync(log, 'w');
  try {
    const result = spawnSync(command, args, { cwd: ROOT, env: environment,
      stdio: ['ignore', fd, fd], timeout: 45_000 });
    return { ...result, log: readFileSync(log, 'utf8') };
  } finally { closeSync(fd); }
}
invoke.sequence = 0;

function fixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'nested-subject-budget-'));
  const source = path.join(directory, 'source');
  const bin = path.join(directory, 'bin');
  mkdirSync(source, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  const environment = { ...process.env, PATH: `${bin}:${process.env.PATH}`,
    CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '95990', GITHUB_RUN_ATTEMPT: '1',
    FORGEJO_ACTIONS: 'false', FORGEJO_SERVER_URL: '', RUNNER_TEMP: directory,
    SANCTUARY_CI_SOURCE_WORKSPACE: source, SANCTUARY_CI_WORKSPACE_OVERRIDE: source,
    SANCTUARY_CI_WORKSPACE_PARENT: path.join(directory, 'workspaces'),
  };
  delete environment.SANCTUARY_ISOLATED_CLEANUP_SUBJECT;
  delete environment.SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS;
  for (const args of [['init', '--quiet', source], ['-C', source, 'config', 'user.name', 'Test'],
    ['-C', source, 'config', 'user.email', 'test@example.invalid']]) {
    const result = invoke('git', args, environment, directory);
    assert.equal(result.status, 0, result.log);
  }
  writeFileSync(path.join(source, 'package.json'), '{"version":"0.0.0"}\n');
  for (const args of [['-C', source, 'add', '.'], ['-C', source, 'commit', '--quiet', '-m', 'fixture']]) {
    const result = invoke('git', args, environment, directory);
    assert.equal(result.status, 0, result.log);
  }
  return { directory, environment, bin };
}

test('isolated lifecycle waits for timed-out nested subject and slow signed cleanup before retirement', () => {
  const { directory, environment, bin } = fixture();
  const pidFile = path.join(directory, 'subject.pid');
  const workspaceFile = path.join(directory, 'workspace');
  const innerArtifact = path.join(directory, 'inner-artifact');
  const innerRuntime = path.join(directory, 'inner-runtime');
  const delayed = path.join(directory, 'cleanup-delay');
  writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash
set -euo pipefail
if [[ -e '${pidFile}' && ! -e '${delayed}' ]]; then
  touch '${delayed}'
  sleep 6
fi
if [[ \${1:-} == --host ]]; then shift 2; fi
case "\${1:-} \${2:-}" in
  'context show') echo default ;;
  'version --format'|'info --format') echo '{}' ;;
  'context inspect') echo '{"Name":"default","Endpoints":{"docker":{"Host":"unix:///run/fake-nested.sock","SkipTLSVerify":false}},"TLSMaterial":{}}' ;;
esac
`, { mode: 0o700 });
  const driver = path.join(directory, 'driver.sh');
  writeFileSync(driver, `#!/usr/bin/env bash
set -euo pipefail
printf '%s' "$PWD" > '${workspaceFile}'
printf '%s' "$SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS" > '${directory}/inherited-deadline'
status=0
'${FACADE}' run --lane nested-inner --checkout-root '${ROOT}' \\
  --runtime '${innerRuntime}' --artifact-dir '${innerArtifact}' -- \\
  '${process.execPath}' -e 'require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.on("SIGTERM", () => {}); setTimeout(() => process.exit(99), 20000); setInterval(() => {}, 1000)' || status=$?
[[ $status == 124 ]]
'${process.execPath}' '${VERIFY}' --artifact-root '${innerArtifact}' --runtime-root '${innerRuntime}' --checkout-root '${ROOT}'
[[ -d "$PWD" ]]
touch '${directory}/inner-verified-before-retirement'
exit "$status"
`, { mode: 0o700 });
  environment.SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS = String(Date.now() + 6000);
  let pid;
  try {
    const result = invoke('bash', [WRAPPER, '--nested-cleanup', 'nested-budget', driver], environment, directory);
    if (existsSync(pidFile)) pid = Number(readFileSync(pidFile, 'utf8'));
    assert.equal(result.status, 124, result.log);
    assert.ok(existsSync(path.join(directory, 'inner-verified-before-retirement')), result.log);
    assert.equal(readFileSync(path.join(directory, 'inherited-deadline'), 'utf8'),
      environment.SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS);
    assert.ok(existsSync(delayed));
    const workspace = readFileSync(workspaceFile, 'utf8');
    assert.equal(existsSync(path.dirname(workspace)), false, 'outer temporary root was not retired');
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    const suffix = createHash('sha256').update('nested-budget').digest('hex').slice(0, 10);
    const lane = `isolated-nested-budge-${suffix}`;
    const outerRequest = JSON.parse(readFileSync(path.join(directory,
      'sanctuary-cleanup', `95990-1/${lane}`, 'run-request.json'), 'utf8'));
    assert.equal(Object.hasOwn(outerRequest, 'subjectDeadlineEpochMs'), false);
    const innerRequest = JSON.parse(readFileSync(path.join(innerRuntime, 'run-request.json'), 'utf8'));
    assert.equal(innerRequest.subjectDeadlineEpochMs, Number(environment.SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS));
    const verified = invoke(process.execPath, [VERIFY,
      '--artifact-root', path.join(directory, 'sanctuary-cleanup-artifacts', `95990-1/${lane}`),
      '--runtime-root', path.join(directory, 'sanctuary-cleanup', `95990-1/${lane}`),
      '--checkout-root', ROOT], environment, directory);
    assert.equal(verified.status, 0, verified.log);
  } finally {
    if (pid) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
});

test('invalid or exhausted inherited budget refuses before isolation preparation', () => {
  const { directory, environment } = fixture();
  for (const deadline of ['', 'bad', '1', String(Date.now() + 90_000_000)]) {
    const result = invoke('bash', [WRAPPER, '--nested-cleanup', 'invalid-budget', 'true'], {
      ...environment, SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS: deadline,
    }, directory);
    assert.equal(result.status, deadline === '1' ? 124 : 1, result.log);
    assert.equal(existsSync(path.join(directory, 'sanctuary-cleanup')), false);
    assert.equal(existsSync(path.join(directory, 'workspaces')), false);
  }
});

test('nested cleanup without a budget preserves the ordinary lifecycle path', () => {
  const { directory, environment } = fixture();
  const marker = path.join(directory, 'unbudgeted-started');
  const result = invoke('bash', [WRAPPER, '--nested-cleanup', 'unbudgeted', process.execPath, '-e',
    `if ('SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS' in process.env) process.exit(99); require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes')`],
  environment, directory);
  assert.equal(result.status, 0, result.log);
  assert.ok(existsSync(marker), result.log);
  assert.match(result.log, /"cleanupState":"cleaned"/);
  const suffix = createHash('sha256').update('unbudgeted').digest('hex').slice(0, 10);
  const request = JSON.parse(readFileSync(path.join(directory,
    'sanctuary-cleanup', `95990-1/isolated-unbudgeted-${suffix}`, 'run-request.json'), 'utf8'));
  assert.equal(Object.hasOwn(request, 'subjectDeadlineEpochMs'), false);
});

test('ordinary isolated commands retain subject deadline supervision', () => {
  const { directory, environment } = fixture();
  const marker = path.join(directory, 'ordinary-started');
  const result = invoke('bash', [WRAPPER, 'ordinary-budget', process.execPath, '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'yes'); process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)`],
  { ...environment, SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS: String(Date.now() + 5000) }, directory);
  assert.equal(result.status, 124, result.log);
  assert.ok(existsSync(marker), result.log);
  assert.match(result.log, /"cleanupState":"cleaned"/);
  const suffix = createHash('sha256').update('ordinary-budget').digest('hex').slice(0, 10);
  const lane = `isolated-ordinary-bud-${suffix}`;
  const verified = invoke(process.execPath, [VERIFY,
    '--artifact-root', path.join(directory, 'sanctuary-cleanup-artifacts', `95990-1/${lane}`),
    '--runtime-root', path.join(directory, 'sanctuary-cleanup', `95990-1/${lane}`),
    '--checkout-root', ROOT], environment, directory);
  assert.equal(verified.status, 0, verified.log);
});

test('nested cleanup flags are limited to the tracked install and upgrade drivers', () => {
  const workflow = YAML.parse(readFileSync(path.join(ROOT, '.github/workflows/install-test.yml'), 'utf8'));
  const jobs = ['fresh-install-test', 'install-stack-smoke', 'container-health-test',
    'auth-flow-test', 'upgrade-baseline-test'];
  for (const [id, job] of Object.entries(workflow.jobs)) {
    const runs = job.steps.map((step) => step.run ?? '').join('\n');
    const flags = runs.match(/run-in-isolated-workspace.sh --docker-visible --nested-cleanup /g) ?? [];
    assert.equal(flags.length, jobs.includes(id) ? 1 : 0, id);
  }
  const extended = readFileSync(path.join(ROOT, 'scripts/ci/run-extended-upgrade-fixtures.sh'), 'utf8');
  assert.equal(extended.match(/run-in-isolated-workspace.sh --docker-visible --nested-cleanup /g)?.length, 1);
});

test('both nested flag orders reach budget validation and unknown flags are refused', () => {
  const { directory, environment } = fixture();
  for (const flags of [['--nested-cleanup', '--docker-visible'], ['--docker-visible', '--nested-cleanup']]) {
    const result = invoke('bash', [WRAPPER, ...flags, 'order', 'true'], {
      ...environment, SANCTUARY_CI_SUBJECT_DEADLINE_EPOCH_MS: '1',
    }, directory);
    assert.equal(result.status, 124, result.log);
  }
  const unknown = invoke('bash', [WRAPPER, '--nested-cleanup', '--not-a-flag', 'order', 'true'], environment, directory);
  assert.equal(unknown.status, 1);
  assert.match(unknown.log, /unknown option: --not-a-flag/);
  assert.equal(existsSync(path.join(directory, 'sanctuary-cleanup')), false);
});
