import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CANARY_ADMIN_SQL,
  CANARY_MIN_FLEET,
  FAMILIES,
  fleetReadiness,
  parseJsonOr,
  parseMetrics,
  readCgroup,
  readEnvFile,
  shouldSeedFleet,
  summarizeFleet,
} from '../../scripts/release/canary/lib/canary-runtime.mjs';
// The worker-probe helpers are read off the namespace so that, while one is
// missing, its own test fails rather than the whole file failing to link.
import * as runtime from '../../scripts/release/canary/lib/canary-runtime.mjs';
import * as verifier from '../../scripts/release/verify-release-candidate-canary.mjs';

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
test('the probe and selftest act as the admin who can access the most mainnet wallets', () => {
  // An arbitrary admin (an operator account next to the seeded demo login that owns
  // the canary fleet) admits no wallets, so the canary would wait out its timeout.
  for (const tool of [PROBE, SELFTEST]) {
    const source = readFileSync(tool, 'utf8');
    assert.match(source, /psql\(CANARY_ADMIN_SQL\)/, `${path.basename(tool)} must use CANARY_ADMIN_SQL`);
    assert.doesNotMatch(source, /"isAdmin" = true limit 1/, `${path.basename(tool)} picks an arbitrary admin`);
  }
  assert.match(CANARY_ADMIN_SQL, /"isAdmin" = true/);
  assert.match(CANARY_ADMIN_SQL, /from wallet_users wu join wallets w on w\.id = wu\."walletId"/);
  assert.match(CANARY_ADMIN_SQL, /w\.network = 'mainnet'\) desc, u\."createdAt", u\.id limit 1$/);
});

test('the canary fleet minimum matches the receipt validator', () => {
  const validator = readFileSync(path.resolve(HERE, '../../scripts/release/verify-release-candidate-canary.mjs'), 'utf8');
  assert.equal(Number(/fleet\.total < (\d+)\)/.exec(validator)?.[1]), CANARY_MIN_FLEET);
});

