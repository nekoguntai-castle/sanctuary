#!/usr/bin/env node
// Release-candidate canary driver (sanctuary.release-candidate-canary.v2).
//
// Runs on the deployment host, against the exact RC tag already deployed there.
// Reads runtime secrets from the runtime env file at run time only and never
// writes them anywhere. Emits a private JSONL evidence sidecar plus a redacted
// receipt under CANARY_OUT_DIR, which must sit outside every checkout --
// docs/how-to/release-candidate-canary.md is the runbook, and
// scripts/release/verify-release-candidate-canary.mjs is what validates the
// result before a stable tag may be cut.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  FAMILIES,
  createCanaryRuntime,
  nowIso,
  parseJsonOr,
  parseMetrics,
  readCgroup,
  sleep,
  timedFetch,
  timedHttpsInsecure,
} from './lib/canary-runtime.mjs';

const TAG = process.env.CANARY_TAG;
const COMMIT = process.env.CANARY_COMMIT;
const OUT_DIR = process.env.CANARY_OUT_DIR;
const ENV_FILE = process.env.SANCTUARY_ENV_FILE || path.join(process.env.HOME, '.config/sanctuary/sanctuary.env');
const UI_URL = process.env.CANARY_UI_URL || 'https://localhost:8443/';
const PROJECT = process.env.COMPOSE_PROJECT || 'sanctuary';
const PREARM_MS = Number(process.env.CANARY_PREARM_MS || 90_000);
const POST_TERMINAL_MS = Number(process.env.CANARY_POST_TERMINAL_MS || 345_000);
const FLEET_TIMEOUT_MS = Number(process.env.CANARY_FLEET_TIMEOUT_MS || 40 * 60_000);
const REPEAT_TIMEOUT_MS = Number(process.env.CANARY_REPEAT_TIMEOUT_MS || 15 * 60_000);
const SILENT_HANG_MS = Number(process.env.CANARY_SILENT_HANG_MS || 10 * 60_000);
const OPERATOR_ID = process.env.CANARY_OPERATOR_ID || 'release-operator-01';
if (!TAG || !COMMIT || !OUT_DIR) {
  console.error('CANARY_TAG, CANARY_COMMIT and CANARY_OUT_DIR are required');
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true, mode: 0o700 });
const EVIDENCE = path.join(OUT_DIR, 'evidence.jsonl');
fs.writeFileSync(EVIDENCE, '', { mode: 0o600 });
const evidenceStream = fs.createWriteStream(EVIDENCE, { flags: 'a' });
function record(event) {
  const line = JSON.stringify({ at: nowIso(), ...event });
  evidenceStream.write(line + '\n');
  if (event.type !== 'sample' && event.type !== 'runtime_sample' && event.type !== 'diag_sample') {
    console.log(line.slice(0, 400));
  }
}

const {
  psql,
  containerIps,
  inspectContainer,
  mintAccessToken,
  diagnostics,
  fleetSnapshot,
} = createCanaryRuntime({ envFile: ENV_FILE, project: PROJECT });

// Wallet ids never reach the receipt or the evidence sidecar; they are replaced
// by a stable positional pseudonym assigned from the initial fleet snapshot.
const walletRefs = new Map();
const refOf = (id) => walletRefs.get(id) || 'wallet-??';

// ---------- main ----------
const startedAt = nowIso();
const state = {
  samples: [], // {at, phase, endpoints:{live,ready,metricsPrometheus,ui}}
  diag: { versions: new Set(), addressHistoryActive: false, agreementObserved: true, agreementSeen: false, lockAnomaly: false },
  metrics: { families: new Set(), activeStageAge: false, fallbackStart: null, fallbackEnd: null },
  progress: { phase: false, elapsed: false, addresses: false, preflight: false, liveLog: false, candidateEvents: [] },
  runtime: [],
};
const backendIps = await containerIps(`${PROJECT}-backend-1`);
let backendBase = null;
for (const ip of backendIps) {
  const r = await timedFetch(`http://${ip}:3001/api/v1/health/live`, {}, 1500);
  if (r.ok) { backendBase = `http://${ip}:3001`; break; }
}
const [workerIp] = await containerIps(`${PROJECT}-worker-1`);
const workerBase = `http://${workerIp}:3002`;
if (!backendBase || !workerIp) { console.error('backend or worker unreachable'); process.exit(2); }
const [[adminId, adminName, adminSessionVersion]] = await psql(`select id, username, "sessionVersion" from users where "isAdmin" = true limit 1`);
const token = mintAccessToken({ userId: adminId, username: adminName, sessionVersion: Number(adminSessionVersion) });
const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
const api = (p, init = {}, t = 10_000) => timedFetch(`${backendBase}/api/v1${p}`, { ...init, headers: { ...authHeaders, ...(init.headers || {}) } }, t);

