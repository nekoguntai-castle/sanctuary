#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
const DRIVER_PATH = resolve(SCRIPT_DIR, 'wallet-sync-persistence-driver.cjs');
const DRIVER_HELPER_PATH = resolve(SCRIPT_DIR, 'wallet-sync-persistence-driver-helpers.cjs');
const FIXTURE_PATH = resolve(SCRIPT_DIR, 'wallet-sync-persistence-fixture.cjs');
const POSTGRES_IMAGE = 'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const RC10_REVISION = '5c1d1909f177b7bbd7c8f470da375b2de6bd0de3';
const PROBE_PATHS = ['/live', '/ready', '/metrics/prometheus'];
let activeOwnedNames;
let terminationSignal;

function throwIfTerminated() {
  if (terminationSignal) throw new Error(`Replay controller interrupted by ${terminationSignal}`);
}

export function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Expected --name value arguments; received ${flag ?? '<end>'}`);
    }
    values[flag.slice(2)] = value;
  }
  if (!['live', 'max'].includes(values.mode)) throw new Error('--mode must be live or max');
  for (const name of ['rc11-image', 'rc11-revision', 'fixture-manifest', 'evidence-dir']) {
    if (!values[name]) throw new Error(`Missing --${name}`);
  }
  if (values.mode === 'live') {
    for (const name of ['rc10-image', 'rc10-revision']) if (!values[name]) throw new Error(`Missing --${name}`);
    if (values['rc10-revision'] !== RC10_REVISION) throw new Error(`RC10 must use immutable ${RC10_REVISION}`);
  }
  return {
    mode: values.mode,
    rc10Image: values['rc10-image'], rc10Revision: values['rc10-revision'],
    rc11Image: values['rc11-image'], rc11Revision: values['rc11-revision'],
    manifestPath: resolve(values['fixture-manifest']), evidenceDir: resolve(values['evidence-dir']),
  };
}

export function parseMemory(value) {
  const match = String(value).trim().match(/^([0-9.]+)([KMGT]iB)$/);
  if (!match) return undefined;
  return Number(match[1]) * 1024 ** ({ KiB: 1, MiB: 2, GiB: 3, TiB: 4 }[match[2]]);
}

export function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

export function replayObservationTimeout(mode, manifest) {
  return mode === 'max' ? manifest.limits.maxOuterMs : manifest.limits.liveOuterMs;
}

export function classifyContainerRunningState(state) {
  if (state === 'true') return true;
  if (state === 'false') return false;
  throw new Error('Required container running state became unavailable');
}

export function classifyResourceSample(sampled, current, kernel, subjectRunningState) {
  if (sampled !== undefined && current !== undefined && kernel !== undefined) {
    return { subjectStopped: false, sampled, current, kernel };
  }
  if (!classifyContainerRunningState(subjectRunningState)) return { subjectStopped: true };
  throw new Error('Required memory evidence became unavailable');
}

export function calculateMemoryEvidence({
  baselineBytes,
  baselineCurrentBytes,
  sampledPeakBytes,
  kernelPeakBytes,
}) {
  const sampledGrowthBytes = Math.max(0, sampledPeakBytes - baselineBytes);
  const kernelGrowthBytes = Math.max(0, kernelPeakBytes - baselineCurrentBytes);
  return {
    peakBytes: Math.max(sampledPeakBytes, kernelPeakBytes),
    sampledGrowthBytes,
    kernelGrowthBytes,
    growthBytes: Math.max(sampledGrowthBytes, kernelGrowthBytes),
  };
}

export function createResourceSnapshot(stage, sampledBytes, currentBytes, kernelPeakBytes, at) {
  return {
    at: at ?? new Date().toISOString(),
    stage,
    sampledBytes,
    currentBytes,
    kernelPeakBytes,
  };
}

export function parseJsonEvents(logs) {
  return String(logs).split('\n').flatMap(line => {
    try {
      const parsed = JSON.parse(line);
      return typeof parsed?.event === 'string' ? [parsed] : [];
    } catch { return []; }
  });
}

export function validatePhaseAndMutationTrace(events, role) {
  const phases = events.filter(event => event.event === 'phase_completed').map(event => event.stage);
  const required = ['fetchHistories', 'checkExisting', 'processTransactions', 'fetchUtxos', 'reconcileUtxos', 'insertUtxos'];
  if (phases.slice(0, required.length).join('|') !== required.join('|')) {
    throw new Error(`Production phase trace mismatch: ${phases.slice(0, required.length).join(' -> ')}`);
  }
  const mutations = events.filter(event => event.event === 'mutation_completed' && event.unit === 'transaction_batch');
  if (mutations.length === 0) throw new Error('Trace never completed a production persistence mutation');
  if (role === 'rc11' && mutations.some(event => new Set(event.parentIds || []).size !== 1)) {
    throw new Error('RC11 trace contains a non-single-parent persistence mutation');
  }
  return { phases, persistenceMutations: mutations.length };
}

export function validateArchitectureReceipts(events, manifest) {
  const receipts = [1, 2, 3].map(pass => events.find(
    event => event.event === 'architecture_receipt' && event.pass === pass,
  ));
  if (receipts.some(receipt => !receipt)) throw new Error('Architecture receipt sequence is incomplete');
  const expectedFullCounts = manifest.architecture?.fullCurrentCounts ?? [100, 69, 0];
  receipts.forEach((receipt, index) => {
    if (receipt.fullProjectCount !== expectedFullCounts[index]
      || receipt.maxFullCurrentCount !== (expectedFullCounts[index] > 0 ? 1 : 0)
      || receipt.maxTxDetailsCacheSize > 1
      || receipt.fullParentOrUtxoMaterializations !== 0
      || receipt.compactToFullLocalReuseCount !== receipt.fullProjectCount
      || receipt.selectedCandidateRemoteRefetchCount !== 0
      || receipt.remoteRefetchCount !== 0
      || receipt.fullProjectTxidDigest !== receipt.expectedFullProjectTxidDigest) {
      throw new Error(`Architecture receipt failed for pass ${index + 1}`);
    }
    if (!(receipt.compactProjectCount > 0)
      || receipt.canonicalBytesHighWater > 32 * 1024 * 1024
      || receipt.sourceRawHexCharsHighWater > 64 * 1024 * 1024) {
      throw new Error(`Compact architecture bounds failed for pass ${index + 1}`);
    }
  });
  if (receipts.some(receipt => receipt.compactProjectTxidDigest !== receipts[0].compactProjectTxidDigest)) {
    throw new Error('Fresh-context compact authentication sets diverged');
  }
  const cleanup = [1, 2, 3].map(pass => events.find(event => event.event === 'resource_checkpoint'
    && event.pass === pass && event.stage === 'pass_context_released'));
  if (cleanup.some(receipt => !receipt)) throw new Error('Post-context cgroup receipt sequence is incomplete');
  if (cleanup.at(-1).currentBytes - cleanup[0].currentBytes > 32 * 1024 * 1024) {
    throw new Error('Final post-context cgroup growth exceeded 32 MiB');
  }
  validateProductionEvidenceReleaseReceipts(events, [1, 2, 3]);
  return receipts;
}

export function validateProductionEvidenceReleaseReceipts(events, passes) {
  const receipts = passes.map(pass => events.find(event => (
    event.event === 'production_evidence_release_receipt' && event.pass === pass
  )));
  const sizeFields = [
    'txDetailsCacheSize', 'compactEvidenceSize', 'outpointEvidenceSize',
    'outpointCoverageSize', 'spentOutpointSize',
  ];
  if (receipts.some(receipt => !receipt)
    || receipts.some(receipt => sizeFields.some(field => receipt[field] !== 0))) {
    throw new Error('Production evidence release receipts are incomplete or non-empty');
  }
  return receipts;
}

export function validateMaxArchitectureReceipts(events) {
  const receipts = events.filter(event => event.event === 'architecture_receipt');
  if (receipts.length < 12) throw new Error('Maximum-shape architecture receipts are incomplete');
  for (const receipt of receipts) {
    if (receipt.fullProjectCount > 1 || receipt.maxFullCurrentCount > 1
      || receipt.maxTxDetailsCacheSize > 1 || receipt.fullParentOrUtxoMaterializations !== 0
      || receipt.compactToFullLocalReuseCount !== receipt.fullProjectCount
      || receipt.remoteRefetchCount !== 0 || receipt.selectedCandidateRemoteRefetchCount !== 0
      || receipt.fullProjectTxidDigest !== receipt.expectedFullProjectTxidDigest
      || receipt.canonicalBytesHighWater > 32 * 1024 * 1024
      || receipt.sourceRawHexCharsHighWater > 64 * 1024 * 1024) {
      throw new Error(`Maximum-shape architecture receipt failed for pass ${receipt.pass}`);
    }
  }
  validateProductionEvidenceReleaseReceipts(events, receipts.map(receipt => receipt.pass));
  return receipts;
}

function collectLiveReplayReceipts(events) {
  const receipts = [
    events.find(event => event.event === 'pre_start_receipt'),
    ...[1, 2, 3].map(pass => events.find(event => event.event === 'pass_completed' && event.pass === pass)),
  ];
  if (receipts.some(receipt => !receipt)) throw new Error('Live replay receipt sequence is incomplete');
  return receipts;
}

function validateWalletLifecycleReceipts(receipts) {
  const lifecycleDigest = receipts[0].walletLifecycleDigest;
  if (!lifecycleDigest || receipts.some(receipt => receipt.walletLifecycleDigest !== lifecycleDigest)) {
    throw new Error('Live replay mutated wallet lifecycle state');
  }
  return lifecycleDigest;
}

function validateTransactionEvidenceReceipts(receipts) {
  if (!receipts[2].transactionEvidenceDigest
    || receipts[2].transactionEvidenceDigest !== receipts[3].transactionEvidenceDigest) {
    throw new Error('No-op replay mutated transaction evidence');
  }
  return receipts[3].transactionEvidenceDigest;
}

function validateUtxoAndDraftReceipts(receipts, manifest) {
  if (receipts[1].utxoCount !== manifest.finalReceipt.utxos || receipts[1].draftCount !== 0
    || receipts.slice(1).some(receipt => receipt.utxoDigest !== receipts[1].utxoDigest
      || receipt.draftDigest !== receipts[1].draftDigest)) {
    throw new Error('Live replay UTXO/draft receipts changed or are incomplete');
  }
}

function validateUtxoEvidenceReceipts(events, manifest) {
  const evidence = [1, 2, 3].map(pass => events.find(event => (
    event.event === 'utxo_evidence_receipt' && event.pass === pass
  )));
  if (evidence.some(receipt => !receipt)
    || evidence.some(receipt => receipt.acceptedCount !== (manifest.finalReceipt.validUtxos ?? 47)
      || receipt.rejectedListingCount !== (manifest.finalReceipt.rejectedUtxoListings ?? 5)
      || receipt.omissionSentinelCount !== 1 || receipt.unauthenticatedFallbackCount !== 0)
    || evidence.some(receipt => receipt.acceptedOutpointDigest !== evidence[0].acceptedOutpointDigest)) {
    throw new Error('UTXO evidence receipt sequence is incomplete or divergent');
  }
}

export function validateReceiptValidationTrace(events) {
  const markers = events.filter(event => (
    event.event === 'receipt_validation_started'
    || event.event === 'receipt_validation_completed'
  ));
  if (markers.length !== 6) throw new Error('Receipt validation markers are not balanced');
  for (const pass of [1, 2, 3]) {
    const started = markers.filter(event => (
      event.event === 'receipt_validation_started' && event.pass === pass
    ));
    const completed = markers.filter(event => (
      event.event === 'receipt_validation_completed' && event.pass === pass
    ));
    if (started.length !== 1 || completed.length !== 1
      || markers.indexOf(started[0]) > markers.indexOf(completed[0])) {
      throw new Error(`Receipt validation markers are not balanced for pass ${pass}`);
    }
    if (completed[0].outcome !== 'success') {
      throw new Error(`Receipt validation failed for pass ${pass}`);
    }
  }
  return [1, 2, 3];
}

export function validateLiveReceiptInvariants(events, manifest = { finalReceipt: { utxos: 53 } }) {
  const receipts = collectLiveReplayReceipts(events);
  const lifecycleDigest = validateWalletLifecycleReceipts(receipts);
  const transactionEvidenceDigest = validateTransactionEvidenceReceipts(receipts);
  validateUtxoAndDraftReceipts(receipts, manifest);
  validateUtxoEvidenceReceipts(events, manifest);
  validateReceiptValidationTrace(events);
  return {
    lifecycleDigest,
    transactionEvidenceDigest,
    utxoDigest: receipts[3].utxoDigest,
    draftDigest: receipts[3].draftDigest,
  };
}

export function qualifyRc10Failure(result, manifest) {
  const checkExisting = result.events.some(event => event.event === 'phase_completed' && event.stage === 'checkExisting');
  const persistence = result.events.some(event => event.event === 'mutation_started' && event.unit === 'transaction_batch');
  if (!checkExisting || !persistence) return { qualified: false, reason: 'failure preceded checkExisting/first persistence' };
  if (result.oomKilled) return { qualified: true, reason: 'oom' };
  if (result.failedProbes > 0) return { qualified: true, reason: 'external_probe' };
  if (result.peakBytes > manifest.limits.sampledAndKernelPeakBytes) return { qualified: true, reason: 'memory_threshold' };
  if (result.watchdogStage === 'processTransactions') return { qualified: true, reason: 'persistence_watchdog' };
  return { qualified: false, reason: 'no authorized persistence-stage failure' };
}

export function shouldStopQualifiedRc10Observation(subject, events, failedProbes, peakBytes, manifest) {
  if (subject.role !== 'rc10' || subject.mode !== 'live') return false;
  return qualifyRc10Failure({
    events,
    oomKilled: false,
    failedProbes,
    peakBytes,
  }, manifest).qualified;
}

const run = (args, options = {}) => execFileSync(args[0], args.slice(1), {
  encoding: 'utf8', stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'], ...options,
});
const sha256File = path => createHash('sha256').update(readFileSync(path)).digest('hex');

function migrationDigest(root) {
  const files = [];
  const walk = directory => readdirSync(directory).sort().forEach(name => {
    const path = join(directory, name);
    statSync(path).isDirectory() ? walk(path) : files.push(path);
  });
  walk(root);
  const hash = createHash('sha256');
  files.forEach(path => { hash.update(path.slice(root.length + 1)); hash.update('\0'); hash.update(readFileSync(path)); hash.update('\0'); });
  return hash.digest('hex');
}

function imageMigrationDigest(image) {
  const code = "const f=require('fs'),c=require('crypto'),p=require('path'),r='/app/prisma/migrations',a=[];const w=d=>f.readdirSync(d).sort().forEach(n=>{const x=p.join(d,n);f.statSync(x).isDirectory()?w(x):a.push(x)});w(r);const h=c.createHash('sha256');a.forEach(x=>{h.update(p.relative(r,x));h.update('\\0');h.update(f.readFileSync(x));h.update('\\0')});process.stdout.write(h.digest('hex'))";
  return run(['docker', 'run', '--rm', '--entrypoint', 'node', image, '-e', code]).trim();
}

function verifyImage(image, revision, lockSha) {
  const inspect = format => run(['docker', 'image', 'inspect', '--format', format, image]).trim();
  const actualRevision = inspect('{{index .Config.Labels "org.opencontainers.image.revision"}}');
  const actualLock = inspect('{{index .Config.Labels "dev.sanctuary.image-lock-sha256"}}');
  if (actualRevision !== revision || actualLock !== lockSha) throw new Error(`Image identity mismatch: ${image}`);
  return { image, revision, imageId: inspect('{{.Id}}'), repoDigests: inspect('{{json .RepoDigests}}'), imageLockSha256: actualLock };
}

function containerInspect(name, format) {
  try { return run(['docker', 'inspect', '--format', format, name]).trim(); } catch { return ''; }
}
function logs(name) {
  try { return run(['docker', 'logs', name]); } catch (error) { return `${error.stdout || ''}\n${error.stderr || ''}`; }
}
function memory(name) {
  try { return parseMemory(run(['docker', 'stats', '--no-stream', '--format', '{{.MemUsage}}', name]).split('/')[0]); } catch { return undefined; }
}
function cgroupMemory(name, counter) {
  try {
    const value = run(['docker', 'exec', name, 'cat', `/sys/fs/cgroup/${counter}`]).trim();
    return /^\d+$/.test(value) ? Number(value) : undefined;
  } catch { return undefined; }
}
const kernelCurrent = name => cgroupMemory(name, 'memory.current');
const kernelPeak = name => cgroupMemory(name, 'memory.peak');

async function waitEvent(name, event, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    throwIfTerminated();
    const found = parseJsonEvents(logs(name)).findLast(item => item.event === event);
    if (found) return found;
    if (!classifyContainerRunningState(containerInspect(name, '{{.State.Running}}'))) break;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error(`${name} did not emit ${event}`);
}

const defaultPreparationRuntime = {
  now: () => Date.now(),
  logs,
  running: name => containerInspect(name, '{{.State.Running}}'),
  sleep: ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms)),
};

function maxFixturePreparationContract(manifest) {
  const sequence = manifest.maxFixtureSequence;
  const combinedSequence = manifest.maxCombinedFixtureProgressSequence;
  const idleMs = manifest.limits.maxFixturePreparationIdleMs;
  const maximumMs = manifest.limits.maxFixturePreparationMs;
  if (!Array.isArray(sequence) || sequence.length !== 18
    || sequence.some(label => typeof label !== 'string' || label.length === 0)
    || new Set(sequence).size !== sequence.length) {
    throw new Error('Sealed maximum-fixture sequence is invalid');
  }
  if (!Array.isArray(combinedSequence) || combinedSequence.length !== 5
    || combinedSequence.some(label => typeof label !== 'string' || label.length === 0)
    || new Set(combinedSequence).size !== combinedSequence.length) {
    throw new Error('Sealed maximum combined-fixture progress sequence is invalid');
  }
  if (!Number.isSafeInteger(idleMs) || idleMs <= 0
    || !Number.isSafeInteger(maximumMs) || maximumMs <= idleMs) {
    throw new Error('Sealed maximum-fixture preparation limits are invalid');
  }
  return { combinedSequence, idleMs, maximumMs, sequence };
}

function validateMaxFixtureProgress(
  item, expectedLabel, expectedSequence, total, previousBytes, maximumStagedBytes,
) {
  for (const [field, value] of [['bytes', item.bytes], ['stagedMaxFixtureBytes', item.stagedMaxFixtureBytes]]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Malformed maximum-fixture progress ${field}`);
    }
  }
  if (item.label !== expectedLabel || item.sequence !== expectedSequence || item.total !== total) {
    throw new Error(`Malformed maximum-fixture progress sequence ${item.sequence ?? '<missing>'}/${total}`);
  }
  if (!/^[a-f0-9]{64}$/.test(item.sha256 ?? '')) {
    throw new Error('Malformed maximum-fixture progress sha256');
  }
  if (item.stagedMaxFixtureBytes !== previousBytes + item.bytes) {
    throw new Error('Malformed maximum-fixture progress cumulative bytes');
  }
  if (item.stagedMaxFixtureBytes > maximumStagedBytes) {
    throw new Error('Malformed maximum-fixture progress exceeded staging budget');
  }
}

