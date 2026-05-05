// Regression checks for the Node provider-context adapter. Run with:
//   node tests/ci/provider-context-node.test.mjs
//
// The shell adapter has its own bash-based test suite; this file mirrors the
// scenarios that matter for Node consumers (detect-drift.mjs, future helpers).

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';

const HERE = new URL('.', import.meta.url).pathname;
const ADAPTER_PATH = join(HERE, '..', '..', 'scripts', 'ci', 'provider-context.mjs');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function assertEq(label, expected, actual) {
  if (expected !== actual) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Run a snippet inside a child Node process with a clean env. The snippet has
// access to `adapter` (named import) and prints whatever it wants on stdout.
async function freshEval(snippet, extraEnv = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'provider-context-test-'));
  const scriptPath = join(tempDir, 'run.mjs');
  const source = `
    import * as adapter from ${JSON.stringify(ADAPTER_PATH)};
    const out = await (async () => { ${snippet} })();
    if (out !== undefined) process.stdout.write(String(out));
  `;
  writeFileSync(scriptPath, source);
  return new Promise((resolve, reject) => {
    const child = fork(scriptPath, [], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`child exited ${code}: ${stderr}`));
      else resolve({ stdout, stderr });
    });
  });
}

async function main() {
  // ---- ciProvider sniffing ------------------------------------------------
  assertEq('default provider', 'local', (await freshEval('return adapter.ciProvider();')).stdout);
  assertEq('CI=true', 'unknown-ci',
    (await freshEval('return adapter.ciProvider();', { CI: 'true' })).stdout);
  assertEq('GITHUB_ACTIONS=true', 'github',
    (await freshEval('return adapter.ciProvider();', { GITHUB_ACTIONS: 'true' })).stdout);
  assertEq('FORGEJO_ACTIONS=true', 'forgejo',
    (await freshEval('return adapter.ciProvider();', { FORGEJO_ACTIONS: 'true' })).stdout);
  assertEq('forgejo wins over github', 'forgejo',
    (await freshEval('return adapter.ciProvider();', { GITHUB_ACTIONS: 'true', FORGEJO_ACTIONS: 'true' })).stdout);
  assertEq('provider override', 'custom',
    (await freshEval('return adapter.ciProvider();',
      { GITHUB_ACTIONS: 'true', SANCTUARY_CI_PROVIDER_OVERRIDE: 'custom' })).stdout);

  // ---- event envelope -----------------------------------------------------
  assertEq('event name', 'push',
    (await freshEval('return adapter.ciEventName();', { EVENT_NAME: 'push' })).stdout);
  assertEq('PR base sha', 'b1',
    (await freshEval('return adapter.ciEventBaseSha();',
      { EVENT_NAME: 'pull_request', PR_BASE_SHA: 'b1' })).stdout);
  assertEq('PR head sha falls back to WORKFLOW_SHA', 'wf',
    (await freshEval('return adapter.ciEventHeadSha();',
      { EVENT_NAME: 'pull_request', WORKFLOW_SHA: 'wf' })).stdout);
  assertEq('schedule has no base', '',
    (await freshEval('return adapter.ciEventBaseSha();', { EVENT_NAME: 'schedule' })).stdout);

  // ---- workspace / runId / tempDir ----------------------------------------
  assertEq('GITHUB_WORKSPACE', '/ws',
    (await freshEval('return adapter.ciWorkspace();', { GITHUB_WORKSPACE: '/ws' })).stdout);
  assertEq('GITHUB_RUN_ID', '1234',
    (await freshEval('return adapter.ciRunId();', { GITHUB_RUN_ID: '1234' })).stdout);
  assertEq('RUNNER_TEMP', '/runner-tmp',
    (await freshEval('return adapter.ciTempDir();', { RUNNER_TEMP: '/runner-tmp' })).stdout);

  // ---- output / env / summary file resolution -----------------------------
  assertEq('GITHUB_OUTPUT', '/gh/output',
    (await freshEval('return adapter.ciOutputFile();', { GITHUB_OUTPUT: '/gh/output' })).stdout);
  assertEq('output null without env', 'null',
    (await freshEval('return JSON.stringify(adapter.ciOutputFile());')).stdout);

  // ---- emit helpers append to file ----------------------------------------
  const tempDir = mkdtempSync(join(tmpdir(), 'provider-context-emit-'));
  const envFile = join(tempDir, 'env');
  writeFileSync(envFile, '');
  await freshEval('adapter.ciEmitEnv("KEY=value");', { SANCTUARY_CI_ENV_FILE: envFile });
  assertEq('emit env appended', 'KEY=value\n', readFileSync(envFile, 'utf8'));

  const outFile = join(tempDir, 'out');
  writeFileSync(outFile, '');
  await freshEval('adapter.ciEmitOutput("a=1", "b=2");', { SANCTUARY_CI_OUTPUT_FILE: outFile });
  assertEq('emit output appended both', 'a=1\nb=2\n', readFileSync(outFile, 'utf8'));

  // ---- annotation helpers -------------------------------------------------
  const ghWarn = await freshEval('adapter.ciEmitWarning("hot");', { GITHUB_ACTIONS: 'true' });
  assertEq('warning on github', '::warning::hot\n', ghWarn.stdout);
  const localWarn = await freshEval('adapter.ciEmitWarning("softly");');
  assertEq('warning on local goes to stderr', 'warning: softly\n', localWarn.stderr);

  console.log('provider-context (node) regression checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