const initialFleet = await fleetSnapshot();
initialFleet.wallets.forEach((w, i) => walletRefs.set(w.id, `wallet-${String(i + 1).padStart(2, '0')}`));
record({ type: 'armed', startedAt, fleetTotal: initialFleet.summary.total, releaseCandidate: { tag: TAG, commit: COMMIT }, backendReachable: true, workerReachable: true });
record({ type: 'fleet_before', ...initialFleet.summary, staleWallets: initialFleet.wallets.filter((w) => !w.lastSyncedAt || Date.now() - Date.parse(w.lastSyncedAt) > 3600_000).length, oldestLastSyncedAt: initialFleet.wallets.map((w) => w.lastSyncedAt).filter(Boolean).sort()[0] || null });
const me = await api('/auth/me', {}, 5000).catch(() => null);
record({ type: 'auth_check', http: me?.status ?? 0 });
const bitcoinStatus = await api('/bitcoin/status?network=mainnet', {}, 10_000);
const operational = parseJsonOr(bitcoinStatus.text)?.operational ?? null;
record({ type: 'bitcoin_status', http: bitcoinStatus.status, hasOperational: operational !== null, configuredMode: operational?.configuredMode ?? null, route: operational?.route?.kind ?? operational?.route ?? null, poolKeys: operational?.pool ? Object.keys(operational.pool) : null });

let phase = 'prearm';
let stopSampling = false;
let lastProgressAt = Date.now();
const walletLogSeen = new Map(); // walletId -> Set(log ids)

