import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertRc11,
  calculateMemoryEvidence,
  createResourceSnapshot,
  classifyContainerRunningState,
  classifyResourceSample,
  collectResourceSample,
  cleanup,
  healthProbeUrl,
  ownedResourceNames,
  parseArgs,
  parseJsonEvents,
  parseMemory,
  percentile,
  postgresRunArgs,
  qualifyRc10Failure,
  replayObservationTimeout,
  shouldStopQualifiedRc10Observation,
  validateReceiptValidationTrace,
  validateLiveReceiptInvariants,
  validateArchitectureReceipts,
  validateMaxArchitectureReceipts,
  validateProductionEvidenceReleaseReceipts,
  validatePhaseAndMutationTrace,
  stageAndStartWorker,
  waitForMaxFixturePreparation,
  workerCreateArgs,
  workerFileCopyArgs,
} from '../../scripts/perf/wallet-sync-high-fanout-replay.mjs';

const MAX_FIXTURE_SEQUENCE = [
  'output-below-success', 'output-below-rollback',
  'output-at-success', 'output-at-rollback',
  'input-below-success', 'input-below-rollback',
  'input-at-success', 'input-at-rollback',
  'weight-below', 'weight-at', 'weight-above',
  'output-count-below', 'output-count-at', 'output-count-above',
  'input-count-24999', 'input-count-25000', 'input-count-25001',
  'combined',
];
const MAX_COMBINED_FIXTURE_PROGRESS_SEQUENCE = [
  'input-references-built',
  'transaction-inputs-built',
  'transaction-outputs-built',
  'transaction-serialized',
  'weight-measured',
];

const maxFixtureProgress = (index) => ({
  event: 'max_fixture_sealed',
  label: MAX_FIXTURE_SEQUENCE[index],
  sequence: index + 1,
  total: MAX_FIXTURE_SEQUENCE.length,
  sha256: String(index + 1).padStart(64, '0'),
  bytes: 100 + index,
  stagedMaxFixtureBytes: Array.from(
    { length: index + 1 },
    (_, itemIndex) => 100 + itemIndex,
  ).reduce((sum, value) => sum + value, 0),
});
const maxCombinedFixtureProgress = index => ({
  event: 'max_combined_fixture_progress',
  label: MAX_COMBINED_FIXTURE_PROGRESS_SEQUENCE[index],
  sequence: index + 1,
  total: MAX_COMBINED_FIXTURE_PROGRESS_SEQUENCE.length,
});

function scriptedPreparationRuntime(frames) {
  let frameIndex = 0;
  const current = () => frames[Math.min(frameIndex, frames.length - 1)];
  return {
    now: () => current().at,
    logs: () => current().events.map(event => JSON.stringify(event)).join('\n'),
    running: () => current().running ?? 'true',
    sleep: async () => { frameIndex += 1; },
  };
}

const maxPreparationManifest = {
  maxFixtureSequence: MAX_FIXTURE_SEQUENCE,
  maxCombinedFixtureProgressSequence: MAX_COMBINED_FIXTURE_PROGRESS_SEQUENCE,
  limits: {
    maxFixturePreparationIdleMs: 120_000,
    maxFixturePreparationMs: 1_200_000,
    maxFixtureStageBytes: 100_000,
  },
};

