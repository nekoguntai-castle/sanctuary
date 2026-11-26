import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('P3-1 operational config consolidation & Electrum subscription lock invariants', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('clamps ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS strictly below ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS', async () => {
    process.env.ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS = '10000';
    process.env.ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS = '60000';
    process.env.ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS = '3000';

    const {
      ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS,
      ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS,
      ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS,
    } = await import('../../../src/worker/electrumManager/types');

    expect(ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS).toBe(10_000);
    expect(ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS).toBeLessThan(ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS);
    expect(ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS).toBeGreaterThanOrEqual(1_000);
    expect(ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS).toBe(3_000);
  });

  it('falls back for non-finite or below-minimum lock timings', async () => {
    process.env.ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS = 'Infinity';
    process.env.ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS = '999';
    delete process.env.ELECTRUM_SUBSCRIPTION_LOCK_RETRY_MS;
    const { loadElectrumSubscriptionLockConfig } = await import('../../../src/config/operationalEnv');
    expect(loadElectrumSubscriptionLockConfig()).toEqual({ ttlMs: 120_000, refreshMs: 60_000, retryMs: 15_000 });
  });

  it('uses operational defaults when optional settings are missing or blank', async () => {
    delete process.env.GRAFANA_PASSWORD;
    delete process.env.CONSOLE_GATEWAY_TIMEOUT_MS;
    delete process.env.WORKER_HEALTH_MONITOR_ENABLED;
    process.env.WORKER_REPLICA_ID = ' ';
    const env = await import('../../../src/config/operationalEnv');
    expect(env.getWorkerReplicaId()).toBeUndefined();
    expect(env.getGrafanaPassword()).toBeNull();
    expect(env.getConsoleGatewayTimeoutMs()).toBe(125_000);
    expect(env.isWorkerHealthMonitorEnabled()).toBe(true);
  });

  it('exposes operational env getters from config/operationalEnv', async () => {
    process.env.BACKUP_DIR = '/custom/backups';
    process.env.WORKER_HEALTH_MONITOR_ENABLED = 'false';
    process.env.CONSOLE_GATEWAY_TIMEOUT_MS = '45000';
    process.env.WORKER_REPLICA_ID = '  worker-2  ';
    process.env.GRAFANA_PASSWORD = 'secret-grafana-password';
    process.env.ENCRYPTION_KEY = 'enc-key';
    process.env.ENCRYPTION_SALT = 'enc-salt';

    const operationalEnv = await import('../../../src/config/operationalEnv');

    expect(operationalEnv.getBackupDir()).toBe('/custom/backups');
    expect(operationalEnv.isWorkerHealthMonitorEnabled()).toBe(false);
    expect(operationalEnv.getConsoleGatewayTimeoutMs()).toBe(45_000);
    expect(operationalEnv.getWorkerReplicaId()).toBe('worker-2');
    expect(operationalEnv.getGrafanaPassword()).toBe('secret-grafana-password');
    expect(operationalEnv.getEncryptionKeyMaterial()).toEqual({
      encryptionKey: 'enc-key',
      encryptionSalt: 'enc-salt',
    });
  });
});
