// Shared runtime for the release-candidate canary tools.
//
// The probe, self-test and debug driver all need the same primitives: read the
// operator's runtime env for secrets, reach the stack over the container
// network, mint an admin access token, call worker diagnostics, scrape
// wallet-sync metrics, and read fleet truth straight out of Postgres.
//
// They used to carry three private copies of that block, which drifted: the
// probe learned to tolerate the `sanctuary_` metric-name prefix while the other
// two kept matching bare `wallet_sync_*`, so a self-test could report missing
// counter families that the probe saw fine. One definition, imported three
// times, is the fix.
//
// Nothing here persists a secret. `createCanaryRuntime` reads the env file once
// and keeps JWT_SECRET / WORKER_DIAGNOSTICS_SECRET in closure; they are never
// written to the evidence sidecar, the receipt, or stdout.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import https from 'node:https';

import { CANARY_ATTESTED_SERVICES, COMMIT_PATTERN } from '../../verify-release-candidate-canary.mjs';

const execFileP = promisify(execFile);
const REVISION_LABEL_FORMAT = '{{index .Config.Labels "org.opencontainers.image.revision"}}';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nowIso = () => new Date().toISOString();

/**
 * Minimal `KEY=value` reader for the runtime env file. Not a shell parser: it
 * strips one layer of matching quotes and ignores comments and blank lines,
 * which is exactly the shape install.sh writes.
 */
export function readEnvFile(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

/**
 * Read a file, or null if it cannot be read.
 *
 * Every absent-is-normal read in these tools goes through here so that no catch
 * block silently swallows an error -- scripts/check-safety-catch-guards.mjs
 * covers scripts/release, and a catch that neither rethrows nor returns is a
 * finding there whatever the comment next to it says.
 */
function readFileOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

/** JSON.parse that yields `fallback` instead of throwing on malformed input. */
export function parseJsonOr(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/**
 * The kernel exposes a container's cgroup under one of two layouts depending on
 * whether the runtime uses systemd scopes. Absent on a host that uses neither.
 */
export function readCgroup(containerId, file) {
  const candidates = [
    `/sys/fs/cgroup/system.slice/docker-${containerId}.scope/${file}`,
    `/sys/fs/cgroup/docker/${containerId}/${file}`,
  ];
  for (const candidate of candidates) {
    const value = readFileOrNull(candidate);
    if (value !== null) return value;
  }
  return null;
}

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

export async function timedFetch(url, init = {}, timeoutMs = 1000) {
  const started = process.hrtime.bigint();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, dispatcher: undefined });
    const text = await res.text();
    const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
    return { ok: res.status === 200, status: res.status, latencyMs, text };
  } catch (error) {
    const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
    return { ok: false, status: 0, latencyMs, text: '', error: error?.name || String(error) };
  } finally { clearTimeout(timer); }
}

// Node's fetch does not honour an https.Agent, so the self-signed UI cert needs
// a raw https request to be probed at all.
export function timedHttpsInsecure(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const req = https.get(url, { agent: insecureAgent, timeout: timeoutMs }, (res) => {
      res.resume();
      res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, latencyMs: Number(process.hrtime.bigint() - started) / 1e6 }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (error) => resolve({ ok: false, status: 0, latencyMs: Number(process.hrtime.bigint() - started) / 1e6, error: error.message }));
  });
}

export function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

export const FAMILIES = ['abort_grace_exhausted', 'budget_expiry', 'candidates', 'cleanup', 'fallback', 'lock_loss', 'terminal'];

// Hoisted out of parseMetrics: an inline regex literal in its for-of header made lizard's JS
// reader lose the function's end and charge every later function's branches to it.
const FALLBACK_TOTAL_RE = /^(?:sanctuary_)?wallet_sync_fallback_total(?:\{[^}]*\})? (\d+(?:\.\d+)?)/gm;

/**
 * Scrape the wallet-sync counter families out of a Prometheus exposition body.
 *
 * The `sanctuary_` prefix is optional on purpose: the backend has exposed both
 * bare and prefixed family names across releases, and a canary that only
 * matched one spelling reported a healthy fleet as missing its counters.
 */