function validateMaxCombinedFixtureProgress(item, expectedLabel, expectedSequence, total) {
  if (item.label !== expectedLabel || item.sequence !== expectedSequence || item.total !== total) {
    throw new Error(
      `Malformed maximum combined-fixture progress sequence ${item.sequence ?? '<missing>'}/${total}`,
    );
  }
}

function preparationTimeoutError(kind, name, progress, total, lastLabel) {
  return new Error(
    `Maximum-fixture preparation ${kind} for ${name}; last=${lastLabel ?? 'none'} progress=${progress}/${total}`,
  );
}

const MAX_PREPARATION_EVENTS = new Set([
  'max_fixture_sealed',
  'max_combined_fixture_progress',
  'replay_ready',
]);

function expectedMaxPreparationEvent(state, contract) {
  if (state.progressCount < contract.sequence.length - 1) return 'max_fixture_sealed';
  if (state.combinedProgressCount < contract.combinedSequence.length) {
    return 'max_combined_fixture_progress';
  }
  if (state.progressCount < contract.sequence.length) return 'max_fixture_sealed';
  return 'replay_ready';
}

function consumeMaxPreparationEvent(item, state, contract, maximumStagedBytes) {
  if (state.ready) throw new Error('Maximum-fixture protocol emitted an event after replay_ready');
  const expectedEvent = expectedMaxPreparationEvent(state, contract);
  if (item.event !== expectedEvent) {
    throw new Error(`Maximum-fixture protocol expected ${expectedEvent} before ${item.event}`);
  }
  if (item.event === 'max_fixture_sealed') {
    validateMaxFixtureProgress(
      item, contract.sequence[state.progressCount], state.progressCount + 1,
      contract.sequence.length, state.stagedBytes, maximumStagedBytes,
    );
    state.stagedBytes = item.stagedMaxFixtureBytes;
    state.progressCount += 1;
  } else if (item.event === 'max_combined_fixture_progress') {
    validateMaxCombinedFixtureProgress(
      item, contract.combinedSequence[state.combinedProgressCount],
      state.combinedProgressCount + 1, contract.combinedSequence.length,
    );
    state.combinedProgressCount += 1;
  } else if (item.stagedMaxFixtureBytes !== state.stagedBytes) {
    throw new Error('Maximum-fixture replay_ready staged-byte evidence drifted');
  } else {
    state.ready = item;
  }
  state.lastLabel = item.label ?? item.event;
}