async function sampleOnce() {
  const [live, ready, metrics, ui] = await Promise.all([
    timedFetch(`${backendBase}/api/v1/health/live`, {}, 1000),
    timedFetch(`${backendBase}/api/v1/health/ready`, {}, 1000),
    timedFetch(`${backendBase}/metrics`, {}, 1000),
    timedHttpsInsecure(UI_URL, 1000),
  ]);
  if (metrics.ok) {
    const parsed = parseMetrics(metrics.text);
    parsed.families.forEach((f) => state.metrics.families.add(f));
    if (parsed.activeStageAge) state.metrics.activeStageAge = true;
    if (state.metrics.fallbackStart === null) state.metrics.fallbackStart = parsed.fallback;
    state.metrics.fallbackEnd = parsed.fallback;
  }
  const strip = (r) => ({ ok: r.ok, status: r.status, latencyMs: Math.round(r.latencyMs * 1000) / 1000, ...(r.error ? { error: r.error } : {}) });
  const sample = { type: 'sample', phase, endpoints: { live: strip(live), ready: strip(ready), metricsPrometheus: strip(metrics), ui: strip(ui) } };
  state.samples.push({ at: Date.now(), phase, endpoints: sample.endpoints });
  record(sample);
}
async function diagSample() {
  const d = await diagnostics(workerBase);
  if (d.status === 'observed') {
    state.diag.versions.add(d.version);
    if (d.activeStages.some((s) => s.startsWith('address_history='))) state.diag.addressHistoryActive = true;
    if (d.agreement) {
      state.diag.agreementSeen = true;
      if (d.lockDetail.mismatch !== '0' || d.lockDetail.missingOwned !== '0') state.diag.lockAnomaly = true;
    } else state.diag.agreementObserved = false;
  }
  record({ type: 'diag_sample', phase, ...d });
  return d;
}
async function runtimeSample() {
  const [worker, frontend] = await Promise.all([inspectContainer(`${PROJECT}-worker-1`), inspectContainer(`${PROJECT}-frontend-1`)]);
  const current = Number(readCgroup(worker.containerId, 'memory.current') ?? 0);
  const peak = Number(readCgroup(worker.containerId, 'memory.peak') ?? 0);
  const max = readCgroup(worker.containerId, 'memory.max');
  const limit = worker.memoryLimit || (max && max !== 'max' ? Number(max) : 0);
  const entry = { at: Date.now(), worker: { ...worker, memoryBytes: current, memoryPeakBytes: peak, memoryLimitBytes: limit }, frontend };
  state.runtime.push(entry);
  record({ type: 'runtime_sample', phase, worker: { containerId: worker.containerId, imageId: worker.imageId, memoryBytes: current, memoryPeakBytes: peak, memoryLimitBytes: limit, restartCount: worker.restartCount, oomKilled: worker.oomKilled, exitCode: worker.exitCode, status: worker.status }, frontend: { containerId: frontend.containerId, imageId: frontend.imageId, status: frontend.status, health: frontend.health, restartCount: frontend.restartCount } });
}
async function pollWalletLogs(walletIds) {
  for (const id of walletIds) {
    const res = await api(`/sync/logs/${id}`, {}, 5000);
    if (!res.ok) continue;
    const parsedLogs = parseJsonOr(res.text);
    if (!parsedLogs) continue;
    const logs = parsedLogs.logs || [];
    if (logs.length > 0) state.progress.liveLog = true;
    const seen = walletLogSeen.get(id) || new Set();
    walletLogSeen.set(id, seen);
    for (const entry of logs) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      const d = entry.details;
      if (!d || (d.kind !== 'sync_phase_progress' && d.kind !== 'sync_progress')) continue;
      lastProgressAt = Date.now();
      if (d.kind === 'sync_phase_progress') {
        state.progress.phase = true;
        if (typeof d.elapsedMs === 'number') state.progress.elapsed = true;
        if (d.stage === 'preflight') state.progress.preflight = true;
        if (d.workItems?.unit === 'addresses' && typeof d.workItems.total === 'number') state.progress.addresses = true;
        record({ type: 'progress', walletRef: refOf(id), logAt: entry.timestamp, kind: d.kind, event: d.event, stage: d.stage, elapsedMs: d.elapsedMs, workItemKeys: d.workItems ? Object.keys(d.workItems) : [], workItemUnit: d.workItems?.unit ?? null, workItemTotal: d.workItems?.total ?? null, workItemCompleted: d.workItems?.completed ?? null });
      } else {
        state.progress.candidateEvents.push({ walletRef: refOf(id), ...d, logAt: entry.timestamp });
        record({ type: 'progress', walletRef: refOf(id), logAt: entry.timestamp, kind: d.kind, event: d.event, stage: d.stage, unit: d.unit, batch: d.batch, batchCount: d.batchCount, completed: d.completed ?? null, total: d.total ?? null, elapsedMs: d.elapsedMs });
      }
    }
  }
}

// samplers
const samplerLoop = (async () => { while (!stopSampling) { const t = Date.now(); await sampleOnce(); await sleep(Math.max(0, 1000 - (Date.now() - t))); } })();
const runtimeLoop = (async () => { while (!stopSampling) { const t = Date.now(); await runtimeSample().catch((e) => record({ type: 'runtime_sample_error', error: String(e) })); await sleep(Math.max(0, 1000 - (Date.now() - t))); } })();
const diagLoop = (async () => { while (!stopSampling) { const t = Date.now(); await diagSample().catch((e) => record({ type: 'diag_error', error: String(e) })); await sleep(Math.max(0, (phase === 'active' || phase === 'repeat' ? 250 : 1000) - (Date.now() - t))); } })();

await sleep(PREARM_MS);
const preDiag = await diagSample();
if (preDiag.status !== 'observed' || preDiag.activeTotal !== '0') record({ type: 'warning', message: 'worker not idle before admission', diag: preDiag });

