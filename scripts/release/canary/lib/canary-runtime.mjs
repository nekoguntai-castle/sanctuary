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

const execFileP = promisify(execFile);

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
  for (const m of text.matchAll(/^(?:sanctuary_)?wallet_sync_fallback_total(?:\{[^}]*\})? (\d+(?:\.\d+)?)/gm)) fallback += Number(m[1]);
  return { families, activeStageAge, fallback };
}

export const FLEET_SQL = `select id, network, "lastSyncStatus", "syncInProgress", "syncRetryCount", "syncActionRequiredAt" is not null,
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
    docker, psql, containerIps, inspectContainer,
    mintAccessToken, signDiag, diagnostics, fleetSnapshot,
  };
}