function consumeMaxPreparationEvents(events, state, contract, maximumStagedBytes) {
  const protocolEvents = events.filter(item => MAX_PREPARATION_EVENTS.has(item.event));
  if (protocolEvents.length < state.eventCount) {
    throw new Error('Maximum-fixture protocol log history shrank');
  }
  const previousEventCount = state.eventCount;
  for (const item of protocolEvents.slice(state.eventCount)) {
    consumeMaxPreparationEvent(item, state, contract, maximumStagedBytes);
    state.eventCount += 1;
  }
  return state.eventCount > previousEventCount;
}

export async function waitForMaxFixturePreparation(
  name,
  manifest,
  runtime = defaultPreparationRuntime,
) {
  const { combinedSequence, idleMs, maximumMs, sequence } = maxFixturePreparationContract(manifest);
  const maximumStagedBytes = manifest.limits.maxFixtureStageBytes;
  if (!Number.isSafeInteger(maximumStagedBytes) || maximumStagedBytes <= 0) {
    throw new Error('Sealed maximum-fixture staging budget is invalid');
  }
  const startedAt = runtime.now();
  let lastProgressAt = startedAt;
  const state = {
    combinedProgressCount: 0,
    eventCount: 0,
    lastLabel: undefined,
    progressCount: 0,
    ready: undefined,
    stagedBytes: 0,
  };
  for (;;) {
    throwIfTerminated();
    const now = runtime.now();
    if (now - startedAt >= maximumMs) {
      throw preparationTimeoutError(
        'absolute timeout', name, state.progressCount, sequence.length, state.lastLabel,
      );
    }
    if (now - lastProgressAt >= idleMs) {
      throw preparationTimeoutError(
        'idle timeout', name, state.progressCount, sequence.length, state.lastLabel,
      );
    }
    const events = parseJsonEvents(runtime.logs(name));
    const contract = { combinedSequence, sequence };
    if (consumeMaxPreparationEvents(events, state, contract, maximumStagedBytes)) {
      lastProgressAt = now;
    }
    if (state.ready) return state.ready;
    if (!classifyContainerRunningState(runtime.running(name))) {
      throw new Error(`${name} stopped before replay_ready`);
    }
    await runtime.sleep(100);
  }
}

