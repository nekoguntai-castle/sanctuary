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
import path from 'node:path';
import {
  createCanaryRuntime,
  parseJsonOr,
  parseMetrics,
  readCgroup,
  timedFetch,
  timedHttpsInsecure,
} from './lib/canary-runtime.mjs';

const ENV_FILE = process.env.SANCTUARY_ENV_FILE || path.join(process.env.HOME, '.config/sanctuary/sanctuary.env');
const UI_URL = process.env.CANARY_UI_URL || 'https://localhost:8443/';
const PROJECT = process.env.COMPOSE_PROJECT || 'sanctuary';

const {
  psql,
  containerIps,
  inspectContainer,
  mintAccessToken,
  diagnostics,
  fleetSnapshot,
} = createCanaryRuntime({ envFile: ENV_FILE, project: PROJECT });

const backendIps = await containerIps(`${PROJECT}-backend-1`);
let backendBase = null;
for (const ip of backendIps) {
  const r = await timedFetch(`http://${ip}:3001/api/v1/health/live`, {}, 1500);
  if (r.ok) { backendBase = `http://${ip}:3001`; break; }
}
const [workerIp] = await containerIps(`${PROJECT}-worker-1`);
if (!backendBase || !workerIp) { console.error('backend or worker unreachable'); process.exit(2); }

const [[adminId, adminName, sv]] = await psql('select id, username, "sessionVersion" from users where "isAdmin" = true limit 1');
const token = mintAccessToken({ userId: adminId, username: adminName, sessionVersion: Number(sv) });
const h = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

const wallets = await timedFetch(`${backendBase}/api/v1/wallets`, { headers: h }, 10000);
const walletCount = parseJsonOr(wallets.text)?.length ?? null;
const status = await timedFetch(`${backendBase}/api/v1/bitcoin/status?network=mainnet`, { headers: h }, 10000);
const parsedStatus = parseJsonOr(status.text);
const op = parsedStatus ? (parsedStatus.operational ?? 'absent') : null;
const [[someWallet]] = await psql("select id from wallets where network='mainnet' limit 1");
const logs = await timedFetch(`${backendBase}/api/v1/sync/logs/${someWallet}`, { headers: h }, 5000);
const logsLen = parseJsonOr(logs.text)?.logs?.length ?? null;
const diag = await diagnostics(`http://${workerIp}:3002`);
const metrics = await timedFetch(`${backendBase}/metrics`, {}, 2000);
const parsed = parseMetrics(metrics.text);
const fleet = await fleetSnapshot();
const ui = await timedHttpsInsecure(UI_URL, 1000);
const worker = await inspectContainer(`${PROJECT}-worker-1`);

console.log(JSON.stringify({
  backendBase,
  workerIp,
  walletsHttp: wallets.status,
  walletCount,
  statusHttp: status.status,
  operational: op === 'absent' ? 'absent' : (op ? Object.keys(op) : null),
  logsHttp: logs.status,
  logsLen,
  diag,
  metrics: { families: [...parsed.families], activeStageAge: parsed.activeStageAge, fallback: parsed.fallback },
  fleet: fleet.summary,
  ui,
  worker: {
    ...worker,
    peak: readCgroup(worker.containerId, 'memory.peak'),
    max: readCgroup(worker.containerId, 'memory.max'),
  },
}, null, 1));
