#!/usr/bin/env node
// Read-only pre-flight for the release-candidate canary.
//
// Run this on the deployment host BEFORE canary-probe.mjs. It exercises exactly
// the surfaces the probe depends on -- container discovery, admin token minting,
// worker diagnostics, the metrics scrape, fleet truth, the self-signed UI, and
// cgroup readability -- and prints one JSON object. It mutates nothing and
// starts no sync, so it is safe to run at any time.
//
// A probe that fails on a stack this reports healthy is a probe bug. A probe
// that fails on a stack this reports broken is an environment problem; fix that
// first rather than burning a canary window.
//
// Worker endpoints. The probe samples the worker's /live, /ready and
// /metrics/prometheus (the receipt's endpoint, family and fallback evidence), so
// this reports status and latency for all three. One idle sample is reported,
// not gated: without CANARY_SELFTEST_SAMPLES the exit status is 2 when the
// backend or every worker IP fails /live, and 0 otherwise.
//
// Sampling mode. CANARY_SELFTEST_SAMPLES=<n> (capped at SELFTEST_MAX_SAMPLES)
// and CANARY_SELFTEST_INTERVAL_MS (default 1000) take n endpoint samples while
// polling worker diagnostics every 250 ms, as the probe does during a sync. Run
// it during a scheduled sync: the window runs on until 40 diagnostics samples
// saw an active sync, for at most SELFTEST_WINDOW_LIMIT_MS (900 s), and is then
// judged against the receipt gates. Exit 0 = valid window, all gates met;
// 1 = valid window, a gate missed; 3 = invalid window (fewer endpoint samples
// than requested, or too little sync activity seen; run it again during a sync). Still read-only: it starts no sync.
import path from 'node:path';
import {
  CANARY_ADMIN_SQL,
  SELFTEST_DIAG_INTERVAL_MS,
  SELFTEST_MIN_ACTIVE_DIAG_SAMPLES,
  SELFTEST_WINDOW_LIMIT_MS,
  createCanaryRuntime,
  discoverWorkerBase,
  evaluateSelftestWindow,
  fleetReadiness,
  isActiveDiagSample,
  parseJsonOr,
  parseMetrics,
  parseSelftestSampling,
  readCgroup,
  sleep,
  stripTiming,
  timedFetch,
  timedHttpsInsecure,
  workerProbeUrls,
} from './lib/canary-runtime.mjs';

const ENV_FILE = process.env.SANCTUARY_ENV_FILE || path.join(process.env.HOME, '.config/sanctuary/sanctuary.env');
const UI_URL = process.env.CANARY_UI_URL || 'https://localhost:8443/';
const PROJECT = process.env.COMPOSE_PROJECT || 'sanctuary';
const sampling = parseSelftestSampling(process.env);
if (sampling.error) { console.error(sampling.error); process.exit(2); }

const {
  psql,
  containerIps,
  inspectContainer,
  mintAccessToken,
  diagnostics,
  fleetSnapshot,
} = createCanaryRuntime({ envFile: ENV_FILE, project: PROJECT });

/** One sample of the three worker endpoints the probe records, with the exposition body. */
async function sampleWorker(base) {
  const urls = workerProbeUrls(base);
  const [live, ready, metricsPrometheus] = await Promise.all([
    timedFetch(urls.live, {}, 1000),
    timedFetch(urls.ready, {}, 1000),
    timedFetch(urls.metricsPrometheus, {}, 1000),
  ]);
  return {
    metricsText: metricsPrometheus.ok ? metricsPrometheus.text : '',
    endpoints: { live: stripTiming(live), ready: stripTiming(ready), metricsPrometheus: stripTiming(metricsPrometheus) },
  };
}

const backendIps = await containerIps(`${PROJECT}-backend-1`);
let backendBase = null;
for (const ip of backendIps) {
  const r = await timedFetch(`http://${ip}:3001/api/v1/health/live`, {}, 1500);
  if (r.ok) { backendBase = `http://${ip}:3001`; break; }
}
const workerBase = await discoverWorkerBase(await containerIps(`${PROJECT}-worker-1`));
if (!backendBase || !workerBase) { console.error('backend or worker unreachable'); process.exit(2); }

const [[adminId, adminName, sv]] = await psql(CANARY_ADMIN_SQL);
const token = mintAccessToken({ userId: adminId, username: adminName, sessionVersion: Number(sv) });
const h = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