export function parseMetrics(text) {
  const families = new Set();
  for (const f of FAMILIES) if (new RegExp(`^# TYPE (?:sanctuary_)?wallet_sync_${f}_total `, 'm').test(text)) families.add(f);
  const activeStageAge = /^# TYPE (?:sanctuary_)?wallet_sync_active_stage_oldest_seconds /m.test(text);
  let fallback = 0;
  for (const m of text.matchAll(FALLBACK_TOTAL_RE)) fallback += Number(m[1]);
  return { families, activeStageAge, fallback };
}

/**
 * The admin the canary acts as. POST /sync/network/<network> admits only the
 * caller's wallets, so an arbitrary admin with no wallets (an operator account
 * next to the seeded demo login) admits nothing and the canary waits out its
 * activation timeout. Choose the admin who can access the most mainnet wallets;
 * ties go to the oldest account so the choice is deterministic.
 */
export const CANARY_ADMIN_SQL = `select u.id, u.username, u."sessionVersion" from users u where u."isAdmin" = true
  order by (select count(*) from wallet_users wu join wallets w on w.id = wu."walletId"
    where wu."userId" = u.id and w.network = 'mainnet') desc, u."createdAt", u.id limit 1`;

/** The validator's minimum fleet (verify-release-candidate-canary.mjs). */
export const CANARY_MIN_FLEET = 12;

/**
 * Whether the canary can run: enough mainnet wallets, all visible to the canary
 * admin. Pure; exported for tests. `accessible` may be null when unknown.
 */
export function fleetReadiness(total, accessible) {
  const problems = [];
  if (total < CANARY_MIN_FLEET) problems.push(`fleet has ${total} mainnet wallets; the canary needs ${CANARY_MIN_FLEET}`);
  if (accessible !== null && accessible < total) problems.push(`canary admin can access ${accessible} of ${total} mainnet wallets`);
  return { minimum: CANARY_MIN_FLEET, total, accessible, ready: problems.length === 0, problems,
    ...(problems.length ? { hint: 'seed the public test-vector fleet: npm run canary:fleet:seed' } : {}) };
}

/**
 * Whether the probe seeds the public test-vector fleet (canary-fleet.mjs) before
 * arming: only when the fleet is short, unless CANARY_SEED_FLEET=0. Pure; exported for tests.
 */
export function shouldSeedFleet(total, env) {
  return total < CANARY_MIN_FLEET && env.CANARY_SEED_FLEET !== '0';
}

/**
 * The worker's health endpoints. The receipt's live/ready/metricsPrometheus
 * samples, counter families and fallback delta come from here, not the backend:
 * wallet_sync_fallback_total is incremented only in the worker
 * (server/src/worker/walletSyncAttemptTelemetry.ts), so a backend scrape always
 * reported a zero fallback delta. Served by server/src/worker/healthServer.ts.
 */
export function workerProbeUrls(workerBase) {
  return { live: `${workerBase}/live`, ready: `${workerBase}/ready`, metricsPrometheus: `${workerBase}/metrics/prometheus` };
}

/**
 * The first worker IP whose /live answers 200, as a base URL, or null when none
 * does. Iterates every network the container is attached to, like backend
 * discovery, instead of trusting whichever address `docker inspect` lists first.
 */
export async function discoverWorkerBase(ips, fetcher = timedFetch) {
  for (const ip of ips) {
    const base = `http://${ip}:3002`;
    if ((await fetcher(workerProbeUrls(base).live, {}, 1500)).ok) return base;
  }
  return null;
}

/** A timed request result without its body, as the evidence records it. */
export function stripTiming(r) {
  return { ok: r.ok, status: r.status, latencyMs: Math.round(r.latencyMs * 1000) / 1000, ...(r.error ? { error: r.error } : {}) };
}

/** Failures, p99 and max over `{ok, latencyMs}` entries, computed as the receipt reports them. */
export function latencySummary(entries) {
  const lat = entries.map((e) => e.latencyMs).sort((a, b) => a - b);
  const p99 = lat.length ? lat[Math.min(lat.length - 1, Math.ceil(lat.length * 0.99) - 1)] : 0;
  return { samples: entries.length, failures: entries.filter((e) => !e.ok).length, p99Ms: Math.ceil(p99), maxMs: Math.ceil(lat[lat.length - 1] ?? 0) };
}