async function hostPort(name) {
  for (let count = 0; count < 100; count++) {
    throwIfTerminated();
    const value = containerInspect(name, '{{(index (index .NetworkSettings.Ports "3002/tcp") 0).HostPort}}');
    if (/^\d+$/.test(value)) return Number(value);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  throw new Error('Replay health port was not published');
}

export function healthProbeUrl(port, path, environment = process.env) {
  const host = environment.SANCTUARY_DOCKER_PUBLISHED_HOST || '127.0.0.1';
  if (!/^[A-Za-z0-9._:[\]-]+$/.test(host)) throw new Error('Invalid Docker published host');
  const hostname = host.includes(':') ? `[${host.replace(/^\[|\]$/g, '')}]` : host;
  return new URL(`http://${hostname}:${port}${path}`);
}

async function probe(port, path) {
  const started = performance.now();
  try {
    const response = await fetch(healthProbeUrl(port, path), { signal: AbortSignal.timeout(1000) });
    await response.arrayBuffer();
    return { path, ok: response.status === 200, elapsedMs: performance.now() - started };
  } catch { return { path, ok: false, elapsedMs: performance.now() - started }; }
}

export function cleanup(names, operations = { inspect: containerInspect, run }) {
  const failures = [];
  [names.worker, names.postgres].forEach(name => {
    if (operations.inspect(name, '{{.Id}}')) try { operations.run(['docker', 'rm', '--force', name]); } catch { failures.push(name); }
  });
  let networkExists = true;
  try { operations.run(['docker', 'network', 'inspect', names.network]); } catch { networkExists = false; }
  if (networkExists) try { operations.run(['docker', 'network', 'rm', names.network]); } catch { failures.push(names.network); }
  if (operations.inspect(names.worker, '{{.Id}}') || operations.inspect(names.postgres, '{{.Id}}')) failures.push('container_verify');
  try { operations.run(['docker', 'network', 'inspect', names.network]); failures.push('network_verify'); } catch { /* absent */ }
  return failures;
}

export function ownedResourceNames(role, suffix) {
  return {
    worker: `sanctuary-replay-${role}-${suffix}`,
    postgres: `sanctuary-replay-pg-${role}-${suffix}`,
    network: `sanctuary-replay-net-${role}-${suffix}`,
  };
}

export function postgresRunArgs(names, password, mode) {
  const statementTimeoutMs = mode === 'max' ? 20000 : 30000;
  return ['docker', 'run', '--detach', '--name', names.postgres, '--network', names.network, '--network-alias', 'postgres',
    '--cpus', '2', '--memory', '1g', '--memory-swap', '1280m', '--env', 'POSTGRES_USER=sanctuary',
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=sanctuary_replay', POSTGRES_IMAGE,
    '-c', `statement_timeout=${statementTimeoutMs}`, '-c', 'log_min_duration_statement=0'];
}

export function workerCreateArgs(subject, names, databaseUrl) {
  return ['docker', 'create', '--name', names.worker, '--network', names.network, '--cpus', '1', '--memory', '1g',
    '--memory-swap', '1280m', '--publish', '3002', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m',
    '--env', `DATABASE_URL=${databaseUrl}`,
    '--env', `WALLET_SYNC_MUTATION_TIMEOUT_MS=${subject.mode === 'max' ? 45000 : 60000}`,
    '--env', 'REDIS_URL=redis://127.0.0.1:1',
    '--env', 'JWT_SECRET=wallet-sync-replay-jwt-secret-32-characters',
    '--env', 'ENCRYPTION_KEY=wallet-sync-replay-encryption-key-32-chars', '--env', 'ENCRYPTION_SALT=replay-salt',
    '--env', 'WORKER_DIAGNOSTICS_SECRET=wallet-sync-replay-diagnostics-secret-32-bytes',
    '--env', 'GATEWAY_SECRET=wallet-sync-replay-gateway-secret-32-bytes',
    '--env', `SANCTUARY_REPLAY_ROLE=${subject.role}`, '--env', `SANCTUARY_REPLAY_MODE=${subject.mode}`,
    '--env', `SANCTUARY_REPLAY_DRIVER_HELPERS=/app/${basename(DRIVER_HELPER_PATH)}`,
    '--env', `SANCTUARY_REPLAY_FIXTURE=/app/${basename(FIXTURE_PATH)}`,
    '--env', `SANCTUARY_REPLAY_MANIFEST=/app/${basename(subject.manifestPath)}`,
    subject.image, 'node', '--expose-gc', `/app/${basename(DRIVER_PATH)}`];
}

export function workerFileCopyArgs(subject, names) {
  return [DRIVER_PATH, DRIVER_HELPER_PATH, FIXTURE_PATH, subject.manifestPath].map(source => (
    ['docker', 'cp', source, `${names.worker}:/app/${basename(source)}`]
  ));
}

export function stageAndStartWorker(subject, names, databaseUrl, operation = run) {
  operation(workerCreateArgs(subject, names, databaseUrl));
  workerFileCopyArgs(subject, names).forEach(args => operation(args));
  operation(['docker', 'start', names.worker]);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    terminationSignal = signal;
  });
}

