import { setTimeout as sleep } from 'node:timers/promises';
import { ApiError } from './api-client.mjs';
import { generatePassword } from './env.mjs';

const SYNC_TIMEOUT_MS = 5 * 60_000;
const SYNC_POLL_MS = 3_000;

const byName = (items, name) => items.find((item) => item.name === name);

async function ensureUsers(api, manifest, log) {
  const existing = await api.get('/admin/users');
  const ids = new Map(existing.map((u) => [u.username, u.id]));
  for (const user of manifest.users) {
    if (ids.has(user.username)) continue;
    const created = await api.post('/admin/users', { ...user, password: generatePassword() }); // never used to log in
    ids.set(user.username, created.id);
    log(`created user ${user.username}`);
  }
  return ids;
}

async function ensureGroups(api, manifest, userIds, log) {
  const existing = await api.get('/admin/groups');
  for (const group of manifest.groups) {
    if (byName(existing, group.name)) continue;
    await api.post('/admin/groups', {
      name: group.name,
      description: group.description,
      purpose: group.purpose,
      memberIds: group.members.map((m) => userIds.get(m)).filter(Boolean),
    });
    log(`created group ${group.name}`);
  }
}

async function waitForSync(api, walletId, name, log) {
  const deadline = Date.now() + SYNC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // SyncStatus (shared/types/domain.ts): success | failed | partial | retrying.
    const { syncInProgress, syncStatus } = await api.get(`/sync/status/${walletId}`);
    if (!syncInProgress && (syncStatus === 'success' || syncStatus === 'partial')) return;
    if (!syncInProgress && syncStatus === 'failed') throw new Error(`sync failed for ${name}`);
    await sleep(SYNC_POLL_MS);
  }
  log(`warning: ${name} still syncing after ${SYNC_TIMEOUT_MS / 1000}s; rerun seed to finish labels`);
}

export async function ensureWallets(api, manifest, log) {
  const wallets = new Map((await api.get('/wallets')).map((w) => [w.name, w.id]));
  for (const wallet of manifest.wallets) {
    if (!wallets.has(wallet.name)) {
      // Imported one at a time so public Electrum is not hit with parallel full syncs.
      const result = await api.post('/wallets/import', {
        data: wallet.descriptor,
        name: wallet.name,
        network: wallet.network,
      });
      wallets.set(wallet.name, result.wallet.id);
      log(`imported ${wallet.name}`);
    }
    await waitForSync(api, wallets.get(wallet.name), wallet.name, log);
  }
  return wallets;
}

/**
 * Wallet import creates watch-only devices keyed by fingerprint; the seed only
 * names them. Hardware models are not assigned: the wallet-safety capability
 * gate (shared/constants/hardwareWalletCapabilities.ts) refuses model-backed
 * devices until physical-device evidence exists, and the demo shows that truthfully.
 */
async function ensureDeviceLabels(api, manifest, log) {
  const devices = await api.get('/devices');
  for (const spec of manifest.devices) {
    const device = devices.find((d) => d.fingerprint === spec.fingerprint);
    if (!device) {
      log(`warning: no device with fingerprint ${spec.fingerprint}`);
    } else if (device.label !== spec.label) {
      await api.patch(`/devices/${device.id}`, { label: spec.label });
      log(`named device ${spec.label}`);
    }
  }
}

async function ensureShares(api, manifest, walletIds, userIds, log) {
  for (const wallet of manifest.wallets) {
    for (const share of wallet.shares ?? []) {
      // Idempotent server-side: an existing share is updated in place.
      const result = await api.post(`/wallets/${walletIds.get(wallet.name)}/share/user`, {
        targetUserId: userIds.get(share.username),
        role: share.role,
      });
      log(`${wallet.name} → ${share.username} (${share.role}): ${result.message}`);
    }
  }
}

async function ensureWalletLabels(api, walletId, labels) {
  const existing = await api.get(`/wallets/${walletId}/labels`);
  const txLabels = new Map();
  for (const spec of labels) {
    const label = byName(existing, spec.name)
      ?? await api.post(`/wallets/${walletId}/labels`, { name: spec.name, color: spec.color });
    for (const txid of spec.txids) {
      const ids = txLabels.get(txid) ?? [];
      ids.push(label.id);
      txLabels.set(txid, ids);
    }
  }
  return txLabels;
}