// Selftest sampling mode (CANARY_SELFTEST_SAMPLES). The gates mirror
// validateEndpointSummary in scripts/release/verify-release-candidate-canary.mjs.
export const SELFTEST_GATES = { failures: 0, p99Ms: 250, maxMs: 1000 };
export const SELFTEST_MAX_SAMPLES = 900;
export const SELFTEST_WINDOW_LIMIT_MS = 900_000;
export const SELFTEST_MIN_ACTIVE_DIAG_SAMPLES = 40;
// The probe polls diagnostics this often while a sync is active (canary-probe.mjs diagLoop).
export const SELFTEST_DIAG_INTERVAL_MS = 250;
export const WORKER_ENDPOINTS = ['live', 'ready', 'metricsPrometheus'];

function positiveIntegerEnv(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return { value: fallback };
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? { value } : { error: `${key} must be a positive integer, got ${JSON.stringify(raw)}` };
}

/**
 * Read the sampling-mode knobs. Without CANARY_SELFTEST_SAMPLES the selftest
 * takes its single pre-flight sample. The sample count is capped; the window
 * may run past it (to see enough sync activity) only up to SELFTEST_WINDOW_LIMIT_MS.
 */
export function parseSelftestSampling(env) {
  if (env.CANARY_SELFTEST_SAMPLES === undefined || env.CANARY_SELFTEST_SAMPLES === '') return { enabled: false };
  const samples = positiveIntegerEnv(env, 'CANARY_SELFTEST_SAMPLES');
  const interval = positiveIntegerEnv(env, 'CANARY_SELFTEST_INTERVAL_MS', 1000);
  if (samples.error || interval.error) return { error: samples.error ?? interval.error };
  return { enabled: true, samples: Math.min(samples.value, SELFTEST_MAX_SAMPLES), intervalMs: interval.value };
}

/** A diagnostics sample taken while at least one wallet sync was executing. `activeTotal` is a string. */
export function isActiveDiagSample(d) {
  return d?.status === 'observed' && Number(d.activeTotal) > 0;
}

function endpointGate(entries) {
  const summary = latencySummary(entries);
  const missed = [];
  if (summary.samples === 0) missed.push('samples');
  if (summary.failures > SELFTEST_GATES.failures) missed.push('failures');
  if (summary.p99Ms > SELFTEST_GATES.p99Ms) missed.push('p99');
  if (summary.maxMs > SELFTEST_GATES.maxMs) missed.push('max');
  return { ...summary, missed, pass: missed.length === 0 };
}

/** Why a sampling window cannot be judged, or null when it can. */
function selftestInvalidReason(activeSamples, endpointSampleCount, requestedSamples) {
  if (endpointSampleCount < requestedSamples) {
    return `only ${endpointSampleCount} of ${requestedSamples} requested endpoint samples before the window ended`;
  }
  if (activeSamples < SELFTEST_MIN_ACTIVE_DIAG_SAMPLES) {
    return `only ${activeSamples} of ${SELFTEST_MIN_ACTIVE_DIAG_SAMPLES} active diagnostics samples before the window ended`;
  }
  return null;
}

/**
 * Judge a sampling window. It is valid only when it took every requested
 * endpoint sample (a window the deadline cut short is not the window asked
 * for) and saw at least SELFTEST_MIN_ACTIVE_DIAG_SAMPLES active diagnostics
 * samples (an idle window says nothing about latency under sync load); each
 * worker endpoint must then meet the receipt gates. Pure; exported for tests.
 */
export function evaluateSelftestWindow({ endpointSamples, diagSamples, elapsedMs, requestedSamples }) {
  const activeSamples = diagSamples.filter(isActiveDiagSample).length;
  const invalidReason = selftestInvalidReason(activeSamples, endpointSamples.length, requestedSamples);
  const valid = invalidReason === null;
  const gates = Object.fromEntries(WORKER_ENDPOINTS.map((key) => [key, endpointGate(endpointSamples.map((s) => s[key]))]));
  return {
    valid,
    invalidReason,
    pass: valid && WORKER_ENDPOINTS.every((key) => gates[key].pass),
    elapsedMs,
    requestedSamples,
    endpointSampleCount: endpointSamples.length,
    activeSamples,
    diagSamples: diagSamples.length,
    minActiveSamples: SELFTEST_MIN_ACTIVE_DIAG_SAMPLES,
    gates,
  };
}

