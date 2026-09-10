import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FAMILIES,
  parseJsonOr,
  parseMetrics,
  readCgroup,
  readEnvFile,
  summarizeFleet,
} from '../../scripts/release/canary/lib/canary-runtime.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANARY_DIR = path.resolve(HERE, '../../scripts/release/canary');
const PROBE = path.join(CANARY_DIR, 'canary-probe.mjs');
const SELFTEST = path.join(CANARY_DIR, 'canary-selftest.mjs');
const DEBUG = path.join(CANARY_DIR, 'canary-debug.mjs');
const RUNTIME = path.join(CANARY_DIR, 'lib/canary-runtime.mjs');
const TOOLS = [PROBE, SELFTEST, DEBUG, RUNTIME];
const ACTIVATION_CONSTANTS = path.resolve(
  HERE,
  '../../server/src/constants/walletSyncActivation.ts',
);

// Read the constant out of the TypeScript source rather than importing it.
// These release tools are plain Node and deliberately do not load TS -- the
// same reason verify-release-candidate-canary.mjs mirrors its sync-progress
// ceiling instead of importing it. Parsing keeps the value tied to the real
// definition, so raising it still moves this floor.
function drainHorizonMs() {
  const source = readFileSync(ACTIVATION_CONSTANTS, 'utf8');
  const maxExecution = source.match(
    /WALLET_SYNC_MAX_EXECUTION_MS\s*=\s*(\d+)\s*\*\s*(?:60_000|60000)/,
  );
  assert.ok(
    maxExecution,
    'could not read WALLET_SYNC_MAX_EXECUTION_MS from the activation constants',
  );
  const slack = source.match(
    /WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS\s*=\s*\n?\s*WALLET_SYNC_MAX_EXECUTION_MS\s*\+\s*([\d_]+)/,
  );
  assert.ok(
    slack,
    'could not read WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS from the activation constants',
  );
  return Number(maxExecution[1]) * 60_000 + Number(slack[1].replace(/_/g, ''));
}

// These tools gate every stable release: no canary receipt, no stable tag. They
// lived only on the production host, untracked, until 2026-09-10 -- which meant
// the activation-timeout defect below could not be reviewed, tested, or even
// diffed, and was rediscovered by losing a release cycle twice.
test('the canary tooling is tracked in the repository', () => {
  for (const file of TOOLS) {
    const source = readFileSync(file, 'utf8');
    assert.ok(source.length > 0, `${path.basename(file)} must not be empty`);
  }
});

test('the canary tooling parses', () => {
  for (const file of TOOLS) {
    // Throws with the syntax error attached if the file does not parse.
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
});

// The regression this file exists for.
//
// The wallet-sync activation gate blocks in two sequential phases after any
// worker restart, and a deploy always restarts the worker:
//
//   1. restart_observed -- a Redis marker with RESTART_MARKER_TTL_MS =
//      max(REGISTRY_RETENTION_MS, WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS).
//   2. stabilizing -- only once that expires can a healthy observation be
//      accepted, which then starts the drain horizon over again.
//
// So admissions reopen roughly 2 x DRAIN_HORIZON after a deploy. Throughout,
// POST /sync/network/mainnet answers 200 success:true with requested:0
// merged:0 rejected:<fleet>, which reads like a hung fleet but is the gate
// failing closed.
//
// The probe shipped with a 15-minute default, which cannot survive phase 1
// alone. It aborted with "fleet admission never accepted (activation gate)" on
// every canary started soon after a deploy, and cost the v0.8.70-rc8 and
// v0.8.71-rc7 canaries a full cycle each. Derive the floor from the real
// constant so that raising WALLET_SYNC_MAX_EXECUTION_MS cannot silently
// reintroduce it.
test('the probe activation timeout covers both gate phases', () => {
  const source = readFileSync(PROBE, 'utf8');
  const match = source.match(
    /CANARY_ACTIVATION_TIMEOUT_MS\s*\|\|\s*(\d+)\s*\*\s*(60_000|60000)/,
  );
  assert.ok(
    match,
    'probe must define a numeric CANARY_ACTIVATION_TIMEOUT_MS default in minutes',
  );

  const defaultMs = Number(match[1]) * 60_000;
  const requiredMs = 2 * drainHorizonMs();

  assert.ok(
    defaultMs >= requiredMs,
    `probe activation timeout default is ${defaultMs / 60_000}m but the gate can `
      + `block for ${requiredMs / 60_000}m (2 x drain horizon); a probe started `
      + 'after a deploy would abort before admissions reopen',
  );
});

// The tools read every endpoint and credential from the runtime env. Tracking
// them must not become a way to commit an operator's secrets or the address of
// a private instance.
test('the canary tooling embeds no credentials or host addresses', () => {
  const secretShaped = /['"][A-Fa-f0-9]{32,}['"]|['"][A-Za-z0-9+/]{40,}={0,2}['"]/;
  const privateAddress = /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/;

  for (const file of TOOLS) {
    const source = readFileSync(file, 'utf8');
    const name = path.basename(file);
    assert.ok(
      !secretShaped.test(source),
      `${name} contains a literal that looks like a key or token`,
    );
    assert.ok(
      !privateAddress.test(source),
      `${name} hardcodes a private network address; endpoints must come from the env`,
    );
  }
});

// The three tools carried three private copies of the helper block until it was
// extracted into lib/canary-runtime.mjs, and the copies had already drifted: the
// probe tolerated the `sanctuary_` metric prefix while the other two matched
// only the bare names, so a self-test reported counter families missing that the
// probe saw fine. Keep the extraction honest -- no tool may redefine a helper.
test('the canary tools share one runtime instead of copying it', () => {
  for (const file of [PROBE, SELFTEST, DEBUG]) {
    const source = readFileSync(file, 'utf8');
    const name = path.basename(file);
    assert.match(
      source,
      /from '\.\/lib\/canary-runtime\.mjs'/,
      `${name} must import the shared canary runtime`,
    );
    for (const helper of ['function parseMetrics', 'function readEnvFile', 'function mintAccessToken']) {
      assert.ok(
        !source.includes(helper),
        `${name} redefines ${helper.replace('function ', '')}; import it from lib/canary-runtime.mjs`,
      );
    }
  }
});

// The drift that extraction removed, pinned as behaviour: the backend has
// exposed both the bare and the `sanctuary_`-prefixed family names across
// releases, and a canary that matched only one spelling reported a healthy
// fleet as missing its counters.
test('parseMetrics accepts both bare and sanctuary_-prefixed family names', () => {
  const bare = FAMILIES.map((f) => `# TYPE wallet_sync_${f}_total counter`).join('\n');
  const prefixed = FAMILIES.map((f) => `# TYPE sanctuary_wallet_sync_${f}_total counter`).join('\n');

  for (const [label, text] of [['bare', bare], ['prefixed', prefixed]]) {
    const parsed = parseMetrics(text);
    assert.deepEqual(
      [...parsed.families].sort(),
      [...FAMILIES].sort(),
      `${label} family names must all be recognised`,
    );
  }

  assert.equal(parseMetrics('# TYPE wallet_sync_active_stage_oldest_seconds gauge').activeStageAge, true);
  assert.equal(parseMetrics('# TYPE sanctuary_wallet_sync_active_stage_oldest_seconds gauge').activeStageAge, true);
  assert.equal(parseMetrics('# TYPE wallet_sync_other_total counter').activeStageAge, false);
});

test('parseMetrics sums every labelled fallback series', () => {
  const text = [
    'sanctuary_wallet_sync_fallback_total{reason="a"} 2',
    'wallet_sync_fallback_total{reason="b"} 3.5',
    'wallet_sync_fallback_total 1',
    'unrelated_total 99',
  ].join('\n');
  assert.equal(parseMetrics(text).fallback, 6.5);
  assert.equal(parseMetrics('').fallback, 0);
});

test('readEnvFile strips one layer of quotes and ignores comments', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'canary-env-'));
  const file = path.join(dir, 'sanctuary.env');
  writeFileSync(file, [
    '# a comment',
    '',
    'JWT_SECRET="quoted"',
    "WORKER_DIAGNOSTICS_SECRET='single'",
    'PLAIN=bare',
    'WITH_EQUALS=a=b',
    'malformed-line-without-separator',
  ].join('\n'));

  assert.deepEqual(readEnvFile(file), {
    JWT_SECRET: 'quoted',
    WORKER_DIAGNOSTICS_SECRET: 'single',
    PLAIN: 'bare',
    WITH_EQUALS: 'a=b',
  });
});