test('fleetReadiness refuses an undersized or partly invisible fleet before arming', () => {
  assert.deepEqual(fleetReadiness(15, 15), { minimum: 12, total: 15, accessible: 15, ready: true, problems: [] });
  const small = fleetReadiness(3, 3);
  assert.equal(small.ready, false);
  assert.match(small.problems[0], /3 mainnet wallets; the canary needs 12/);
  assert.match(small.hint, /npm run canary:fleet:seed/);
  assert.match(fleetReadiness(15, 0).problems[0], /can access 0 of 15/);
  assert.equal(fleetReadiness(12, null).ready, true);
  for (const tool of [PROBE, SELFTEST]) assert.match(readFileSync(tool, 'utf8'), /fleetReadiness\(/);
});

test('the probe seeds a short fleet before arming unless CANARY_SEED_FLEET=0', () => {
  assert.equal(shouldSeedFleet(3, {}), true);
  assert.equal(shouldSeedFleet(11, { CANARY_SEED_FLEET: '1' }), true);
  assert.equal(shouldSeedFleet(12, {}), false);
  assert.equal(shouldSeedFleet(3, { CANARY_SEED_FLEET: '0' }), false);
  const probe = readFileSync(PROBE, 'utf8');
  const at = (pattern) => probe.search(pattern);
  const seed = at(/canary-fleet\.mjs['"]\)\s*,\s*['"]seed['"]/);
  assert.ok(seed > 0, 'the probe runs canary-fleet.mjs seed');
  // Seeding must precede admin selection so the fleet owner can become the canary admin,
  // and arming, so it never enters the evidence.
  assert.ok(at(/psql\(CANARY_ADMIN_SQL\)/) > seed, 'seeding runs before the canary admin is chosen');
  assert.ok(at(/type:\s*['"]armed['"]/) > seed, 'seeding runs before arming');
});

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

// The receipt's live/ready/metricsPrometheus samples, its counter families and
// its fallback delta must come from the worker: wallet_sync_fallback_total is
// incremented only there (server/src/worker/walletSyncAttemptTelemetry.ts), so
// a backend scrape always reports a zero delta and the gate it feeds is blind.
test('workerProbeUrls names the three worker health endpoints', () => {
  assert.equal(typeof runtime.workerProbeUrls, 'function', 'lib/canary-runtime.mjs must export workerProbeUrls');
  assert.deepEqual(runtime.workerProbeUrls('http://worker:3002'), {
    live: 'http://worker:3002/live',
    ready: 'http://worker:3002/ready',
    metricsPrometheus: 'http://worker:3002/metrics/prometheus',
  });
});

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  const next = source.indexOf('\nasync function ', start + 1);
  const nextSync = source.indexOf('\nfunction ', start + 1);
  const ends = [next, nextSync].filter((i) => i > 0);
  return source.slice(start, ends.length ? Math.min(...ends) : undefined);
}

test('the probe and selftest scrape the worker, not the backend', () => {
  for (const tool of [PROBE, SELFTEST]) {
    const source = readFileSync(tool, 'utf8');
    const name = path.basename(tool);
    assert.doesNotMatch(source, /\$\{backendBase\}\/metrics/, `${name} scrapes backend /metrics`);
    assert.doesNotMatch(source, /\$\{backendBase\}\/api\/v1\/health\/ready/, `${name} samples backend /ready`);
    assert.match(source, /workerProbeUrls\(/, `${name} must use workerProbeUrls`);
  }
  const sampleOnce = functionBody(readFileSync(PROBE, 'utf8'), 'sampleOnce');
  assert.match(sampleOnce, /workerProbeUrls\(workerBase\)/, 'sampleOnce must sample the worker endpoints');
  assert.doesNotMatch(sampleOnce, /backendBase/, 'sampleOnce must not sample the backend');
});

test('the probe and selftest pick the first worker IP that answers /live', async () => {
  assert.equal(typeof runtime.discoverWorkerBase, 'function', 'lib/canary-runtime.mjs must export discoverWorkerBase');
  const asked = [];
  const fetcher = async (url) => { asked.push(url); return { ok: url.startsWith('http://b:') }; };
  assert.equal(await runtime.discoverWorkerBase(['a', 'b', 'c'], fetcher), 'http://b:3002');
  assert.deepEqual(asked, ['http://a:3002/live', 'http://b:3002/live']);
  assert.equal(await runtime.discoverWorkerBase(['a', 'c'], fetcher), null);
  assert.equal(await runtime.discoverWorkerBase([], fetcher), null);

  for (const tool of [PROBE, SELFTEST]) {
    const source = readFileSync(tool, 'utf8');
    const name = path.basename(tool);
    assert.match(source, /discoverWorkerBase\(await containerIps\(`\$\{PROJECT\}-worker-1`\)\)/, `${name} must iterate every worker IP`);
    assert.doesNotMatch(source, /\[workerIp\]|:3002/, `${name} hard-codes a single worker base`);
    assert.match(source, /if \(!backendBase \|\| !workerBase\) \{[^}]*process\.exit\(2\)/, `${name} must exit 2 when no worker answers /live`);
  }
  const probe = readFileSync(PROBE, 'utf8');
  const armed = probe.search(/type:\s*'armed'/);
  assert.ok(probe.indexOf('discoverWorkerBase(') < armed, 'worker /live is checked before arming');
  assert.ok(probe.indexOf('if (!backendBase || !workerBase)') < armed, 'an unreachable worker fails before arming');
});

test('the selftest reports all three worker endpoints and bounds its sampling mode', () => {
  assert.equal(typeof runtime.parseSelftestSampling, 'function', 'lib/canary-runtime.mjs must export parseSelftestSampling');
  assert.equal(runtime.SELFTEST_WINDOW_LIMIT_MS, 900_000);
  assert.equal(runtime.SELFTEST_DIAG_INTERVAL_MS, 250, 'diagnostics are polled at the probe active-phase cadence');
  assert.ok(Number.isSafeInteger(runtime.SELFTEST_MAX_SAMPLES) && runtime.SELFTEST_MAX_SAMPLES > 0);
  assert.deepEqual(runtime.parseSelftestSampling({}), { enabled: false });
  assert.deepEqual(runtime.parseSelftestSampling({ CANARY_SELFTEST_SAMPLES: '300' }), { enabled: true, samples: 300, intervalMs: 1000 });
  assert.equal(runtime.parseSelftestSampling({ CANARY_SELFTEST_SAMPLES: '99999999' }).samples, runtime.SELFTEST_MAX_SAMPLES);
  assert.equal(runtime.parseSelftestSampling({ CANARY_SELFTEST_SAMPLES: '5', CANARY_SELFTEST_INTERVAL_MS: '500' }).intervalMs, 500);
  for (const bad of [{ CANARY_SELFTEST_SAMPLES: '0' }, { CANARY_SELFTEST_SAMPLES: 'x' }, { CANARY_SELFTEST_SAMPLES: '-3' },
    { CANARY_SELFTEST_SAMPLES: '5', CANARY_SELFTEST_INTERVAL_MS: '0' }]) {
    assert.match(runtime.parseSelftestSampling(bad).error, /CANARY_SELFTEST_/, `${JSON.stringify(bad)} must be refused`);
  }

  const source = readFileSync(SELFTEST, 'utf8');
  assert.match(source, /parseSelftestSampling\(process\.env\)/, 'the selftest reads the CANARY_SELFTEST_SAMPLES knob');
  for (const key of ['live', 'ready', 'metricsPrometheus']) {
    assert.match(source, new RegExp(`${key}: stripTiming\\(`), `the selftest reports status and latency for ${key}`);
  }
  assert.match(source, /SELFTEST_WINDOW_LIMIT_MS/, 'the sampling window has a fixed deadline');
  assert.match(source, /pause\(t, SELFTEST_DIAG_INTERVAL_MS, /, 'diagnostics are polled at 250 ms');
  // Knob-less exit contract unchanged: the window evaluation (and its non-zero
  // exits) is reached only past the guard that ends a knob-less run with exit 0.
  const guard = source.indexOf('if (!sampling.enabled) {');
  assert.ok(guard > 0, 'a knob-less run must end after reporting');
  assert.match(source.slice(guard, source.indexOf('}', guard)), /console\.log\(JSON\.stringify\(report[^]*process\.exit\(0\);\s*$/, 'a knob-less run exits 0');
  assert.equal(source.split('evaluateSelftestWindow(').length, 2, 'evaluateSelftestWindow is called exactly once');
  assert.equal(source.split('runSamplingWindow(').length, 3, 'runSamplingWindow is defined once and called once');
  assert.ok(source.indexOf('await runSamplingWindow(') > guard, 'the sampling window runs only when the knob is set');
  assert.ok(source.indexOf('function runSamplingWindow(') > guard, 'the window helpers follow the knob-less exit');
  assert.doesNotMatch(source.slice(0, guard), /process\.exit\((?!2\))/, 'before the guard the selftest exits only 2');
});

function endpointSample(latencyMs = 10, ok = true) {
  const e = { ok, latencyMs };
  return { live: e, ready: e, metricsPrometheus: e };
}

function windowOf({ active, endpoints = Array.from({ length: 300 }, () => endpointSample()), elapsedMs = 900_000, requestedSamples = endpoints.length }) {
  const diagSamples = [
    ...Array.from({ length: active }, () => ({ status: 'observed', activeTotal: '2' })),
    ...Array.from({ length: 100 }, () => ({ status: 'observed', activeTotal: '0' })),
    { status: 'unavailable', http: 0 },
  ];
  return runtime.evaluateSelftestWindow({ endpointSamples: endpoints, diagSamples, elapsedMs, requestedSamples });
}

test('evaluateSelftestWindow needs 40 active diagnostics samples and applies the receipt gates', () => {
  assert.equal(typeof runtime.evaluateSelftestWindow, 'function', 'lib/canary-runtime.mjs must export evaluateSelftestWindow');
  const short = windowOf({ active: 39 });
  assert.equal(short.valid, false);
  assert.equal(short.activeSamples, 39, "activeTotal '0' and unavailable samples are not active");
  const enough = windowOf({ active: 40 });
  assert.equal(enough.valid, true);
  assert.equal(enough.pass, true);
  for (const key of ['live', 'ready', 'metricsPrometheus']) assert.equal(enough.gates[key].pass, true);

  const failing = windowOf({ active: 40, endpoints: [...Array.from({ length: 299 }, () => endpointSample()), endpointSample(10, false)] });
  assert.deepEqual(failing.gates.ready.missed, ['failures']);
  assert.equal(failing.pass, false);
  const slow = windowOf({ active: 40, endpoints: [...Array.from({ length: 290 }, () => endpointSample()), ...Array.from({ length: 10 }, () => endpointSample(300))] });
  assert.deepEqual(slow.gates.live.missed, ['p99']);
  const spike = windowOf({ active: 40, endpoints: [...Array.from({ length: 299 }, () => endpointSample()), endpointSample(1001)] });
  assert.deepEqual(spike.gates.metricsPrometheus.missed, ['max']);
  assert.equal(windowOf({ active: 40, endpoints: [] }).gates.live.pass, false, 'an empty window passes no gate');

  assert.equal(enough.invalidReason, null);
  // A window the 900 s deadline cut short of the requested sample count is invalid,
  // however many active diagnostics samples it saw (900 at 2000 ms -> ~450).
  const cutShort = windowOf({ active: 60, requestedSamples: 900, endpoints: Array.from({ length: 450 }, () => endpointSample()) });
  assert.equal(cutShort.valid, false);
  assert.equal(cutShort.pass, false);
  assert.equal(cutShort.endpointSampleCount, 450);
  assert.equal(cutShort.requestedSamples, 900);
  assert.match(cutShort.invalidReason, /450 of 900 requested endpoint samples/);
  assert.match(windowOf({ active: 39 }).invalidReason, /39 of 40 active diagnostics samples/);
  const full = windowOf({ active: 40, requestedSamples: 300 });
  assert.equal(full.valid, true, 'a window that took every requested sample is unaffected');
  assert.equal(full.pass, true);

  // The gates are the receipt validator's, not a looser local copy.
  const validator = readFileSync(path.resolve(HERE, '../../scripts/release/verify-release-candidate-canary.mjs'), 'utf8');
  assert.match(validator, /summary\.failures !== 0/);
  assert.match(validator, /summary\.p99Ms > 250/);
  assert.match(validator, /summary\.maxMs > 1000/);
});

// The attested services, written out rather than read from
// CANARY_ATTESTED_SERVICES so a constant that drops one cannot pass with it.
const SERVICES = ['backend', 'worker', 'frontend', 'gateway', 'llm-egress-proxy'];
const CANARY_COMMIT = 'c'.repeat(40);

function imageIdOf(service) {
  return `sha256:${String(SERVICES.indexOf(service) + 1).repeat(64)}`;
}

function revisionOf(service) {
  return String(SERVICES.indexOf(service) + 1).repeat(40);
}

function deployedImages(revision = CANARY_COMMIT) {
  return SERVICES.map((service) => ({ service, imageId: imageIdOf(service), revision }));
}

function namesOnly(problems, service) {
  return problems.length === 1 && problems[0].includes(service);
}

test('deployedRevisionProblems accepts only images built from CANARY_COMMIT', () => {
  assert.deepEqual(runtime.deployedRevisionProblems(deployedImages(), CANARY_COMMIT), []);
  for (const service of SERVICES) {
    const images = deployedImages().map((image) => (
      image.service === service ? { ...image, revision: 'd'.repeat(40) } : image
    ));
    assert.ok(namesOnly(runtime.deployedRevisionProblems(images, CANARY_COMMIT), service), `revision mismatch on ${service}`);
    const missing = deployedImages().filter((image) => image.service !== service);
    assert.ok(namesOnly(runtime.deployedRevisionProblems(missing, CANARY_COMMIT), service), `missing ${service}`);
    const unlabelled = deployedImages().map((image) => (
      image.service === service ? { ...image, revision: '' } : image
    ));
    assert.ok(namesOnly(runtime.deployedRevisionProblems(unlabelled, CANARY_COMMIT), service), `unlabelled ${service}`);
  }
  const short = runtime.deployedRevisionProblems(deployedImages('c'.repeat(7)), 'c'.repeat(7));
  for (const service of SERVICES) {
    assert.ok(short.some((problem) => problem.includes(service)), `short commit names ${service}`);
  }
});

test('deployedImageDriftProblems and attestationProblems catch a stack swapped mid-run', () => {
  assert.deepEqual(runtime.deployedImageDriftProblems(deployedImages(), deployedImages()), []);
  const swapped = deployedImages().map((image) => (
    image.service === 'gateway' ? { ...image, imageId: `sha256:${'e'.repeat(64)}` } : image
  ));
  assert.ok(namesOnly(runtime.deployedImageDriftProblems(deployedImages(), swapped), 'gateway'));
  const gone = deployedImages().filter((image) => image.service !== 'worker');
  assert.ok(namesOnly(runtime.deployedImageDriftProblems(deployedImages(), gone), 'worker'));

  const driftOnly = runtime.attestationProblems(deployedImages(), swapped, CANARY_COMMIT);
  assert.ok(driftOnly.length > 0 && driftOnly.some((problem) => problem.includes('gateway')));
  const revisionOnly = runtime.attestationProblems(deployedImages(), deployedImages('d'.repeat(40)), CANARY_COMMIT);
  assert.ok(revisionOnly.length > 0);
});

// A stand-in docker CLI: `inspect p-<service>-1` reports a distinct image id per
// service, and `image inspect` prints that image's own revision label (any
// other image argument gets a foreign commit).
function fakeDockerScript() {
  const inspectArms = SERVICES.map((service) => (
    `  p-${service}-1) printf '%s\\n' '[{"Id":"container-${service}","Image":"${imageIdOf(service)}","State":{"Status":"running"},"RestartCount":0,"HostConfig":{}}]' ;;`
  ));
  const labelArms = SERVICES.map((service) => `    ${imageIdOf(service)}) printf '%s\\n' '${revisionOf(service)}' ;;`);
  return [
    '#!/bin/sh',
    'if [ "$1" = image ] && [ "$2" = inspect ]; then',
    '  case "$5" in',
    ...labelArms,
    `    *) printf '%s\\n' '${'f'.repeat(40)}' ;;`,
    '  esac',
    '  exit 0',
    'fi',
    '[ "$1" = inspect ] || exit 64',
    'case "$2" in',
    ...inspectArms,
    '  *) exit 1 ;;',
    'esac',
    '',
  ].join('\n');
}

test('attestDeployedImages reads the revision label of each running container image', async (context) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'canary-docker-'));
  writeFileSync(path.join(dir, 'docker'), fakeDockerScript());
  chmodSync(path.join(dir, 'docker'), 0o755);
  const envFile = path.join(dir, 'runtime-env');
  writeFileSync(envFile, 'JWT_SECRET=x\nWORKER_DIAGNOSTICS_SECRET=y\n');
  const originalPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
  context.after(() => { process.env.PATH = originalPath; });

  const canary = runtime.createCanaryRuntime({ envFile, project: 'p' });
  const images = await canary.attestDeployedImages();
  assert.deepEqual(
    images.map(({ service, imageId, revision }) => [service, imageId, revision]),
    ['backend', 'worker', 'frontend', 'gateway', 'llm-egress-proxy']
      .map((service) => [service, imageIdOf(service), revisionOf(service)]),
  );
});

test('the probe refuses a foreign build before seeding and never receipts a swapped stack', () => {
  const probe = readFileSync(PROBE, 'utf8');
  const check = probe.indexOf('deployedRevisionProblems(');
  const gate = probe.indexOf('attestationProblems(');
  assert.ok(check > 0, 'the probe checks the deployed revisions at startup');
  assert.ok(gate > 0, 'the probe gates attestation on attestationProblems');
  const seed = probe.search(/canary-fleet\.mjs['"]\)\s*,\s*['"]seed['"]/);
  const armed = probe.search(/type:\s*'armed'/);
  const containerIpsAnchor = probe.indexOf('containerIps(`${PROJECT}-backend-1`)');
  const receiptWrite = probe.indexOf("path.join(OUT_DIR, 'receipt.json')");
  assert.ok(seed > 0 && armed > 0 && containerIpsAnchor > 0 && receiptWrite > 0);
  assert.ok(check < seed && check < armed, 'the revision check runs before seeding and arming');

  const startupExit = probe.indexOf('process.exit(2)', check);
  assert.ok(check > 0 && startupExit > check && startupExit < containerIpsAnchor, 'a foreign build exits before backend discovery');
  const attestations = [...probe.matchAll(/attestDeployedImages\(\)/g)].map((match) => match.index);
  assert.ok(attestations.some((index) => index > armed && index < receiptWrite), 'the images are re-read at attestation');
  assert.ok(gate > armed && gate < receiptWrite, 'the attestation gate runs before the receipt is written');
  const gateExit = probe.indexOf('process.exit(2)', gate);
  assert.ok(gate > 0 && gateExit > gate && gateExit < receiptWrite, 'a failed attestation exits before the receipt');
  assert.match(probe, /attestationProblems\(\s*deployed\s*,\s*hostImages\s*,\s*COMMIT\s*\)/);
  assert.doesNotMatch(probe, /deployedImageDriftProblems\(/);

  assert.match(probe, /schemaVersion:\s*CANARY_RECEIPT_V3_SCHEMA_VERSION/);
  assert.ok(!probe.includes("'sanctuary.release-candidate-canary.v2'"), 'the probe writes no v2 receipt');
  assert.match(probe, /images:\s*hostImages\.map\(/, 'the receipt images come from the attestation-time read');
});

test('CANARY_ATTESTED_SERVICES is exactly the five attested services', () => {
  assert.deepEqual(verifier.CANARY_ATTESTED_SERVICES, ['backend', 'worker', 'frontend', 'gateway', 'llm-egress-proxy']);
});