export const FLEET_SQL =`select id, network, "lastSyncStatus", "syncInProgress", "syncRetryCount", "syncActionRequiredAt" is not null,
  "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration" or "requestedFullResyncGeneration" > "processedFullResyncGeneration",
  "incrementalSyncLeaseToken" is not null, coalesce(to_char("lastSyncedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), ''), "lastSyncFailureClass"
  from wallets where network = 'mainnet' order by "createdAt", id`;

/** Roll fleet rows up into the counts the receipt reports. Pure; exported for tests. */
export function summarizeFleet(wallets) {
  const summary = { total: wallets.length, active: 0, pending: 0, leasesPresent: 0, success: 0, retrying: 0, actionRequired: 0, terminal: 0 };
  for (const w of wallets) {
    if (w.inProgress) summary.active += 1;
    if (w.pending) summary.pending += 1;
    if (w.lease) summary.leasesPresent += 1;
    const settled = !w.inProgress && !w.pending && !w.lease;
    if (settled) summary.terminal += 1;
    if (w.actionRequired || w.status === 'failed') summary.actionRequired += 1;
    else if (w.status === 'retrying') summary.retrying += 1;
    else if (w.status === 'success') summary.success += 1;
  }
  return summary;
}

/**
 * Why each attested service's running image is not a build of `commit`: missing,
 * unlabelled, or labelled with another revision. Pure; exported for tests.
 */
export function deployedRevisionProblems(images, commit) {
  const validCommit = typeof commit === 'string' && COMMIT_PATTERN.test(commit);
  const problems = [];
  for (const service of CANARY_ATTESTED_SERVICES) {
    const image = images.find((candidate) => candidate.service === service);
    if (!image) {
      problems.push(`${service}: no running container was attested`);
    } else if (!image.revision) {
      problems.push(`${service}: image ${image.imageId} has no org.opencontainers.image.revision label`);
    } else if (!validCommit || image.revision !== commit) {
      problems.push(`${service}: image ${image.imageId} was built from ${image.revision}, not CANARY_COMMIT ${commit}`);
    }
  }
  return problems;
}

/** One problem per service whose image changed, or vanished, between two reads. Pure. */
export function deployedImageDriftProblems(deployed, attested) {
  return deployed.flatMap(({ service, imageId }) => {
    const current = attested.find((candidate) => candidate.service === service);
    if (!current) return [`${service}: no longer attested at the end of the run`];
    return current.imageId === imageId ? [] : [`${service}: image changed during the run (${imageId} -> ${current.imageId})`];
  });
}

/**
 * Everything that forbids a receipt at attestation time: the attestation-time
 * images must be builds of `commit`, and the stack must not have been swapped
 * since the startup read. Pure; exported for tests.
 */
export function attestationProblems(deployed, attested, commit) {
  return [...deployedRevisionProblems(attested, commit), ...deployedImageDriftProblems(deployed, attested)];
}

/**
 * Bind the stack-facing helpers to one deployment: an env file to read secrets
 * from and a Compose project name to address containers by.
 *
 * Exits(2) rather than throwing when the env file lacks the secrets, because
 * every caller is a top-level script for which a stack trace is noise.
 */
