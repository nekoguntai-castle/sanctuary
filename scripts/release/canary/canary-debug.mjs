#!/usr/bin/env node
// Interactive debug driver for the release-candidate canary.
//
// Unlike canary-selftest.mjs this MUTATES: it POSTs a real sync for the
// least-recently-synced mainnet wallet and prints the raw sync status, the POST
// response, and the network sync status. Use it to see what the backend
// actually answers when a probe run stalls -- notably the activation gate,
// which answers 200 success:true with requested:0 merged:0 rejected:<fleet>
// for roughly two drain horizons after any worker restart.
//
// Do not run it during a canary window; it perturbs the fleet the receipt
// describes.
import path from 'node:path';
import { createCanaryRuntime, timedFetch } from './lib/canary-runtime.mjs';

const ENV_FILE = process.env.SANCTUARY_ENV_FILE || path.join(process.env.HOME, '.config/sanctuary/sanctuary.env');
const PROJECT = process.env.COMPOSE_PROJECT || 'sanctuary';

const { psql, containerIps, mintAccessToken } = createCanaryRuntime({ envFile: ENV_FILE, project: PROJECT });

const backendIps = await containerIps(`${PROJECT}-backend-1`);
let backendBase = null;
for (const ip of backendIps) {
  const r = await timedFetch(`http://${ip}:3001/api/v1/health/live`, {}, 1500);
  if (r.ok) { backendBase = `http://${ip}:3001`; break; }
}
if (!backendBase) { console.error('backend unreachable'); process.exit(2); }

const [[adminId, adminName, sv]] = await psql('select id, username, "sessionVersion" from users where "isAdmin" = true limit 1');
const token = mintAccessToken({ userId: adminId, username: adminName, sessionVersion: Number(sv) });
const h = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };

const [[wallet]] = await psql('select id from wallets where network=\'mainnet\' order by "lastSyncedAt" limit 1');
const st = await timedFetch(`${backendBase}/api/v1/sync/status/${wallet}`, { headers: h }, 10000);
console.log('status', st.status, st.text.slice(0, 600));
const posted = await timedFetch(`${backendBase}/api/v1/sync/wallet/${wallet}`, { method: 'POST', headers: h, body: '{}' }, 30000);
console.log('POST sync/wallet', posted.status, posted.text.slice(0, 800));
const net = await timedFetch(`${backendBase}/api/v1/sync/network/mainnet/status`, { headers: h }, 10000);
console.log('network status', net.status, net.text.slice(0, 400));