const replayDriverSource = readFileSync(
  new URL('../../scripts/perf/wallet-sync-persistence-driver.cjs', import.meta.url),
  'utf8',
);
const replayControllerSource = readFileSync(
  new URL('../../scripts/perf/wallet-sync-high-fanout-replay.mjs', import.meta.url),
  'utf8',
);
const replayDriverHelperSource = readFileSync(
  new URL('../../scripts/perf/wallet-sync-persistence-driver-helpers.cjs', import.meta.url),
  'utf8',
);
const fixtureRequire = createRequire(import.meta.url);
const {
  buildCombinedMaxFixture,
  buildMaxFixture,
  createDriverHelpers,
  createMaxCombinedFixtureProgressSequence,
  createMaxFixtureSequence,
} = fixtureRequire('../../scripts/perf/wallet-sync-persistence-driver-helpers.cjs');
test('replay driver exits explicitly after success or failure cleanup', () => {
  assert.match(replayDriverSource, /main\(\)\.then\([\s\S]*process\.exit\(0\)/);
  assert.match(replayDriverSource, /error => \{[\s\S]*emit\('replay_failed'[\s\S]*process\.exit\(1\)/);
});

const RC10 = '5c1d1909f177b7bbd7c8f470da375b2de6bd0de3';
const manifest = { limits: { sampledAndKernelPeakBytes: 768 * 1024 * 1024 } };
const evidenceReleaseReceipt = pass => ({
  event: 'production_evidence_release_receipt', pass, txDetailsCacheSize: 0,
  compactEvidenceSize: 0, outpointEvidenceSize: 0, outpointCoverageSize: 0,
  spentOutpointSize: 0,
});

test('controller requires the immutable RC10 identity and explicit evidence paths', () => {
  const parsed = parseArgs([
    '--mode', 'live', '--rc10-image', 'rc10', '--rc10-revision', RC10,
    '--rc11-image', 'rc11', '--rc11-revision', 'abc',
    '--fixture-manifest', 'manifest.json', '--evidence-dir', 'evidence',
  ]);
  assert.equal(parsed.mode, 'live');
  assert.equal(parsed.rc10Revision, RC10);
  assert.throws(() => parseArgs([
    '--mode', 'live', '--rc10-image', 'rc10', '--rc10-revision', 'wrong',
    '--rc11-image', 'rc11', '--rc11-revision', 'abc',
    '--fixture-manifest', 'manifest.json', '--evidence-dir', 'evidence',
  ]), /immutable/);
});

test('memory and percentile helpers retain exact boundary values', () => {
  assert.equal(parseMemory('1GiB'), 1024 ** 3);
  assert.equal(parseMemory('768MiB'), 768 * 1024 ** 2);
  assert.equal(parseMemory('garbage'), undefined);
  assert.equal(percentile([4, 1, 3, 2], 0.99), 4);
  assert.equal(percentile([], 0.99), 0);
});

test('outer observation budgets leave receipt and teardown headroom beyond per-pass watchdogs', () => {
  const limits = { liveOuterMs: 100 * 60_000, maxOuterMs: 60 * 60_000 };
  assert.equal(replayObservationTimeout('live', { limits }), 100 * 60_000);
  assert.equal(replayObservationTimeout('max', { limits }), 60 * 60_000);
});

test('maximum fixture preparation extends past the former fixed timeout only on exact progress', async () => {
  const progress = MAX_FIXTURE_SEQUENCE.slice(0, -1).map((_, index) => maxFixtureProgress(index));
  const combined = MAX_COMBINED_FIXTURE_PROGRESS_SEQUENCE.map(
    (_, index) => maxCombinedFixtureProgress(index),
  );
  const finalProgress = maxFixtureProgress(MAX_FIXTURE_SEQUENCE.length - 1);
  const frames = [
    { at: 0, events: [] },
    ...progress.map((_, index) => ({ at: (index + 1) * 50_000, events: progress.slice(0, index + 1) })),
    ...combined.map((_, index) => ({
      at: 870_000 + (index * 20_000),
      events: [...progress, ...combined.slice(0, index + 1)],
    })),
    {
      at: 980_000,
      events: [...progress, ...combined, finalProgress, {
        event: 'replay_ready', stagedMaxFixtureBytes: finalProgress.stagedMaxFixtureBytes,
      }],
    },
  ];
  const ready = await waitForMaxFixturePreparation(
    'worker', maxPreparationManifest, scriptedPreparationRuntime(frames),
  );
  assert.equal(ready.event, 'replay_ready');
  assert.equal(frames.at(-1).at > 600_000, true);
});

test('driver seals the exact maximum-fixture sequence before readiness', () => {
  const emitted = [];
  const tracker = createMaxFixtureSequence(
    { maxFixtureSequence: MAX_FIXTURE_SEQUENCE },
    (event, details) => emitted.push({ event, ...details }),
  );
  MAX_FIXTURE_SEQUENCE.forEach((label, index) => {
    tracker.seal(label, index + 1, ((index + 1) * (index + 2)) / 2, 'a'.repeat(64));
  });
  assert.doesNotThrow(() => tracker.assertComplete());
  assert.deepEqual(emitted.map(item => item.sequence), Array.from({ length: 18 }, (_, index) => index + 1));

  const drifted = createMaxFixtureSequence(
    { maxFixtureSequence: MAX_FIXTURE_SEQUENCE }, () => {},
  );
  assert.throws(() => drifted.seal('unknown', 1, 1, 'a'.repeat(64)), /sequence drifted/);
  assert.throws(() => drifted.assertComplete(), /incomplete/);

  const combinedEmitted = [];
  const combinedTracker = createMaxCombinedFixtureProgressSequence(
    { maxCombinedFixtureProgressSequence: MAX_COMBINED_FIXTURE_PROGRESS_SEQUENCE },
    (event, details) => combinedEmitted.push({ event, ...details }),
  );
  MAX_COMBINED_FIXTURE_PROGRESS_SEQUENCE.forEach(label => combinedTracker.complete(label));
  assert.doesNotThrow(() => combinedTracker.assertComplete());
  assert.deepEqual(
    combinedEmitted.map(item => item.label),
    MAX_COMBINED_FIXTURE_PROGRESS_SEQUENCE,
  );
});

test('maximum fixture preparation does not renew idle time for reread progress', async () => {
  const progress = maxFixtureProgress(0);
  const runtime = scriptedPreparationRuntime([
    { at: 0, events: [] },
    { at: 50_000, events: [progress] },
    { at: 100_000, events: [progress] },
    { at: 170_000, events: [progress] },
  ]);
  await assert.rejects(
    waitForMaxFixturePreparation('worker', maxPreparationManifest, runtime),
    /idle.*output-below-success.*1\/18/i,
  );
});

test('maximum fixture preparation accepts only new exact combined progress', async () => {
  const sealed = MAX_FIXTURE_SEQUENCE.slice(0, -1).map((_, index) => maxFixtureProgress(index));
  const first = maxCombinedFixtureProgress(0);
  await assert.rejects(waitForMaxFixturePreparation(
    'combined-reread-worker',
    maxPreparationManifest,
    scriptedPreparationRuntime([
      { at: 0, events: [...sealed, first] },
      { at: 60_000, events: [...sealed, first] },
      { at: 120_000, events: [...sealed, first] },
    ]),
  ), /idle/i);

  await assert.rejects(waitForMaxFixturePreparation(
    'combined-order-worker',
    maxPreparationManifest,
    scriptedPreparationRuntime([{
      at: 0,
      events: [...sealed, maxCombinedFixtureProgress(1)],
    }]),
  ), /malformed maximum combined-fixture progress sequence/i);

  await assert.rejects(waitForMaxFixturePreparation(
    'combined-truncated-worker',
    maxPreparationManifest,
    scriptedPreparationRuntime([
      { at: 0, events: [...sealed, first] },
      { at: 1, events: sealed },
    ]),
  ), /protocol log history shrank/i);
});

test('maximum fixture preparation enforces one ordered cross-stream protocol', async () => {
  const firstSeventeen = MAX_FIXTURE_SEQUENCE.slice(0, -1)
    .map((_, index) => maxFixtureProgress(index));
  const combined = MAX_COMBINED_FIXTURE_PROGRESS_SEQUENCE
    .map((_, index) => maxCombinedFixtureProgress(index));
  const finalSeal = maxFixtureProgress(MAX_FIXTURE_SEQUENCE.length - 1);
  const ready = { event: 'replay_ready', stagedMaxFixtureBytes: finalSeal.stagedMaxFixtureBytes };
  for (const [name, events, expected] of [
    [
      'combined-before-seals',
      [...firstSeventeen.slice(0, -1), combined[0]],
      /expected max_fixture_sealed before max_combined_fixture_progress/i,
    ],
    [
      'final-seal-before-combined',
      [...firstSeventeen, finalSeal],
      /expected max_combined_fixture_progress before max_fixture_sealed/i,
    ],
    [
      'ready-before-final-seal',
      [...firstSeventeen, ...combined, ready],
      /expected max_fixture_sealed before replay_ready/i,
    ],
    [
      'duplicate-ready',
      [...firstSeventeen, ...combined, finalSeal, ready, ready],
      /event after replay_ready/i,
    ],
  ]) {
    await assert.rejects(waitForMaxFixturePreparation(
      name,
      maxPreparationManifest,
      scriptedPreparationRuntime([{ at: 0, events }]),
    ), expected);
  }
});

test('maximum fixture preparation fails closed at idle and absolute bounds', async () => {
  await assert.rejects(waitForMaxFixturePreparation(
    'idle-worker',
    maxPreparationManifest,
    scriptedPreparationRuntime([{ at: 0, events: [] }, { at: 120_000, events: [] }]),
  ), /idle/i);

  const progress = MAX_FIXTURE_SEQUENCE.slice(0, 12).map((_, index) => maxFixtureProgress(index));
  const frames = [
    { at: 0, events: [] },
    ...progress.map((_, index) => ({ at: (index + 1) * 100_000, events: progress.slice(0, index + 1) })),
  ];
  await assert.rejects(waitForMaxFixturePreparation(
    'absolute-worker', maxPreparationManifest, scriptedPreparationRuntime(frames),
  ), /absolute/i);
});

test('maximum fixture preparation rejects malformed sequence and container exit', async () => {
  const malformed = { ...maxFixtureProgress(0), sha256: 'not-a-digest' };
  await assert.rejects(waitForMaxFixturePreparation(
    'malformed-worker',
    maxPreparationManifest,
    scriptedPreparationRuntime([{ at: 0, events: [] }, { at: 1, events: [malformed] }]),
  ), /malformed.*sha256/i);

  await assert.rejects(waitForMaxFixturePreparation(
    'stopped-worker',
    maxPreparationManifest,
    scriptedPreparationRuntime([{ at: 0, events: [], running: 'false' }]),
  ), /stopped.*replay_ready/i);

  await assert.rejects(waitForMaxFixturePreparation(
    'unknown-worker',
    maxPreparationManifest,
    scriptedPreparationRuntime([{
      at: 0, events: [{ ...maxFixtureProgress(0), label: 'unknown-fixture' }],
    }]),
  ), /sequence/i);
});

test('maximum fixture preparation rejects duplicate, cumulative, truncated, and premature traces', async () => {
  const first = maxFixtureProgress(0);
  for (const [events, message] of [
    [[first, first], /sequence/],
    [[{ ...first, stagedMaxFixtureBytes: first.stagedMaxFixtureBytes + 1 }], /cumulative/],
    [[first, { event: 'replay_ready', stagedMaxFixtureBytes: first.stagedMaxFixtureBytes }],
      /expected max_fixture_sealed before replay_ready/],
  ]) {
    await assert.rejects(waitForMaxFixturePreparation(
      'invalid-worker',
      maxPreparationManifest,
      scriptedPreparationRuntime([{ at: 0, events }, { at: 1, events }]),
    ), message);
  }

  await assert.rejects(waitForMaxFixturePreparation(
    'truncated-worker',
    maxPreparationManifest,
    scriptedPreparationRuntime([
      { at: 0, events: [first] },
      { at: 1, events: [] },
    ]),
  ), /history shrank/);

  const complete = MAX_FIXTURE_SEQUENCE.map((_, index) => maxFixtureProgress(index));
  const combined = MAX_COMBINED_FIXTURE_PROGRESS_SEQUENCE.map(
    (_, index) => maxCombinedFixtureProgress(index),
  );
  await assert.rejects(waitForMaxFixturePreparation(
    'post-final-idle-worker',
    maxPreparationManifest,
    scriptedPreparationRuntime([
      { at: 0, events: [...complete.slice(0, -1), ...combined, complete.at(-1)] },
      { at: 120_000, events: [...complete.slice(0, -1), ...combined, complete.at(-1)] },
    ]),
  ), /idle.*combined.*18\/18/i);

  await assert.rejects(waitForMaxFixturePreparation(
    'staging-budget-worker',
    { ...maxPreparationManifest, limits: { ...maxPreparationManifest.limits, maxFixtureStageBytes: 50 } },
    scriptedPreparationRuntime([{ at: 0, events: [first] }]),
  ), /staging budget/i);
});

test('maximum product observation receives a fresh clock only after preparation and start', () => {
  assert.match(replayControllerSource,
    /await waitForMaxFixturePreparation\(names\.worker, manifest\)[\s\S]*signal', 'USR2'[\s\S]*const deadline = Date\.now\(\) \+ timeout/);
});

test('resource sampling accepts subject exit races but fails closed while running', () => {
  assert.equal(classifyContainerRunningState('true'), true);
  assert.equal(classifyContainerRunningState('false'), false);
  assert.throws(() => classifyContainerRunningState(''), /running state/);
  assert.throws(() => classifyContainerRunningState('unknown'), /running state/);
  assert.deepEqual(classifyResourceSample(128, 192, 256, 'true'), {
    subjectStopped: false,
    sampled: 128,
    current: 192,
    kernel: 256,
  });
  assert.deepEqual(classifyResourceSample(undefined, 192, 256, 'false'), { subjectStopped: true });
  assert.deepEqual(classifyResourceSample(128, undefined, 256, 'false'), { subjectStopped: true });
  assert.deepEqual(classifyResourceSample(128, 192, undefined, 'false'), { subjectStopped: true });
  assert.throws(() => classifyResourceSample(undefined, 192, 256, 'true'), /memory evidence/);
  assert.throws(() => classifyResourceSample(128, undefined, 256, 'true'), /memory evidence/);
  assert.throws(() => classifyResourceSample(128, 192, undefined, 'true'), /memory evidence/);
  assert.throws(() => classifyResourceSample(undefined, undefined, undefined, ''), /running state/);
});

test('resource sampling retries one transient miss and returns only a complete sample', async () => {
  const samples = [
    { sampled: 128, current: undefined, kernel: 256 },
    { sampled: 144, current: 208, kernel: 272 },
  ];
  let runningReads = 0;
  let waits = 0;

  assert.deepEqual(await collectResourceSample({
    sample: () => samples.shift(),
    running: () => { runningReads += 1; return 'true'; },
    wait: async () => { waits += 1; },
  }), {
    subjectStopped: false,
    sampled: 144,
    current: 208,
    kernel: 272,
  });
  assert.equal(runningReads, 1);
  assert.equal(waits, 1);
});

test('resource sampling fails closed after bounded persistent loss', async () => {
  let sampleReads = 0;
  let waits = 0;
  await assert.rejects(collectResourceSample({
    sample: () => { sampleReads += 1; return { sampled: 128, current: undefined, kernel: 256 }; },
    running: () => 'true',
    wait: async () => { waits += 1; },
  }), /memory evidence/);
  assert.equal(sampleReads, 3);
  assert.equal(waits, 2);
});

test('resource sampling reports a subject that stops during retry and rejects unknown state', async () => {
  let runningReads = 0;
  assert.deepEqual(await collectResourceSample({
    sample: () => ({ sampled: undefined, current: undefined, kernel: undefined }),
    running: () => { runningReads += 1; return runningReads === 1 ? 'true' : 'false'; },
    wait: async () => {},
  }), { subjectStopped: true });

  await assert.rejects(collectResourceSample({
    sample: () => ({ sampled: undefined, current: undefined, kernel: undefined }),
    running: () => '',
    wait: async () => assert.fail('unknown running state must not retry'),
  }), /running state/);
});

test('memory growth pairs Docker and cgroup counters without mixing baselines', () => {
  assert.deepEqual(calculateMemoryEvidence({
    baselineBytes: 100,
    baselineCurrentBytes: 200,
    sampledPeakBytes: 600,
    kernelPeakBytes: 700,
  }), {
    peakBytes: 700,
    sampledGrowthBytes: 500,
    kernelGrowthBytes: 500,
    growthBytes: 500,
  });
});

test('resource snapshots retain counter provenance at baseline and fixture-ready', () => {
  assert.deepEqual(createResourceSnapshot('fixture_ready', 100, 200, 300, 'now'), {
    at: 'now',
    stage: 'fixture_ready',
    sampledBytes: 100,
    currentBytes: 200,
    kernelPeakBytes: 300,
  });
});

test('container argv seals distinct resources, cgroups, and timeouts', () => {
  const names = ownedResourceNames('rc11', 'fixture');
  assert.equal(new Set(Object.values(names)).size, 3);
  const postgres = postgresRunArgs(names, 'secret', 'max');
  assert.deepEqual(postgres.slice(postgres.indexOf('--cpus'), postgres.indexOf('--cpus') + 6), [
    '--cpus', '2', '--memory', '1g', '--memory-swap', '1280m',
  ]);
  assert.ok(postgres.includes('statement_timeout=20000'));
  assert.ok(postgresRunArgs(names, 'secret', 'live').includes('statement_timeout=30000'));
  const subject = {
    role: 'rc11', mode: 'max', image: 'subject-image', manifestPath: '/tmp/manifest.json',
  };
  const worker = workerCreateArgs(subject, names, 'postgresql://database');
  assert.equal(worker[1], 'create');
  assert.deepEqual(worker.slice(worker.indexOf('--cpus'), worker.indexOf('--cpus') + 6), [
    '--cpus', '1', '--memory', '1g', '--memory-swap', '1280m',
  ]);
  assert.equal(worker.some(value => value.startsWith('type=bind,')), false);
  assert.equal(worker[worker.indexOf('--publish') + 1], '3002');
  assert.equal(worker.includes('0.0.0.0::3002'), false);
  assert.equal(worker.includes('127.0.0.1::3002'), false);
  assert.equal(worker.some(value => value.startsWith('NODE_OPTIONS=')), false);
  assert.equal(worker.at(-1), '/app/wallet-sync-persistence-driver.cjs');
  assert.ok(worker.includes('WALLET_SYNC_MUTATION_TIMEOUT_MS=45000'));
  assert.ok(worker.includes('SANCTUARY_REPLAY_DRIVER_HELPERS=/app/wallet-sync-persistence-driver-helpers.cjs'));
  assert.ok(worker.includes('SANCTUARY_REPLAY_FIXTURE=/app/wallet-sync-persistence-fixture.cjs'));
  assert.ok(worker.includes('SANCTUARY_REPLAY_MANIFEST=/app/manifest.json'));

  const copies = workerFileCopyArgs(subject, names);
  assert.equal(copies.length, 4);
  assert.ok(copies.every(args => args[0] === 'docker' && args[1] === 'cp'));
  assert.deepEqual(copies.map(args => args.at(-1)), [
    `${names.worker}:/app/wallet-sync-persistence-driver.cjs`,
    `${names.worker}:/app/wallet-sync-persistence-driver-helpers.cjs`,
    `${names.worker}:/app/wallet-sync-persistence-fixture.cjs`,
    `${names.worker}:/app/manifest.json`,
  ]);

  const operations = [];
  stageAndStartWorker(subject, names, 'postgresql://database', args => operations.push(args));
  assert.equal(operations[0][1], 'create');
  assert.deepEqual(operations.slice(1, -1), copies);
  assert.deepEqual(operations.at(-1), ['docker', 'start', names.worker]);
});

test('health probes use the daemon-reachable published host with a local fallback', () => {
  assert.equal(healthProbeUrl(49152, '/live', {}).href, 'http://127.0.0.1:49152/live');
  assert.equal(healthProbeUrl(49152, '/ready', {
    SANCTUARY_DOCKER_PUBLISHED_HOST: 'docker-in-docker',
  }).href, 'http://docker-in-docker:49152/ready');
  assert.equal(healthProbeUrl(49152, '/metrics/prometheus', {
    SANCTUARY_DOCKER_PUBLISHED_HOST: '::1',
  }).href, 'http://[::1]:49152/metrics/prometheus');
  assert.throws(() => healthProbeUrl(49152, '/live', {
    SANCTUARY_DOCKER_PUBLISHED_HOST: 'host/path',
  }), /published host/);
});

test('RC11 gate enforces exact resource, health, SQL, mutation, and cleanup boundaries', () => {
  const gateManifest = { limits: {
    sampledAndKernelPeakBytes: 768, growthBytes: 512, probeP99Ms: 250,
    maxCaseStatementMs: 20000, maxCaseMutationMs: 45000,
  } };
  const maxArchitecture = Array.from({ length: 12 }, (_, index) => ({
    event: 'architecture_receipt', pass: index + 1, fullProjectCount: index % 3 === 1 ? 0 : 1,
    maxFullCurrentCount: index % 3 === 1 ? 0 : 1, maxTxDetailsCacheSize: index % 3 === 1 ? 0 : 1,
    fullParentOrUtxoMaterializations: 0, compactToFullLocalReuseCount: index % 3 === 1 ? 0 : 1,
    remoteRefetchCount: 0, selectedCandidateRemoteRefetchCount: 0,
    fullProjectTxidDigest: `digest-${index}`, expectedFullProjectTxidDigest: `digest-${index}`,
    canonicalBytesHighWater: 100, sourceRawHexCharsHighWater: 200,
  }));
  const valid = {
    mode: 'max', exitCode: 0, oomKilled: false, restartCount: 0,
    events: [
      { event: 'replay_completed' }, ...maxArchitecture,
      ...maxArchitecture.map(receipt => evidenceReleaseReceipt(receipt.pass)),
    ],
    failedProbes: 0, maxProbeMs: 1000,
    p99ProbeMs: 250, sampleCount: 20, peakBytes: 768, growthBytes: 512,
    sqlDurationSamples: 1, maxSqlStatementMs: 20000, maxMutationMs: 45000,
    cleanupRssBytes: 1, cleanupThreads: 11, baselineThreads: 11,
  };
  assert.doesNotThrow(() => assertRc11(valid, gateManifest));
  for (const [field, value, message] of [
    ['peakBytes', 769, /memory/], ['growthBytes', 513, /memory/],
    ['p99ProbeMs', 251, /health/], ['sampleCount', 19, /health/],
    ['sqlDurationSamples', 0, /SQL duration evidence/], ['maxSqlStatementMs', 20001, /SQL\/mutation/],
    ['maxMutationMs', 45001, /SQL\/mutation/], ['cleanupThreads', 12, /cleanup\/thread/],
  ]) assert.throws(() => assertRc11({ ...valid, [field]: value }, gateManifest), message);
});

test('maximum-shape architecture gate rejects refetch and missing receipts', () => {
  const receipt = index => ({
    event: 'architecture_receipt', pass: index, fullProjectCount: 1, maxFullCurrentCount: 1,
    maxTxDetailsCacheSize: 1, fullParentOrUtxoMaterializations: 0, compactToFullLocalReuseCount: 1,
    remoteRefetchCount: 0, selectedCandidateRemoteRefetchCount: 0,
    fullProjectTxidDigest: 'digest', expectedFullProjectTxidDigest: 'digest',
    canonicalBytesHighWater: 100, sourceRawHexCharsHighWater: 200,
  });
  const valid = Array.from({ length: 12 }, (_, index) => receipt(index));
  const releases = valid.map(item => evidenceReleaseReceipt(item.pass));
  assert.equal(validateMaxArchitectureReceipts([...valid, ...releases]).length, 12);
  assert.throws(() => validateMaxArchitectureReceipts([...valid.slice(1), ...releases]), /incomplete/);
  assert.throws(() => validateMaxArchitectureReceipts([...valid.map((item, index) => (
    index === 0 ? { ...item, remoteRefetchCount: 1 } : item
  )), ...releases]), /failed/);
});

test('trace validation requires ordered production phases and one parent per RC11 mutation', () => {
  const phases = ['fetchHistories', 'checkExisting', 'processTransactions', 'fetchUtxos', 'reconcileUtxos', 'insertUtxos']
    .map(stage => ({ event: 'phase_completed', stage }));
  assert.deepEqual(validatePhaseAndMutationTrace([
    ...phases,
    { event: 'mutation_completed', unit: 'transaction_batch', parentIds: ['tx-1'] },
  ], 'rc11').phases, phases.map(event => event.stage));
  assert.throws(() => validatePhaseAndMutationTrace([
    ...phases,
    { event: 'mutation_completed', unit: 'transaction_batch', parentIds: ['tx-1', 'tx-2'] },
  ], 'rc11'), /single-parent/);
  assert.throws(() => validatePhaseAndMutationTrace(phases.slice(1), 'rc11'), /phase trace/);
});

test('live receipts preserve wallet lifecycle and no-op transaction evidence', () => {
  const receipts = [
    { event: 'pre_start_receipt', walletLifecycleDigest: 'lifecycle-a' },
    { event: 'receipt_validation_started', pass: 1 },
    { event: 'pass_completed', pass: 1, walletLifecycleDigest: 'lifecycle-a', transactionEvidenceDigest: 'tx-1', utxoCount: 47, draftCount: 0, utxoDigest: 'utxo', draftDigest: 'draft' },
    { event: 'receipt_validation_completed', pass: 1, outcome: 'success' },
    { event: 'receipt_validation_started', pass: 2 },
    { event: 'pass_completed', pass: 2, walletLifecycleDigest: 'lifecycle-a', transactionEvidenceDigest: 'tx-2', utxoCount: 47, draftCount: 0, utxoDigest: 'utxo', draftDigest: 'draft' },
    { event: 'receipt_validation_completed', pass: 2, outcome: 'success' },
    { event: 'receipt_validation_started', pass: 3 },
    { event: 'pass_completed', pass: 3, walletLifecycleDigest: 'lifecycle-a', transactionEvidenceDigest: 'tx-2', utxoCount: 47, draftCount: 0, utxoDigest: 'utxo', draftDigest: 'draft' },
    { event: 'receipt_validation_completed', pass: 3, outcome: 'success' },
    ...[1, 2, 3].map(pass => ({
      event: 'utxo_evidence_receipt', pass, acceptedCount: 47, acceptedOutpointDigest: 'outpoints',
      rejectedListingCount: 5, omissionSentinelCount: 1, unauthenticatedFallbackCount: 0,
    })),
  ];
  assert.deepEqual(validateLiveReceiptInvariants(receipts, { finalReceipt: { utxos: 47 } }), {
    lifecycleDigest: 'lifecycle-a', transactionEvidenceDigest: 'tx-2', utxoDigest: 'utxo', draftDigest: 'draft',
  });
  assert.throws(() => validateLiveReceiptInvariants(receipts.map(receipt => (
    receipt.event === 'pass_completed' && receipt.pass === 1
      ? { ...receipt, walletLifecycleDigest: 'lifecycle-b' } : receipt
  )), { finalReceipt: { utxos: 47 } }), /lifecycle/);
  assert.throws(() => validateLiveReceiptInvariants(receipts.map(receipt => (
    receipt.event === 'pass_completed' && receipt.pass === 3
      ? { ...receipt, transactionEvidenceDigest: 'tx-3' } : receipt
  )), { finalReceipt: { utxos: 47 } }), /transaction evidence/);
});

test('receipt validation trace requires balanced successful markers for every pass', () => {
  const balanced = [1, 2, 3].flatMap(pass => [
    { event: 'receipt_validation_started', pass },
    { event: 'receipt_validation_completed', pass, outcome: 'success' },
  ]);
  assert.deepEqual(validateReceiptValidationTrace(balanced), [1, 2, 3]);
  assert.throws(() => validateReceiptValidationTrace(balanced.slice(0, -1)), /balanced/);
  assert.throws(() => validateReceiptValidationTrace(balanced.map((event, index) => (
    index === 1 ? { ...event, outcome: 'failure' } : event
  ))), /failed/);
  assert.match(replayDriverHelperSource, /receipt_validation_started[\s\S]*finally[\s\S]*receipt_validation_completed/);
});

test('receipt validation uses sealed scripts without reparsing raw transactions', () => {
  const forbiddenBitcoin = {
    Transaction: { fromHex: () => { throw new Error('runtime transaction parse forbidden'); } },
  };
  const { assertValidUtxoReceipt } = createDriverHelpers({
    bitcoin: forbiddenBitcoin,
    canonicalJson: JSON.stringify,
    classificationVersion: 1,
    emit: () => {},
    emitResourceCheckpoint: () => {},
    prisma: {},
    sha256: value => value,
  });
  const utxo = {
    tx_hash: 'txid', tx_pos: 0, value: 1, height: 800000, scriptPubKey: '0014abcd',
  };
  const fixture = {
    validUtxos: new Map([['bc1qfixture', [utxo]]]),
    negativeUtxoSentinels: [],
    seededValidUtxo: { txid: 'different' },
    rawTransactions: { get: () => { throw new Error('raw transaction access forbidden'); } },
  };
  const row = {
    id: 'utxo-1', txid: 'txid', vout: 0, address: 'bc1qfixture', amount: '1',
    scriptPubKey: utxo.scriptPubKey, spent: false, blockHeight: 800000, confirmations: 1,
  };
  assert.doesNotThrow(() => assertValidUtxoReceipt(fixture, { utxos: [row], drafts: [] }));
  assert.throws(() => assertValidUtxoReceipt(fixture, {
    utxos: [{ ...row, scriptPubKey: '0014abce' }], drafts: [],
  }), /Exact UTXO receipt mismatch/);
});

test('architecture receipts require fresh compact authentication and one-current full staging', () => {
  const receipts = [100, 69, 0].map((fullProjectCount, index) => ({
    event: 'architecture_receipt', pass: index + 1, compactProjectCount: 216,
    compactProjectTxidDigest: 'compact', canonicalBytesHighWater: 16 * 1024 * 1024,
    sourceRawHexCharsHighWater: 32 * 1024 * 1024, fullProjectCount,
    fullProjectTxidDigest: `full-${index}`, expectedFullProjectTxidDigest: `full-${index}`,
    maxFullCurrentCount: fullProjectCount > 0 ? 1 : 0, maxTxDetailsCacheSize: fullProjectCount > 0 ? 1 : 0,
    fullParentOrUtxoMaterializations: 0, compactToFullLocalReuseCount: fullProjectCount,
    remoteRefetchCount: 0, selectedCandidateRemoteRefetchCount: 0,
  }));
  const cleanup = [1, 2, 3].map(pass => ({
    event: 'resource_checkpoint', pass, stage: 'pass_context_released', currentBytes: 100,
  }));
  const releases = [1, 2, 3].map(evidenceReleaseReceipt);
  assert.equal(validateArchitectureReceipts([...receipts, ...cleanup, ...releases], { architecture: { fullCurrentCounts: [100, 69, 0] } }).length, 3);
  assert.throws(() => validateArchitectureReceipts([...receipts.map((receipt, index) => (
    index === 1 ? { ...receipt, maxTxDetailsCacheSize: 2 } : receipt
  )), ...cleanup, ...releases], {}), /Architecture receipt/);

  const transientMiddleGrowth = cleanup.map((receipt, index) => (
    index === 1 ? { ...receipt, currentBytes: 40 * 1024 * 1024 } : receipt
  ));
  assert.doesNotThrow(() => validateArchitectureReceipts(
    [...receipts, ...transientMiddleGrowth, ...releases],
    { architecture: { fullCurrentCounts: [100, 69, 0] } },
  ));

  const retainedAtLimit = cleanup.map((receipt, index) => (
    index === 2 ? { ...receipt, currentBytes: cleanup[0].currentBytes + 32 * 1024 * 1024 } : receipt
  ));
  assert.doesNotThrow(() => validateArchitectureReceipts(
    [...receipts, ...retainedAtLimit, ...releases],
    { architecture: { fullCurrentCounts: [100, 69, 0] } },
  ));

  const retainedOverLimit = retainedAtLimit.map((receipt, index) => (
    index === 2 ? { ...receipt, currentBytes: receipt.currentBytes + 1 } : receipt
  ));
  assert.throws(() => validateArchitectureReceipts(
    [...receipts, ...retainedOverLimit, ...releases],
    { architecture: { fullCurrentCounts: [100, 69, 0] } },
  ), /Final post-context cgroup growth exceeded 32 MiB/);
  assert.throws(() => validateArchitectureReceipts(
    [...receipts, ...cleanup.slice(0, 2), ...releases],
    { architecture: { fullCurrentCounts: [100, 69, 0] } },
  ), /Post-context cgroup receipt sequence is incomplete/);
});

test('production evidence release receipts require every evidence map to be empty', () => {
  const valid = [1, 2, 3].map(evidenceReleaseReceipt);
  assert.equal(validateProductionEvidenceReleaseReceipts(valid, [1, 2, 3]).length, 3);
  assert.throws(() => validateProductionEvidenceReleaseReceipts(valid.map((receipt, index) => (
    index === 1 ? { ...receipt, outpointCoverageSize: 1 } : receipt
  )), [1, 2, 3]), /non-empty/);
});

test('RC10 failure only qualifies after checkExisting and persistence are observed', () => {
  const base = { events: [], oomKilled: true, failedProbes: 0, peakBytes: 0 };
  assert.equal(qualifyRc10Failure(base, manifest).qualified, false);
  const reached = {
    ...base,
    events: [
      { event: 'phase_completed', stage: 'checkExisting' },
      { event: 'mutation_started', unit: 'transaction_batch' },
    ],
  };
  assert.deepEqual(qualifyRc10Failure(reached, manifest), { qualified: true, reason: 'oom' });
  assert.equal(qualifyRc10Failure({ ...reached, oomKilled: false }, manifest).qualified, false);
});

test('RC10 observation stops as soon as an authorized failure is fully evidenced', () => {
  const reached = [
    { event: 'phase_completed', stage: 'checkExisting' },
    { event: 'mutation_started', unit: 'transaction_batch' },
  ];

  assert.equal(shouldStopQualifiedRc10Observation(
    { role: 'rc10', mode: 'live' }, reached, 1, 0, manifest,
  ), true);
  assert.equal(shouldStopQualifiedRc10Observation(
    { role: 'rc10', mode: 'live' }, reached.slice(0, 1), 1, 0, manifest,
  ), false);
  assert.equal(shouldStopQualifiedRc10Observation(
    { role: 'rc11', mode: 'live' }, reached, 1, 0, manifest,
  ), false);
  assert.match(replayControllerSource,
    /shouldStopQualifiedRc10Observation\([\s\S]*docker', 'kill', names\.worker/);
});

test('JSONL parser ignores non-events and malformed output', () => {
  assert.deepEqual(parseJsonEvents('{"event":"ready","value":1}\nnot-json\n{"value":2}\n'), [
    { event: 'ready', value: 1 },
  ]);
});

test('sealed fixture deterministically matches its manifest union and counts', () => {
  const require = createRequire(new URL('../../server/package.json', import.meta.url));
  const bitcoin = require('bitcoinjs-lib');
  const fixtureRequire = createRequire(new URL('../../scripts/perf/wallet-sync-persistence-fixture.cjs', import.meta.url));
  const builder = fixtureRequire('./wallet-sync-persistence-fixture.cjs');
  const fixture = builder.buildFixture(bitcoin);
  const sealed = JSON.parse(readFileSync(new URL('../../scripts/perf/wallet-sync-persistence-manifest.json', import.meta.url), 'utf8'));
  assert.equal(fixture.definitionDigest, sealed.fixtureDefinitionSha256);
  assert.equal(fixture.firstPageDigest, sealed.firstPageUnionSha256);
  assert.deepEqual({
    transactions: fixture.firstPageUnion.txids.length,
    inputs: fixture.firstPageUnion.inputs,
    outputs: fixture.firstPageUnion.outputs,
  }, sealed.firstPage);
  assert.equal(fixture.transactions.length, sealed.finalReceipt.transactions);
  const driverSource = readFileSync(new URL('../../scripts/perf/wallet-sync-persistence-driver.cjs', import.meta.url));
  const driverHelperSource = readFileSync(new URL('../../scripts/perf/wallet-sync-persistence-driver-helpers.cjs', import.meta.url));
  assert.equal(createHash('sha256').update(driverSource).digest('hex'), sealed.driverSha256);
  assert.equal(createHash('sha256').update(driverHelperSource).digest('hex'), sealed.driverHelperSha256);
  assert.match(driverSource.toString(), /emit\('phase_failed'.*elapsedMs:/s);
  assert.match(driverSource.toString(), /emit\('phase_budget_exceeded'.*elapsedMs:.*limitMs:/s);
  assert.deepEqual(sealed.maxAxes.inputCounts, [24999, 25000, 25001]);
  assert.equal(sealed.maxAxes.inputLimit, 25000);
  assert.equal(sealed.maxAxes.outputLimit, 25000);
  assert.deepEqual(sealed.maxAxes.outputCounts, [24999, 25000, 25001]);
  assert.equal(sealed.maxAxes.inputAt.weight, 4000000);
  assert.deepEqual(sealed.maxAxes.combined, { inputs: 25000, outputs: 25000, weight: 7200056 });
  assert.equal(sealed.limits.maxFixtureStageBytes, 96 * 1024 * 1024);
  assert.equal(sealed.limits.liveOuterMs, 100 * 60_000);
  assert.equal(sealed.limits.addressHistoryMs, 5 * 60_000);
  assert.equal(sealed.limits.maxFixturePreparationIdleMs, 120_000);
  assert.equal(sealed.limits.maxFixturePreparationMs, 20 * 60_000);
  assert.deepEqual(sealed.maxFixtureSequence, MAX_FIXTURE_SEQUENCE);
  assert.deepEqual(
    sealed.maxCombinedFixtureProgressSequence,
    MAX_COMBINED_FIXTURE_PROGRESS_SEQUENCE,
  );
});

test('combined maximum fixture has one coherent transaction identity and shape', () => {
  const require = createRequire(new URL('../../server/package.json', import.meta.url));
  const bitcoin = require('bitcoinjs-lib');
  class TransactionWithoutBuilderReparse extends bitcoin.Transaction {
    static fromHex() {
      throw new Error('maximum fixture builder transaction reparse forbidden');
    }
  }
  const builderBitcoin = { ...bitcoin, Transaction: TransactionWithoutBuilderReparse };
  const progress = [];
  const fixture = buildCombinedMaxFixture(
    builderBitcoin,
    { inputs: 3, outputs: 4 },
    label => progress.push(label),
  );
  const details = fixture.transactions[0].details;
  const parsed = bitcoin.Transaction.fromHex(details.hex);
  const history = fixture.histories.get(fixture.addresses[0].address)[0];
  const utxo = fixture.utxos.get(fixture.addresses[0].address)[0];

  assert.equal(parsed.ins.length, 3);
  assert.equal(parsed.outs.length, 4);
  assert.equal(fixture.inputCount, 3);
  assert.equal(fixture.outputCount, 4);
  assert.equal(fixture.transactions[0].outputCount, 4);
  assert.equal(history.tx_hash, details.txid);
  assert.equal(utxo.tx_hash, details.txid);
  assert.equal(utxo.tx_pos, 3);
  assert.equal(fixture.rawTransactions.get(details.txid), details);
  assert.equal(fixture.weight, parsed.weight());
  assert.deepEqual(progress, MAX_COMBINED_FIXTURE_PROGRESS_SEQUENCE);
});

test('maximum fixture axes retain serialized weight without builder reparsing', () => {
  const require = createRequire(new URL('../../server/package.json', import.meta.url));
  const bitcoin = require('bitcoinjs-lib');
  class TransactionWithoutBuilderReparse extends bitcoin.Transaction {
    static fromHex() {
      throw new Error('maximum fixture builder transaction reparse forbidden');
    }
  }
  const builderBitcoin = { ...bitcoin, Transaction: TransactionWithoutBuilderReparse };
  const fixtures = [
    buildMaxFixture(builderBitcoin, 'output', 1, 0, 4, true),
    buildMaxFixture(builderBitcoin, 'input', 2, 0, 3, true),
    buildMaxFixture(builderBitcoin, 'input', 3, 0, 3, false),
  ];

  for (const fixture of fixtures) {
    const details = fixture.transactions[0].details;
    const parsed = bitcoin.Transaction.fromHex(details.hex);
    assert.equal(fixture.weight, parsed.weight());
    assert.equal(details.txid, parsed.getId());
  }
});

test('TERM during setup preserves failure receipts and exact owned cleanup', async () => {
  const names = ownedResourceNames('rc11', 'termination');
  const containers = new Set([names.worker, names.postgres]);
  const networks = new Set([names.network]);
  const removed = [];
  const cleanupFailures = cleanup(names, {
    inspect: name => containers.has(name) ? `id-${name}` : '',
    run: args => {
      if (args[1] === 'rm') {
        const name = args.at(-1);
        removed.push(name);
        containers.delete(name);
        return '';
      }
      if (args[1] === 'network' && args[2] === 'rm') {
        const name = args[3];
        removed.push(name);
        if (!networks.delete(name)) throw new Error('missing network');
        return '';
      }
      if (args[1] === 'network' && args[2] === 'inspect') {
        if (!networks.has(args[3])) throw new Error('missing network');
        return '';
      }
      throw new Error(`unexpected command: ${args.join(' ')}`);
    },
  });
  assert.deepEqual(cleanupFailures, []);
  assert.deepEqual(new Set(removed), new Set(Object.values(names)));
  assert.equal(containers.size, 0);
  assert.equal(networks.size, 0);
  assert.deepEqual(cleanup(names, {
    inspect: () => '',
    run: args => {
      if (args[1] === 'network' && args[2] === 'inspect') throw new Error('already absent');
      throw new Error(`unexpected cleanup of absent resource: ${args.join(' ')}`);
    },
  }), []);

  const evidenceDir = mkdtempSync(join(tmpdir(), 'sanctuary-replay-term-'));
  const controllerUrl = new URL('../../scripts/perf/wallet-sync-high-fanout-replay.mjs', import.meta.url).href;
  const childSource = `
    import { mkdirSync, writeFileSync } from 'node:fs';
    import { observe, writeReplayFailureSummary } from ${JSON.stringify(controllerUrl)};
    const evidenceDir = ${JSON.stringify(evidenceDir)};
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(evidenceDir + '/sealed-identity-receipt.json', '{}\\n');
    setTimeout(async () => {
      try {
        await observe(
          { role: 'rc11', mode: 'max', image: 'unused', manifestPath: '/unused' },
          { limits: {} },
          evidenceDir,
          { logs: () => '', inspect: () => '', cleanup: () => [] },
        );
        process.exitCode = 2;
      } catch (error) {
        writeReplayFailureSummary(evidenceDir, 'max', [], error);
        process.exitCode = error.message.includes('SIGTERM') ? 0 : 3;
      }
    }, 100);
    process.stdout.write('armed\\n');
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', childSource], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolvePromise, reject) => {
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.once('data', () => child.kill('SIGTERM'));
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(`termination child exited ${code}: ${stderr}`)));
  });
  const files = new Set(readdirSync(evidenceDir));
  assert.ok(files.has('rc11-max-observer.json'));
  assert.ok(files.has('rc11-max-cleanup.json'));
  assert.ok(files.has('replay-summary.json'));
  assert.equal(JSON.parse(readFileSync(join(evidenceDir, 'rc11-max-cleanup.json'))).verifiedAbsent, true);
  assert.match(JSON.parse(readFileSync(join(evidenceDir, 'replay-summary.json'))).error, /SIGTERM/);
  rmSync(evidenceDir, { recursive: true, force: true });
});