export function createCanaryRuntime({ envFile, project }) {
  const runtimeEnv = readEnvFile(envFile);
  const JWT_SECRET = runtimeEnv.JWT_SECRET;
  const DIAG_SECRET = runtimeEnv.WORKER_DIAGNOSTICS_SECRET;
  if (!JWT_SECRET || !DIAG_SECRET) {
    console.error('runtime env lacks JWT_SECRET or WORKER_DIAGNOSTICS_SECRET');
    process.exit(2);
  }

  async function docker(...args) {
    const { stdout } = await execFileP('docker', args, { maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  }

  async function psql(sql) {
    const { stdout } = await execFileP('docker', ['exec', `${project}-postgres-1`, 'psql', '-U', 'sanctuary', '-d', 'sanctuary', '-tA', '-F', '\t', '-c', sql], { maxBuffer: 16 * 1024 * 1024 });
    return stdout.split('\n').filter(Boolean).map((l) => l.split('\t'));
  }

  async function containerIps(name) {
    const out = await docker('inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}', name);
    return out.trim().split(/\s+/).filter(Boolean);
  }

  async function inspectContainer(name) {
    const out = await docker('inspect', name);
    const [c] = JSON.parse(out);
    return {
      containerId: c.Id,
      imageId: c.Image,
      status: c.State.Status,
      health: c.State.Health?.Status ?? null,
      restartCount: c.RestartCount ?? 0,
      oomKilled: c.State.OOMKilled === true,
      exitCode: c.State.ExitCode ?? 0,
      memoryLimit: c.HostConfig.Memory ?? 0,
    };
  }

  // The revision label of the image each attested container is running. The
  // label is read from the container's image ID, never from a tag, so a rebuilt
  // but not restarted image cannot vouch for the running container.
  async function attestDeployedImages() {
    return Promise.all(CANARY_ATTESTED_SERVICES.map(async (service) => {
      const c = await inspectContainer(`${project}-${service}-1`);
      const label = (await docker('image', 'inspect', '--format', REVISION_LABEL_FORMAT, c.imageId)).trim();
      return {
        service,
        containerId: c.containerId,
        imageId: c.imageId,
        revision: label === '<no value>' ? '' : label,
        status: c.status,
        restartCount: c.restartCount,
        health: c.health,
      };
    }));
  }

  // HS256, no jti, access audience -- mirrors the backend's own access token.
  function mintAccessToken({ userId, username, sessionVersion }) {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const iat = Math.floor(Date.now() / 1000);
    const payload = b64url(JSON.stringify({ userId, username, isAdmin: true, sessionVersion, aud: 'sanctuary:access', iat, exp: iat + 3 * 3600 }));
    const sig = b64url(createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest());
    return `${header}.${payload}.${sig}`;
  }

  function signDiag(method, pathname, body) {
    const timestamp = String(Date.now());
    const nonce = randomBytes(16).toString('hex');
    const digest = createHash('sha256').update(body, 'utf8').digest('hex');
    const signature = createHmac('sha256', DIAG_SECRET).update([method, pathname, timestamp, nonce, digest].join('\n'), 'utf8').digest('hex');
    return { timestamp, nonce, signature };
  }

  async function diagnostics(workerBase) {
    const url = `${workerBase}/internal/diagnostics/v1/snapshot`;
    const body = JSON.stringify({ protocolVersion: 1, walletSyncExecution: true, walletSyncExecutionVersion: 2 });
    const auth = signDiag('POST', '/internal/diagnostics/v1/snapshot', body);
    const res = await timedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-sanctuary-timestamp': auth.timestamp, 'x-sanctuary-nonce': auth.nonce, 'x-sanctuary-signature': auth.signature },
      body,
    }, 3000);
    if (!res.ok) return { status: 'unavailable', http: res.status };
    const json = parseJsonOr(res.text);
    if (!json) return { status: 'unsupported', http: res.status, error: 'unparseable diagnostics response' };
    const exec = json.walletSyncExecution;
    if (!exec || exec.observation !== 'observed') return { status: 'unsupported', http: res.status };
    try {
      return {
        status: 'observed',
        version: exec.version,
        activeTotal: exec.active.total,
        activeStages: Object.entries(exec.active.byStage).filter(([, v]) => v !== '0').map(([k, v]) => `${k}=${v}`),
        agreement: exec.redisLockAgreement.agreement === 'observed',
        lockDetail: exec.redisLockAgreement.agreement === 'observed' ? {
          withOwned: exec.redisLockAgreement.registryWithOwnedLock,
          missingOwned: exec.redisLockAgreement.registryMissingOwnedLock,
          mismatch: exec.redisLockAgreement.registryOwnershipMismatch,
        } : null,
        counters: exec.counters,
      };
    } catch (error) { return { status: 'unsupported', error: String(error) }; }
  }

  async function fleetSnapshot() {
    const rows = await psql(FLEET_SQL);
    const wallets = rows.map(([id, network, status, inProgress, retryCount, actionRequired, pending, lease, lastSyncedAt, failureClass]) => ({
      id, network, status: status || null, inProgress: inProgress === 't', retryCount: Number(retryCount), actionRequired: actionRequired === 't', pending: pending === 't', lease: lease === 't', lastSyncedAt, failureClass: failureClass || null,
    }));
    return { wallets, summary: summarizeFleet(wallets) };
  }

  return {
    docker, psql, containerIps, inspectContainer, attestDeployedImages,
    mintAccessToken, signDiag, diagnostics, fleetSnapshot,
  };
}