const wallets = await timedFetch(`${backendBase}/api/v1/wallets`, { headers: h }, 10000);
const walletList = parseJsonOr(wallets.text);
const walletCount = walletList?.length ?? null;
const status = await timedFetch(`${backendBase}/api/v1/bitcoin/status?network=mainnet`, { headers: h }, 10000);
const parsedStatus = parseJsonOr(status.text);
const op = parsedStatus ? (parsedStatus.operational ?? 'absent') : null;
const [[someWallet]] = await psql("select id from wallets where network='mainnet' limit 1");
const logs = await timedFetch(`${backendBase}/api/v1/sync/logs/${someWallet}`, { headers: h }, 5000);
const logsLen = parseJsonOr(logs.text)?.logs?.length ?? null;
const diag = await diagnostics(workerBase);
const workerSample = await sampleWorker(workerBase);
const parsed = parseMetrics(workerSample.metricsText);
const fleet = await fleetSnapshot();
const ui = await timedHttpsInsecure(UI_URL, 1000);
const worker = await inspectContainer(`${PROJECT}-worker-1`);

const report = {
  backendBase,
  workerBase,
  walletsHttp: wallets.status,
  walletCount,
  statusHttp: status.status,
  operational: op === 'absent' ? 'absent' : (op ? Object.keys(op) : null),
  logsHttp: logs.status,
  logsLen,
  diag,
  workerEndpoints: workerSample.endpoints,
  metrics: { families: [...parsed.families], activeStageAge: parsed.activeStageAge, fallback: parsed.fallback },
  fleet: fleet.summary,
  fleetReadiness: fleetReadiness(fleet.summary.total, Array.isArray(walletList) ? walletList.filter((w) => w.network === 'mainnet').length : null),
  ui,
  worker: {
    ...worker,
    peak: readCgroup(worker.containerId, 'memory.peak'),
    max: readCgroup(worker.containerId, 'memory.max'),
  },
};
if (!sampling.enabled) {
  console.log(JSON.stringify(report, null, 1));
  process.exit(0);
}

// ---------- sampling mode (CANARY_SELFTEST_SAMPLES) ----------
const sampled = await runSamplingWindow(workerBase, sampling);
console.log(JSON.stringify({ ...report, sampling: sampled }, null, 1));
process.exit(sampled.valid ? (sampled.pass ? 0 : 1) : 3);

/** Sleep out the rest of an interval that began at `startedMs`, never past the window deadline. */
function pause(startedMs, intervalMs, deadline) {
  return sleep(Math.max(0, Math.min(intervalMs - (Date.now() - startedMs), deadline - Date.now())));
}

function recordMetrics(w, text) {
  if (!text) return;
  const m = parseMetrics(text);
  m.families.forEach((f) => w.families.add(f));
  if (m.activeStageAge) w.activeStageAge = true;
  if (w.fallbackStart === null) w.fallbackStart = m.fallback;
  w.fallbackEnd = m.fallback;
}

async function endpointLoop(base, w, intervalMs, done) {
  while (!done()) {
    const t = Date.now();
    const { metricsText, endpoints } = await sampleWorker(base);
    w.endpointSamples.push(endpoints);
    recordMetrics(w, metricsText);
    await pause(t, intervalMs, w.deadline);
  }
}

async function diagLoop(base, w, done) {
  while (!done()) {
    const t = Date.now();
    const d = await diagnostics(base);
    w.diagSamples.push(d);
    if (isActiveDiagSample(d)) w.active += 1;
    await pause(t, SELFTEST_DIAG_INTERVAL_MS, w.deadline);
  }
}

/**
 * Take `samples` endpoint samples, extended until SELFTEST_MIN_ACTIVE_DIAG_SAMPLES
 * diagnostics samples saw an active sync, never past SELFTEST_WINDOW_LIMIT_MS.
 */
async function runSamplingWindow(base, { samples, intervalMs }) {
  const startedAt = Date.now();
  const w = { deadline: startedAt + SELFTEST_WINDOW_LIMIT_MS, endpointSamples: [], diagSamples: [], active: 0, families: new Set(), activeStageAge: false, fallbackStart: null, fallbackEnd: null };
  const done = () => Date.now() >= w.deadline || (w.endpointSamples.length >= samples && w.active >= SELFTEST_MIN_ACTIVE_DIAG_SAMPLES);
  await Promise.all([endpointLoop(base, w, intervalMs, done), diagLoop(base, w, done)]);
  const verdict = evaluateSelftestWindow({ endpointSamples: w.endpointSamples, diagSamples: w.diagSamples, elapsedMs: Date.now() - startedAt, requestedSamples: samples });
  return {
    ...verdict,
    intervalMs,
    familiesObserved: [...w.families].sort(),
    activeStageAgeObserved: w.activeStageAge,
    fallbackDelta: (w.fallbackEnd ?? 0) - (w.fallbackStart ?? 0),
  };
}