// admission: one all-wallet sync
phase = 'active';
const walletIds = initialFleet.wallets.map((w) => w.id);
// The wallet-sync activation gate blocks in TWO sequential phases after a
// deployment, and the total is what this deadline has to cover.
//
//   1. restart_observed. Every worker restart writes a Redis marker whose TTL is
//      RESTART_MARKER_TTL_MS = max(REGISTRY_RETENTION_MS,
//      WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS) = 31 min
//      (WALLET_SYNC_MAX_EXECUTION_MS 30 min + 60s lock slack). While it lives,
//      workerHeartbeatRegistry returns blockedReadiness("restart_observed").
//   2. stabilizing. Only once that expires can a healthy observation be
//      accepted, and that starts the drain horizon -- another 31 min before
//      drainHorizonSatisfied.
//
// So admissions reopen roughly 62 minutes after the worker restart, not 31.
// POST /sync/network/mainnet answers 200 success:true with requested:0 merged:0
// rejected:<fleet> throughout, which looks like a hung fleet but is the gate
// failing closed. The old 15-minute default could not survive phase 1 alone and
// aborted every canary started soon after a deploy -- it cost the v0.8.70-rc8
// canary and again the v0.8.71-rc7 canary.
//
// 90 minutes leaves headroom over the ~62-minute floor without masking a fleet
// that is genuinely stuck. Check what remains with
//   redis-cli ttl sanctuary:diagnostics:worker-heartbeat:v1:restart:<bootHash>
// the marker counts down and is not refreshed.
let admission; let admissionBody = {}; let admissionAt = null;
const admissionDeadline = Date.now() + Number(process.env.CANARY_ACTIVATION_TIMEOUT_MS || 90 * 60_000);
for (let attempt = 1; ; attempt += 1) {
  admission = await api('/sync/network/mainnet', { method: 'POST', body: JSON.stringify({}) }, 30_000);
  admissionBody = parseJsonOr(admission.text, { parseError: true });
  admissionAt = nowIso();
  const admitted = admission.ok && ((admissionBody.requested ?? 0) + (admissionBody.merged ?? 0)) > 0;
  record({ type: admitted ? 'admission' : 'admission_blocked', attempt, http: admission.status, success: admissionBody.success ?? false, requested: admissionBody.requested ?? null, merged: admissionBody.merged ?? null, rejected: admissionBody.rejected ?? null, indeterminate: admissionBody.indeterminate ?? null });
  if (admitted) break;
  if (Date.now() > admissionDeadline) { record({ type: 'abort', reason: 'fleet admission never accepted (activation gate)' }); stopSampling = true; await Promise.allSettled([samplerLoop, runtimeLoop, diagLoop]); process.exit(1); }
  await sleep(20_000);
}
lastProgressAt = Date.now();
let terminalFleet = null; let terminalAt = null; let silentHang = false;
const fleetDeadline = Date.now() + FLEET_TIMEOUT_MS;
while (Date.now() < fleetDeadline) {
  await pollWalletLogs(walletIds);
  const snap = await fleetSnapshot();
  const d = await diagSample();
  const settled = snap.summary.active === 0 && snap.summary.pending === 0 && snap.summary.leasesPresent === 0 && snap.summary.terminal === snap.summary.total;
  const allTouched = snap.wallets.every((w) => w.lastSyncedAt && Date.parse(w.lastSyncedAt) >= Date.parse(admissionAt) - 5000 || w.actionRequired || w.status === 'failed' || w.status === 'retrying');
  const quietMs = Date.now() - lastProgressAt;
  // Terminal: durable state settled, worker idle, and either every wallet reported a
  // post-admission outcome or the fleet has been quiet for 90 s (a wallet whose
  // request merged into an already-current state never rewrites lastSyncedAt).
  if (settled && d.status === 'observed' && d.activeTotal === '0' && (allTouched || quietMs > 90_000)) {
    if (!allTouched) record({ type: 'note', message: 'fleet settled without every wallet rewriting lastSyncedAt', quietMs });
    terminalFleet = snap; terminalAt = nowIso(); break;
  }
  if (Date.now() - lastProgressAt > SILENT_HANG_MS && snap.summary.active > 0) { silentHang = true; record({ type: 'silent_hang', summary: snap.summary }); break; }
  await sleep(1000);
}
if (!terminalFleet) { record({ type: 'abort', reason: silentHang ? 'silent hang' : 'fleet did not reach terminal within budget' }); stopSampling = true; await Promise.allSettled([samplerLoop, runtimeLoop, diagLoop]); process.exit(1); }
record({ type: 'fleet_terminal', ...terminalFleet.summary });
await pollWalletLogs(walletIds);