async function ensureLabels(api, manifest, walletIds, log) {
  for (const wallet of manifest.wallets) {
    if (!wallet.labels?.length) continue;
    const walletId = walletIds.get(wallet.name);
    const txLabels = await ensureWalletLabels(api, walletId, wallet.labels);
    for (const [txid, labelIds] of txLabels) {
      let tx;
      try {
        tx = await api.get(`/wallets/${walletId}/transactions/${txid}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          log(`warning: ${wallet.name} has no transaction ${txid.slice(0, 12)}…; label skipped`);
          continue;
        }
        throw error;
      }
      // PUT replaces the transaction's whole label set, so reruns converge — and any
      // label added by hand in the UI to these seeded transactions is dropped.
      await api.put(`/transactions/${tx.id}/labels`, { labelIds });
    }
    log(`labelled ${txLabels.size} transaction(s) in ${wallet.name}`);
  }
}

/** Instance-wide flags the documented screens need; reset restores their defaults. */
async function ensureFeatureFlags(api, manifest, log) {
  for (const key of manifest.featureFlags ?? []) {
    const flag = await api.get(`/admin/features/${key}`);
    if (flag.enabled) continue;
    await api.patch(`/admin/features/${key}`, { enabled: true, reason: 'demo instance' });
    log(`enabled feature flag ${key}`);
  }
}

async function ensureAgents(api, manifest, userId, walletIds, log) {
  const existing = await api.get('/admin/agents');
  for (const { fundingWallet, operationalWallet, ...agent } of manifest.agents ?? []) {
    if (byName(existing, agent.name)) continue;
    await api.post('/admin/agents', {
      ...agent,
      userId,
      fundingWalletId: walletIds.get(fundingWallet),
      operationalWalletId: walletIds.get(operationalWallet),
    });
    log(`registered agent ${agent.name}`);
  }
}

export async function seed(api, manifest, log) {
  await api.patch('/auth/me/preferences', manifest.demoUser.preferences);
  const userIds = await ensureUsers(api, manifest, log);
  await ensureGroups(api, manifest, userIds, log);
  const walletIds = await ensureWallets(api, manifest, log);
  await ensureDeviceLabels(api, manifest, log);
  await ensureShares(api, manifest, walletIds, userIds, log);
  await ensureLabels(api, manifest, walletIds, log);
  await ensureFeatureFlags(api, manifest, log);
  const me = await api.get('/auth/me');
  await ensureAgents(api, manifest, me.id, walletIds, log);
}

export async function status(api, log) {
  const wallets = await api.get('/wallets');
  if (wallets.length === 0) log('no wallets (run: demo.mjs seed)');
  for (const w of wallets) {
    log(`${w.name.padEnd(28)} ${w.type.padEnd(10)} ${String(w.balance).padStart(10)} sats  sync=${w.lastSyncStatus ?? '-'}${w.syncInProgress ? ' (running)' : ''}`);
  }
  const devices = await api.get('/devices');
  log(`${devices.length} device(s), ${wallets.length} wallet(s)`);
}

async function deleteEach(items, remove, describe, log) {
  for (const item of items) {
    await remove(item);
    log(`deleted ${describe(item)}`);
  }
}

/**
 * Removes only what the manifest seeds: its agents, its feature flags (back to
 * their defaults), its wallets (by name, owned by the demo login), their devices
 * (by fingerprint), and its users and groups. Never the
 * stack, volumes, or anything else the account can see.
 */
export async function reset(api, manifest, log) {
  const agentNames = new Set((manifest.agents ?? []).map((a) => a.name));
  const agents = (await api.get('/admin/agents')).filter((a) => agentNames.has(a.name));
  await deleteEach(agents, (a) => api.delete(`/admin/agents/${a.id}`), (a) => `agent ${a.name}`, log);

  for (const key of manifest.featureFlags ?? []) {
    await api.post(`/admin/features/${key}/reset`);
    log(`reset feature flag ${key}`);
  }

  const walletNames = new Set(manifest.wallets.map((w) => w.name));
  const wallets = (await api.get('/wallets')).filter((w) => w.userRole === 'owner' && walletNames.has(w.name));
  await deleteEach(wallets, (w) => api.delete(`/wallets/${w.id}`), (w) => `wallet ${w.name}`, log);

  const fingerprints = new Set(manifest.devices.map((d) => d.fingerprint));
  const devices = (await api.get('/devices')).filter((d) => d.isOwner && fingerprints.has(d.fingerprint));
  await deleteEach(devices, (d) => api.delete(`/devices/${d.id}`), (d) => `device ${d.label}`, log);

  const groupNames = new Set(manifest.groups.map((g) => g.name));
  const groups = (await api.get('/admin/groups')).filter((g) => groupNames.has(g.name));
  await deleteEach(groups, (g) => api.delete(`/admin/groups/${g.id}`), (g) => `group ${g.name}`, log);

  const usernames = new Set(manifest.users.map((u) => u.username));
  const users = (await api.get('/admin/users')).filter((u) => usernames.has(u.username));
  await deleteEach(users, (u) => api.delete(`/admin/users/${u.id}`), (u) => `user ${u.username}`, log);
}