// Fleet outcome counts must equal fleet.total or the receipt is rejected, so
// the classification has to be exhaustive and mutually exclusive.
test('summarizeFleet classifies every wallet exactly once', () => {
  const wallets = [
    { status: 'success', inProgress: false, pending: false, lease: false, actionRequired: false },
    { status: 'retrying', inProgress: false, pending: false, lease: false, actionRequired: false },
    { status: 'failed', inProgress: false, pending: false, lease: false, actionRequired: false },
    { status: 'success', inProgress: false, pending: false, lease: false, actionRequired: true },
    { status: 'success', inProgress: true, pending: true, lease: true, actionRequired: false },
  ];
  const summary = summarizeFleet(wallets);

  assert.equal(summary.total, 5);
  assert.equal(summary.active, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.leasesPresent, 1);
  assert.equal(summary.terminal, 4);
  // A `failed` status counts as action-required even without the timestamp.
  assert.equal(summary.actionRequired, 2);
  assert.equal(summary.retrying, 1);
  assert.equal(summary.success, 2);
  assert.equal(
    summary.success + summary.retrying + summary.actionRequired,
    summary.total,
    'outcome counts must reconcile to the fleet total',
  );
});

test('summarizeFleet handles an empty fleet', () => {
  assert.deepEqual(summarizeFleet([]), {
    total: 0, active: 0, pending: 0, leasesPresent: 0,
    success: 0, retrying: 0, actionRequired: 0, terminal: 0,
  });
});

// Every absent-or-malformed read in these tools funnels through parseJsonOr /
// readCgroup precisely so no catch block swallows an error in place --
// scripts/check-safety-catch-guards.mjs scans scripts/release and treats a
// catch that neither rethrows nor returns as a finding.
test('parseJsonOr falls back instead of throwing', () => {
  assert.deepEqual(parseJsonOr('{"a":1}'), { a: 1 });
  assert.equal(parseJsonOr('not json'), null);
  assert.equal(parseJsonOr(''), null);
  assert.equal(parseJsonOr(undefined), null);
  assert.deepEqual(parseJsonOr('not json', { parseError: true }), { parseError: true });
  // A literal `null` body parses successfully and must not be confused with the
  // fallback; callers branch on truthiness, so both read as "no body".
  assert.equal(parseJsonOr('null', { fallback: true }), null);
});

test('readCgroup returns null when neither cgroup layout exists', () => {
  assert.equal(readCgroup('0000000000000000000000000000000000000000000000000000000000000000', 'memory.peak'), null);
});