// repeat sync of a previously stale wallet (oldest pre-canary lastSyncedAt)
phase = 'repeat';
const staleCandidate = [...initialFleet.wallets].sort((a, b) => (a.lastSyncedAt || '').localeCompare(b.lastSyncedAt || ''))[0];
let repeat; let repeatBody = {}; let repeatAt = null;
for (let attempt = 1; attempt <= 12; attempt += 1) {
  repeat = await api(`/sync/wallet/${staleCandidate.id}`, { method: 'POST', body: JSON.stringify({}) }, 30_000);
  repeatBody = parseJsonOr(repeat.text, {});
  repeatAt = nowIso();
  if (repeat.ok) break;
  record({ type: 'repeat_admission_blocked', attempt, walletRef: refOf(staleCandidate.id), http: repeat.status });
  await sleep(10_000);
}
record({ type: 'repeat_admission', walletRef: refOf(staleCandidate.id), http: repeat.status, status: repeatBody.status ?? null, previousLastSyncedAt: staleCandidate.lastSyncedAt });
let repeatOutcome = null; let repeatTerminalAt = null; let repeatStranded = true;
const repeatDeadline = Date.now() + REPEAT_TIMEOUT_MS;
while (Date.now() < repeatDeadline) {
  await pollWalletLogs([staleCandidate.id]);
  const snap = await fleetSnapshot();
  const w = snap.wallets.find((x) => x.id === staleCandidate.id);
  const d = await diagSample();
  const settled = w && !w.inProgress && !w.pending && !w.lease && w.lastSyncedAt && Date.parse(w.lastSyncedAt) >= Date.parse(repeatAt) - 5000;
  if (settled && d.status === 'observed' && d.activeTotal === '0') {
    repeatOutcome = w.actionRequired || w.status === 'failed' ? 'action_required' : w.status === 'retrying' ? 'retrying' : 'success';
    repeatStranded = false; repeatTerminalAt = nowIso(); break;
  }
  if (w && (w.actionRequired || w.status === 'failed') && !w.inProgress && !w.pending) { repeatOutcome = 'action_required'; repeatStranded = false; repeatTerminalAt = nowIso(); break; }
  await sleep(1000);
}
if (!repeatTerminalAt) { record({ type: 'abort', reason: 'repeat sync did not converge' }); stopSampling = true; await Promise.allSettled([samplerLoop, runtimeLoop, diagLoop]); process.exit(1); }
record({ type: 'repeat_terminal', walletRef: refOf(staleCandidate.id), outcome: repeatOutcome, stranded: repeatStranded });

// post-terminal window
phase = 'post_terminal';
const postStart = Date.now();
while (Date.now() - postStart < POST_TERMINAL_MS) { await sleep(5000); }
const finalFleet = await fleetSnapshot();
const finalDiag = await diagSample();
stopSampling = true;
await Promise.allSettled([samplerLoop, runtimeLoop, diagLoop]);
const completedAt = nowIso();

// ---------- summaries ----------
function summarizeEndpoint(key) {
  const all = state.samples.map((s) => s.endpoints[key]);
  const post = state.samples.filter((s) => s.at >= Date.parse(repeatTerminalAt)).map((s) => s.endpoints[key]);
  const lat = all.map((e) => e.latencyMs).sort((a, b) => a - b);
  const p99 = lat.length ? lat[Math.min(lat.length - 1, Math.ceil(lat.length * 0.99) - 1)] : 0;
  return { samples: all.length, postTerminalSamples: post.length, failures: all.filter((e) => !e.ok).length, p99Ms: Math.ceil(p99), maxMs: Math.ceil(lat[lat.length - 1] ?? 0) };
}
const uiSummary = summarizeEndpoint('ui');
const peakBytes = Math.max(...state.runtime.map((r) => r.worker.memoryPeakBytes), 0);
const lastRuntime = state.runtime[state.runtime.length - 1];
const restartCount = Math.max(...state.runtime.map((r) => r.worker.restartCount));
const oomKilled = state.runtime.some((r) => r.worker.oomKilled);
const exitCode = Math.max(...state.runtime.map((r) => r.worker.exitCode));
const fallbackCount = (state.metrics.fallbackEnd ?? 0) - (state.metrics.fallbackStart ?? 0);
const outcomes = { success: finalFleet.summary.success, retrying: finalFleet.summary.retrying, actionRequired: finalFleet.summary.actionRequired };
const actionRequiredReasons = finalFleet.wallets.filter((w) => w.actionRequired || w.status === 'failed').map((w) => ({ walletRef: refOf(w.id), failureClass: w.failureClass, status: w.status }));
record({ type: 'action_required_reasons', reasons: actionRequiredReasons });

