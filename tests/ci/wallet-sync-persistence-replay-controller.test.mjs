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
  cleanup,
  ownedResourceNames,
  parseArgs,
  parseJsonEvents,
  parseMemory,
  percentile,
  postgresRunArgs,
  qualifyRc10Failure,
  replayObservationTimeout,
  validateLiveReceiptInvariants,
  validateArchitectureReceipts,
  validateMaxArchitectureReceipts,
  validateProductionEvidenceReleaseReceipts,
  validatePhaseAndMutationTrace,
  stageAndStartWorker,
  workerCreateArgs,
  workerFileCopyArgs,
} from '../../scripts/perf/wallet-sync-high-fanout-replay.mjs';

const replayDriverSource = readFileSync(
  new URL('../../scripts/perf/wallet-sync-persistence-driver.cjs', import.meta.url),
  'utf8',
);

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
    { event: 'pass_completed', pass: 1, walletLifecycleDigest: 'lifecycle-a', transactionEvidenceDigest: 'tx-1', utxoCount: 47, draftCount: 0, utxoDigest: 'utxo', draftDigest: 'draft' },
    { event: 'pass_completed', pass: 2, walletLifecycleDigest: 'lifecycle-a', transactionEvidenceDigest: 'tx-2', utxoCount: 47, draftCount: 0, utxoDigest: 'utxo', draftDigest: 'draft' },
    { event: 'pass_completed', pass: 3, walletLifecycleDigest: 'lifecycle-a', transactionEvidenceDigest: 'tx-2', utxoCount: 47, draftCount: 0, utxoDigest: 'utxo', draftDigest: 'draft' },
    ...[1, 2, 3].map(pass => ({
      event: 'utxo_evidence_receipt', pass, acceptedCount: 47, acceptedOutpointDigest: 'outpoints',
      rejectedListingCount: 5, omissionSentinelCount: 1, unauthenticatedFallbackCount: 0,
    })),
  ];
  assert.deepEqual(validateLiveReceiptInvariants(receipts, { finalReceipt: { utxos: 47 } }), {
    lifecycleDigest: 'lifecycle-a', transactionEvidenceDigest: 'tx-2', utxoDigest: 'utxo', draftDigest: 'draft',
  });
  assert.throws(() => validateLiveReceiptInvariants(receipts.map((receipt, index) => (
    index === 1 ? { ...receipt, walletLifecycleDigest: 'lifecycle-b' } : receipt
  )), { finalReceipt: { utxos: 47 } }), /lifecycle/);
  assert.throws(() => validateLiveReceiptInvariants(receipts.map((receipt, index) => (
    index === 3 ? { ...receipt, transactionEvidenceDigest: 'tx-3' } : receipt
  )), { finalReceipt: { utxos: 47 } }), /transaction evidence/);
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