async function startDatabase(names, password, image, mode) {
  const statementTimeoutMs = mode === 'max' ? 20000 : 30000;
  run(['docker', 'network', 'create', names.network]);
  run(postgresRunArgs(names, password, mode));
  for (let count = 0; count < 300; count++) {
    throwIfTerminated();
    try { run(['docker', 'exec', names.postgres, 'pg_isready', '-U', 'sanctuary', '-d', 'sanctuary_replay']); break; }
    catch { if (count === 299) throw new Error('PostgreSQL readiness timeout'); await new Promise(r => setTimeout(r, 100)); }
  }
  const url = `postgresql://sanctuary:${password}@postgres:5432/sanctuary_replay?schema=public&connection_limit=30&pool_timeout=30&connect_timeout=10&statement_timeout=${statementTimeoutMs}`;
  run(['docker', 'run', '--rm', '--network', names.network, '--env', `DATABASE_URL=${url}`, image,
    'npx', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { stdio: 'inherit' });
  return url;
}

function startWorker(subject, names, databaseUrl) {
  stageAndStartWorker(subject, names, databaseUrl);
}

export async function observe(subject, manifest, evidenceDir, failureRuntime = {
  logs,
  inspect: containerInspect,
  cleanup,
}) {
  const suffix = `${process.pid}-${randomBytes(4).toString('hex')}`;
  const names = ownedResourceNames(subject.role, suffix);
  const samples = [];
  const resourceSamples = [];
  let baselineBytes = 0, baselineCurrentBytes = 0, fixtureReadyBytes = 0, fixtureReadyCurrentBytes = 0;
  let sampledPeakBytes = 0, currentPeakBytes = 0, kernelPeakBytes = 0;
  let baselineKernelPeakBytes = 0, fixtureReadyKernelPeakBytes = 0, watchdogStage;
  let postgresMeasurementOffset = 0;
  let observerEvidence;
  try {
    activeOwnedNames = names;
    throwIfTerminated();
    const url = await startDatabase(names, randomBytes(16).toString('hex'), subject.image, subject.mode);
    startWorker(subject, names, url);
    const port = await hostPort(names.worker);
    await waitEvent(names.worker, 'replay_idle', 60000);
    baselineBytes = memory(names.worker) || 0;
    baselineCurrentBytes = kernelCurrent(names.worker) || 0;
    baselineKernelPeakBytes = kernelPeak(names.worker) || 0;
    resourceSamples.push(createResourceSnapshot(
      'idle_baseline', baselineBytes, baselineCurrentBytes, baselineKernelPeakBytes,
    ));
    run(['docker', 'kill', '--signal', 'USR1', names.worker]);
    if (subject.mode === 'max') {
      await waitForMaxFixturePreparation(names.worker, manifest);
    } else {
      await waitEvent(names.worker, 'replay_ready', 600000);
    }
    fixtureReadyBytes = memory(names.worker) || 0;
    fixtureReadyCurrentBytes = kernelCurrent(names.worker) || 0;
    fixtureReadyKernelPeakBytes = kernelPeak(names.worker) || 0;
    resourceSamples.push(createResourceSnapshot(
      'fixture_ready', fixtureReadyBytes, fixtureReadyCurrentBytes, fixtureReadyKernelPeakBytes,
    ));
    if (!(baselineBytes > 0) || !(baselineCurrentBytes > 0)
      || !(baselineKernelPeakBytes > 0) || !(fixtureReadyBytes > 0)
      || !(fixtureReadyCurrentBytes > 0) || !(fixtureReadyKernelPeakBytes > 0)) {
      throw new Error('Required baseline memory evidence unavailable');
    }
    sampledPeakBytes = Math.max(baselineBytes, fixtureReadyBytes);
    currentPeakBytes = Math.max(baselineCurrentBytes, fixtureReadyCurrentBytes);
    kernelPeakBytes = Math.max(baselineKernelPeakBytes, fixtureReadyKernelPeakBytes);
    postgresMeasurementOffset = logs(names.postgres).length;
    run(['docker', 'kill', '--signal', 'USR2', names.worker]);
    const timeout = replayObservationTimeout(subject.mode, manifest);
    const deadline = Date.now() + timeout;
    let completionReleased = false;
    while (Date.now() < deadline) {
      if (!classifyContainerRunningState(
        containerInspect(names.worker, '{{.State.Running}}'),
      )) break;
      throwIfTerminated();
      const probeSample = await probe(port, PROBE_PATHS[samples.length % 3]);
      const sampled = memory(names.worker);
      const current = kernelCurrent(names.worker);
      const kernel = kernelPeak(names.worker);
      const resourceSample = classifyResourceSample(
        sampled,
        current,
        kernel,
        containerInspect(names.worker, '{{.State.Running}}'),
      );
      if (resourceSample.subjectStopped) break;
      samples.push(probeSample);
      resourceSamples.push({
        ...createResourceSnapshot(
          'active', resourceSample.sampled, resourceSample.current, resourceSample.kernel,
        ),
        probePath: probeSample.path,
        probeOk: probeSample.ok,
        probeElapsedMs: probeSample.elapsedMs,
      });
      sampledPeakBytes = Math.max(sampledPeakBytes, resourceSample.sampled);
      currentPeakBytes = Math.max(currentPeakBytes, resourceSample.current);
      kernelPeakBytes = Math.max(kernelPeakBytes, resourceSample.kernel);
      const observedEvents = parseJsonEvents(logs(names.worker));
      if (shouldStopQualifiedRc10Observation(
        subject,
        observedEvents,
        samples.filter(sample => !sample.ok).length,
        Math.max(sampledPeakBytes, kernelPeakBytes),
        manifest,
      )) {
        run(['docker', 'kill', names.worker]);
        break;
      }
      if (!completionReleased && observedEvents.some(event => event.event === 'replay_cleanup_completed')) {
        completionReleased = true;
        run(['docker', 'kill', '--signal', 'HUP', names.worker]);
        break;
      }
    }
    while (completionReleased && Date.now() < deadline) {
      if (!classifyContainerRunningState(
        containerInspect(names.worker, '{{.State.Running}}'),
      )) break;
      throwIfTerminated();
      await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
    }
    if (classifyContainerRunningState(
      containerInspect(names.worker, '{{.State.Running}}'),
    )) {
      watchdogStage = parseJsonEvents(logs(names.worker)).findLast(event => event.event === 'phase_started')?.stage;
      run(['docker', 'kill', names.worker]);
    }
    const output = logs(names.worker);
    const postgresLogs = logs(names.postgres);
    const measuredPostgresLogs = postgresLogs.slice(postgresMeasurementOffset);
    const sqlDurations = [...measuredPostgresLogs.matchAll(/duration:\s+([0-9.]+)\s+ms/g)].map(match => Number(match[1]));
    const workerEvents = parseJsonEvents(output);
    const mutationDurations = workerEvents
      .filter(event => ['mutation_completed', 'mutation_failed'].includes(event.event) && event.startedAt)
      .map(event => Date.parse(event.completedAt || event.failedAt) - Date.parse(event.startedAt));
    const cleanupEvent = workerEvents.findLast(event => event.event === 'replay_cleanup_completed');
    const memoryEvidence = calculateMemoryEvidence({
      baselineBytes, baselineCurrentBytes, sampledPeakBytes, kernelPeakBytes,
    });
    const result = {
      role: subject.role, mode: subject.mode, exitCode: Number(containerInspect(names.worker, '{{.State.ExitCode}}')),
      oomKilled: containerInspect(names.worker, '{{.State.OOMKilled}}') === 'true', restartCount: Number(containerInspect(names.worker, '{{.RestartCount}}')),
      baselineBytes, baselineCurrentBytes, fixtureReadyBytes, fixtureReadyCurrentBytes,
      sampledPeakBytes, currentPeakBytes, kernelPeakBytes, ...memoryEvidence,
      resourceSamples, failedProbes: samples.filter(sample => !sample.ok).length,
      p99ProbeMs: percentile(samples.map(sample => sample.elapsedMs), .99), maxProbeMs: Math.max(0, ...samples.map(sample => sample.elapsedMs)),
      sampleCount: samples.length, watchdogStage,
      maxSqlStatementMs: Math.max(0, ...sqlDurations),
      maxMutationMs: Math.max(0, ...mutationDurations),
      sqlDurationSamples: sqlDurations.length,
      cleanupRssBytes: cleanupEvent?.rssBytes,
      cleanupThreads: cleanupEvent?.threads,
      baselineThreads: cleanupEvent?.baselineThreads,
      events: workerEvents,
    };
    writeFileSync(join(evidenceDir, `${subject.role}-${subject.mode}.jsonl`), output);
    writeFileSync(join(evidenceDir, `${subject.role}-${subject.mode}-postgres.log`), postgresLogs);
    writeFileSync(join(evidenceDir, `${subject.role}-${subject.mode}-observer.json`), `${JSON.stringify({ ...result, events: undefined }, null, 2)}\n`);
    observerEvidence = result;
    return result;
  } catch (error) {
    const workerLogs = failureRuntime.logs(names.worker);
    const postgresLogs = failureRuntime.logs(names.postgres);
    const measuredPostgresLogs = postgresLogs.slice(postgresMeasurementOffset);
    const sqlDurations = [...measuredPostgresLogs.matchAll(/duration:\s+([0-9.]+)\s+ms/g)].map(match => Number(match[1]));
    const workerEvents = parseJsonEvents(workerLogs);
    const mutationDurations = workerEvents
      .filter(event => ['mutation_completed', 'mutation_failed'].includes(event.event) && event.startedAt)
      .map(event => Date.parse(event.completedAt || event.failedAt) - Date.parse(event.startedAt));
    const cleanupEvent = workerEvents.findLast(event => event.event === 'replay_cleanup_completed');
    const memoryEvidence = calculateMemoryEvidence({
      baselineBytes, baselineCurrentBytes, sampledPeakBytes, kernelPeakBytes,
    });
    const failureEvidence = {
      role: subject.role,
      mode: subject.mode,
      error: error instanceof Error ? error.message : String(error),
      exitCode: Number(failureRuntime.inspect(names.worker, '{{.State.ExitCode}}')),
      oomKilled: failureRuntime.inspect(names.worker, '{{.State.OOMKilled}}') === 'true',
      baselineBytes,
      baselineCurrentBytes,
      fixtureReadyBytes,
      fixtureReadyCurrentBytes,
      sampledPeakBytes,
      currentPeakBytes,
      kernelPeakBytes,
      ...memoryEvidence,
      resourceSamples,
      failedProbes: samples.filter(sample => !sample.ok).length,
      sampleCount: samples.length,
      p99ProbeMs: percentile(samples.map(sample => sample.elapsedMs), .99),
      maxSqlStatementMs: Math.max(0, ...sqlDurations),
      maxMutationMs: Math.max(0, ...mutationDurations),
      sqlDurationSamples: sqlDurations.length,
      watchdogStage,
      terminationSignal,
      cleanupRssBytes: cleanupEvent?.rssBytes,
      cleanupThreads: cleanupEvent?.threads,
      baselineThreads: cleanupEvent?.baselineThreads,
      events: workerEvents,
    };
    writeFileSync(join(evidenceDir, `${subject.role}-${subject.mode}.jsonl`), workerLogs);
    writeFileSync(join(evidenceDir, `${subject.role}-${subject.mode}-postgres.log`), postgresLogs);
    writeFileSync(join(evidenceDir, `${subject.role}-${subject.mode}-observer.json`), `${JSON.stringify(failureEvidence, null, 2)}\n`);
    observerEvidence = failureEvidence;
    if (error && typeof error === 'object') error.replayEvidence = failureEvidence;
    throw error;
  } finally {
    const cleanupFailures = failureRuntime.cleanup(names);
    activeOwnedNames = undefined;
    writeFileSync(join(evidenceDir, `${subject.role}-${subject.mode}-cleanup.json`), `${JSON.stringify({
      worker: names.worker,
      postgres: names.postgres,
      network: names.network,
      verifiedAbsent: cleanupFailures.length === 0,
      failures: cleanupFailures,
    }, null, 2)}\n`);
    if (cleanupFailures.length > 0 && process.exitCode === undefined) {
      const cleanupError = new Error(`Owned replay cleanup failed: ${cleanupFailures.join(',')}`);
      cleanupError.replayEvidence = observerEvidence;
      throw cleanupError;
    }
  }
}

function assertRc11Process(result) {
  const completed = result.events.some(event => event.event === 'replay_completed');
  if (result.exitCode !== 0 || result.oomKilled || result.restartCount !== 0 || !completed) {
    throw new Error('RC11 replay process failed');
  }
}

function assertRc11Health(result, manifest) {
  if (result.failedProbes || result.maxProbeMs > 1000
    || result.p99ProbeMs > manifest.limits.probeP99Ms || result.sampleCount < 20) {
    throw new Error('RC11 health gate failed');
  }
}

function assertRc11Memory(result, manifest) {
  if (result.peakBytes > manifest.limits.sampledAndKernelPeakBytes
    || result.growthBytes > manifest.limits.growthBytes) {
    throw new Error('RC11 memory gate failed');
  }
}

function assertRc11Cleanup(result) {
  if (!(result.cleanupRssBytes > 0) || result.cleanupThreads !== result.baselineThreads) {
    throw new Error('RC11 cleanup/thread gate failed');
  }
}

function assertRc11Durations(result, manifest) {
  if (result.sqlDurationSamples < 1) throw new Error('RC11 SQL duration evidence is empty');
  const maxSqlMs = result.mode === 'max' ? manifest.limits.maxCaseStatementMs : 30000;
  const maxMutationMs = result.mode === 'max' ? manifest.limits.maxCaseMutationMs : manifest.limits.transactionMutationMs;
  if (result.maxSqlStatementMs > maxSqlMs || result.maxMutationMs > maxMutationMs) {
    throw new Error('RC11 SQL/mutation duration gate failed');
  }
}

function validateRc11Receipts(result, manifest) {
  if (result.mode === 'live') {
    validatePhaseAndMutationTrace(result.events, 'rc11');
    validateLiveReceiptInvariants(result.events, manifest);
    validateArchitectureReceipts(result.events, manifest);
  } else validateMaxArchitectureReceipts(result.events);
}

export function assertRc11(result, manifest) {
  assertRc11Process(result);
  assertRc11Health(result, manifest);
  assertRc11Memory(result, manifest);
  assertRc11Durations(result, manifest);
  assertRc11Cleanup(result);
  validateRc11Receipts(result, manifest);
}

export function writeReplayFailureSummary(evidenceDir, mode, results, error) {
  const failedResult = error?.replayEvidence;
  const summarizedResults = failedResult ? [...results, failedResult] : results;
  const summary = {
    schemaVersion: 1,
    mode,
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
    identityReceiptSha256: sha256File(join(evidenceDir, 'sealed-identity-receipt.json')),
    results: summarizedResults.map(result => ({ ...result, events: undefined })),
  };
  writeFileSync(join(evidenceDir, 'replay-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function preflight() {
  const cpu = Number(run(['getconf', '_NPROCESSORS_ONLN']).trim());
  const memoryKiB = Number(run(['awk', '/MemTotal/ {print $2}', '/proc/meminfo']).trim());
  const disk = Number(run(['df', '--output=avail', '--block-size=1', REPO_ROOT]).trim().split('\n').at(-1));
  if (cpu < 2 || memoryKiB * 1024 < 4 * 1024 ** 3 || disk < 15 * 1024 ** 3) throw new Error('Replay host preflight failed');
  return { cpu, memoryBytes: memoryKiB * 1024, diskBytes: disk };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (existsSync(options.evidenceDir) && readdirSync(options.evidenceDir).length) throw new Error('Evidence directory must be empty');
  mkdirSync(options.evidenceDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(options.manifestPath, 'utf8'));
  const local = { driverSha256: sha256File(DRIVER_PATH), driverHelperSha256: sha256File(DRIVER_HELPER_PATH), fixtureBuilderSha256: sha256File(FIXTURE_PATH), manifestSha256: sha256File(options.manifestPath), migrationTreeSha256: migrationDigest(resolve(REPO_ROOT, 'server/prisma/migrations')) };
  if (local.driverSha256 !== manifest.driverSha256
    || local.driverHelperSha256 !== manifest.driverHelperSha256
    || local.fixtureBuilderSha256 !== manifest.fixtureBuilderSha256
    || local.migrationTreeSha256 !== manifest.migrationTreeSha256) throw new Error('Sealed manifest digest mismatch');
  const subjects = options.mode === 'live'
    ? [{ role: 'rc10', mode: 'live', image: options.rc10Image, revision: options.rc10Revision }, { role: 'rc11', mode: 'live', image: options.rc11Image, revision: options.rc11Revision }]
    : [{ role: 'rc11', mode: 'max', image: options.rc11Image, revision: options.rc11Revision }];
  const identities = subjects.map(subject => {
    const lockBytes = run(['git', 'show', `${subject.revision}:config/container-image-lock.json`]);
    const lockSha = createHash('sha256').update(lockBytes).digest('hex');
    return { ...verifyImage(subject.image, subject.revision, lockSha), migrationTreeSha256: imageMigrationDigest(subject.image) };
  });
  if (identities.some(identity => identity.migrationTreeSha256 !== manifest.migrationTreeSha256)) throw new Error('Image migration digest mismatch');
  const seal = { schemaVersion: 1, preflight: preflight(), local, identities };
  writeFileSync(join(options.evidenceDir, 'sealed-identity-receipt.json'), `${JSON.stringify(seal, null, 2)}\n`);
  const results = [];
  try {
    for (const subject of subjects) results.push(await observe({ ...subject, manifestPath: options.manifestPath }, manifest, options.evidenceDir));
    if (options.mode === 'live') {
      const qualification = qualifyRc10Failure(results[0], manifest);
      if (!qualification.qualified) throw new Error(qualification.reason);
      assertRc11(results[1], manifest);
    } else assertRc11(results[0], manifest);
  } catch (error) {
    writeReplayFailureSummary(options.evidenceDir, options.mode, results, error);
    throw error;
  }
  const summary = { schemaVersion: 1, mode: options.mode, identityReceiptSha256: sha256File(join(options.evidenceDir, 'sealed-identity-receipt.json')), results: results.map(result => ({ ...result, events: undefined })) };
  writeFileSync(join(options.evidenceDir, 'replay-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (import.meta.url === (process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '')) {
  main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
}