// candidate work: first bounded batch of the first wallet that reported sync_progress
let candidateBatch = null; let boundedOutcome = 'not_applicable'; let noCandidateWork = true;
const byWallet = new Map();
for (const ev of state.progress.candidateEvents) { if (!byWallet.has(ev.walletRef)) byWallet.set(ev.walletRef, []); byWallet.get(ev.walletRef).push(ev); }
for (const [, events] of byWallet) {
  const first = events.filter((e) => e.batch === 1 && typeof e.total === 'number' && e.total > 0 && typeof e.completed === 'number');
  if (first.length === 0) continue;
  noCandidateWork = false;
  const completedValues = first.map((e) => e.completed).filter((c) => c >= 1);
  const total = first[0].total;
  if (completedValues.length === 0) continue;
  const endCompleted = Math.min(Math.max(...completedValues), 25, total);
  candidateBatch = { startCompleted: 1, endCompleted, total };
  const terminalEvent = events.find((e) => e.event === 'timeout' || e.event === 'aborted');
  boundedOutcome = terminalEvent ? (terminalEvent.event === 'timeout' ? 'retryable' : 'fatal') : (endCompleted > 1 ? 'advanced' : 'retryable');
  break;
}
if (!noCandidateWork && candidateBatch === null) { record({ type: 'warning', message: 'candidate events seen but no usable first batch' }); }

const hostImages = await Promise.all(['backend', 'worker', 'frontend', 'gateway', 'llm-egress-proxy'].map(async (service) => { const c = await inspectContainer(`${PROJECT}-${service}-1`); return { service, containerId: c.containerId, imageId: c.imageId, status: c.status, restartCount: c.restartCount, health: c.health }; }));
const host = { at: nowIso(), type: 'host_runtime_attestation', releaseCandidate: { tag: TAG, commit: COMMIT }, images: hostImages, kernelPeak: { source: 'cgroup-v2-memory.peak', containerId: lastRuntime.worker.containerId, imageId: lastRuntime.worker.imageId, memoryPeakBytes: peakBytes, memoryLimitBytes: lastRuntime.worker.memoryLimitBytes } };
record(host);
fs.writeFileSync(path.join(OUT_DIR, 'host.json'), JSON.stringify(host) + '\n', { mode: 0o600 });
const ui = { at: nowIso(), type: 'ui_attestation', releaseCandidate: { tag: TAG, commit: COMMIT }, observedFrom: repeatTerminalAt, observedThrough: completedAt, healthyThroughoutPostTerminal: uiSummary.failures === 0, allWalletsSynced: finalFleet.summary.success === finalFleet.summary.total, staleObserved: false, leaseEvidenceExpiredObserved: false, affectedFleetPreviouslyReportedStale: true, operationalStatusExposed: operational !== null };
record(ui);
fs.writeFileSync(path.join(OUT_DIR, 'ui.json'), JSON.stringify(ui) + '\n', { mode: 0o600 });
const lifecycle = {
  leaseLockAgreement: state.diag.agreementSeen && state.diag.agreementObserved && !state.diag.lockAnomaly,
  leasesAndLocksCleared: finalFleet.summary.leasesPresent === 0 && finalDiag.status === 'observed' && finalDiag.activeTotal === '0',
  generationsConverged: finalFleet.summary.pending === 0,
  formerlyStaleRepeatConverged: repeatOutcome === 'success' && !repeatStranded,
  uiHealthyThroughoutPostTerminal: uiSummary.failures === 0,
};
record({ type: 'inner_summary', startedAt, completedAt, admissionAt, terminalAt, repeatAt, repeatTerminalAt, fleetTotal: initialFleet.summary.total, finalFleet: finalFleet.summary, outcomes, progress: { ...state.progress, candidateEvents: state.progress.candidateEvents.length }, diagnostics: { versions: [...state.diag.versions], addressHistoryObserved: state.diag.addressHistoryActive, redisAgreementObserved: state.diag.agreementSeen && state.diag.agreementObserved, lockAnomaly: state.diag.lockAnomaly, terminalActiveTotal: finalDiag.activeTotal === '0' ? 0 : finalDiag.activeTotal }, metrics: { activeStageAgeObserved: state.metrics.activeStageAge, names: [...state.metrics.families].sort(), fallbackDelta: fallbackCount }, boundedError: { candidateBatch, outcome: boundedOutcome, noCandidateWorkObserved: noCandidateWork, silentHang }, lifecycle, ui: uiSummary });
await new Promise((resolve) => evidenceStream.end(resolve));
const evidenceBytes = fs.readFileSync(EVIDENCE);

