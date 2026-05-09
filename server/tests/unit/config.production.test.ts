import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('production config validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://sanctuary:test-password@localhost:5432/sanctuary',
      ENCRYPTION_KEY: 'test-encryption-key-32-chars-long!',
      ENCRYPTION_SALT: 'unique-production-salt',
      GATEWAY_SECRET: 'test-gateway-secret-32-chars-long',
      JWT_SECRET: 'test-jwt-secret-for-config-32-chars',
      WORKER_HEALTH_URL: 'http://worker:3002/ready',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('rejects production config without ENCRYPTION_SALT', async () => {
    delete process.env.ENCRYPTION_SALT;

    await expect(import('../../src/config')).rejects.toThrow('ENCRYPTION_SALT is required in production');
  });

  it('rejects the legacy default ENCRYPTION_SALT in production', async () => {
    process.env.ENCRYPTION_SALT = 'sanctuary-node-config';

    await expect(import('../../src/config')).rejects.toThrow('legacy sanctuary-node-config default is not allowed');
  });

  it('accepts a unique production ENCRYPTION_SALT', async () => {
    const { getConfig } = await import('../../src/config');

    expect(getConfig().security.encryptionSalt).toBe('unique-production-salt');
  });
});