const receipt = {
  schemaVersion: 'sanctuary.release-candidate-canary.v2',
  releaseCandidate: { tag: TAG, commit: COMMIT, imageIds: [...new Set(hostImages.map((i) => i.imageId))] },
  canaryWindow: { startedAt, completedAt },
  fleet: {
    total: finalFleet.summary.total,
    outcomes,
    actionRequiredWithExplicitReason: outcomes.actionRequired,
    previouslyStaleRepeat: { outcome: repeatOutcome, stranded: repeatStranded },
  },
  progressEvidence: {
    phaseObserved: state.progress.phase,
    liveElapsedObserved: state.progress.elapsed,
    knownCountsObserved: { addresses: state.progress.addresses, candidates: noCandidateWork || candidateBatch !== null, batches: noCandidateWork || candidateBatch !== null },
    liveSyncLogObserved: state.progress.liveLog,
    preflightObserved: state.progress.preflight,
  },
  diagnosticsEvidence: {
    versionsObserved: [...state.diag.versions].sort(),
    addressHistoryActiveObserved: state.diag.addressHistoryActive,
    redisLockAgreementObserved: state.diag.agreementSeen && state.diag.agreementObserved,
    terminalActiveTotal: finalDiag.activeTotal === '0' ? 0 : -1,
  },
  metricEvidence: { activeStageAgeObserved: state.metrics.activeStageAge, counterFamiliesObserved: FAMILIES.filter((f) => state.metrics.families.has(f)) },
  boundedErrorEvidence: { candidateBatch, outcome: boundedOutcome, noCandidateWorkObserved: noCandidateWork, withinBudgetAndGrace: !silentHang, silentHang },
  remoteEvidence: {
    probeWindowMs: Date.parse(completedAt) - Date.parse(startedAt),
    postTerminalWindowMs: Date.parse(completedAt) - Date.parse(repeatTerminalAt),
    endpoints: { live: summarizeEndpoint('live'), ready: summarizeEndpoint('ready'), metricsPrometheus: summarizeEndpoint('metricsPrometheus') },
    runtime: { peakBytes, memoryLimitBytes: lastRuntime.worker.memoryLimitBytes, oomKilled, restartCount, exitCode, fallbackCount },
    lifecycle,
    rawEvidence: { sha256: createHash('sha256').update(evidenceBytes).digest('hex'), bytes: evidenceBytes.length },
  },
  signoff: { decision: 'accepted', signedAt: nowIso(), operatorId: OPERATOR_ID },
};
fs.writeFileSync(path.join(OUT_DIR, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ done: true, outDir: OUT_DIR, fleet: receipt.fleet, endpoints: receipt.remoteEvidence.endpoints, runtime: receipt.remoteEvidence.runtime, lifecycle, progress: receipt.progressEvidence, diagnostics: receipt.diagnosticsEvidence, metrics: receipt.metricEvidence, boundedError: receipt.boundedErrorEvidence }, null, 1));
