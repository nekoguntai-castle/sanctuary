import { describe, it, expect, vi } from 'vitest';

const { collectorMap, mockGetConfig, mockGetAllFlags } = vi.hoisted(() => ({
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
  mockGetConfig: vi.fn(),
  mockGetAllFlags: vi.fn(),
}));

vi.mock('../../../../src/config', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../src/services/featureFlagService', () => ({
  featureFlagService: {
    getAllFlags: (...args: unknown[]) => mockGetAllFlags(...args),
  },
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/config';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('config collector', () => {
  const getCollector = () => {
    const c = collectorMap.get('config');
    if (!c) throw new Error('config collector not registered');
    return c;
  };

  it('registers itself as config', () => {
    expect(collectorMap.has('config')).toBe(true);
  });

  it('redacts database.url and redis.url', async () => {
    mockGetConfig.mockReturnValue({
      server: { port: 3001, nodeEnv: 'production' },
      database: { url: 'postgresql://user:secret@db:5432/sanctuary' },
      redis: { url: 'redis://:password@redis:6379' },
      security: { jwt: { secret: 'super-secret-jwt-key', expiresIn: '1h' } },
    });

    const result = await getCollector()(makeContext());
    const db = result.database as Record<string, unknown>;
    const redis = result.redis as Record<string, unknown>;
    expect(db.url).toBe('[REDACTED]');
    expect(redis.url).toBe('[REDACTED]');
  });

  it('redacts jwt field via redactDeep', async () => {
    mockGetConfig.mockReturnValue({
      server: { port: 3001, nodeEnv: 'production' },
      database: { url: 'postgresql://user:secret@db:5432/sanctuary' },
      redis: { url: 'redis://:password@redis:6379' },
      security: { jwt: { secret: 'super-secret-jwt-key', expiresIn: '1h' } },
    });

    const result = await getCollector()(makeContext());
    const security = result.security as Record<string, unknown>;
    // 'jwt' is in SENSITIVE_FIELDS, so the entire field is redacted
    expect(security.jwt).toBe('[REDACTED]');
  });

  it('preserves non-sensitive values', async () => {
    mockGetConfig.mockReturnValue({
      server: { port: 3001, nodeEnv: 'production' },
      database: { url: 'postgresql://user:secret@db:5432/sanctuary' },
      redis: { url: 'redis://:password@redis:6379' },
      security: { jwt: { secret: 'super-secret-jwt-key', expiresIn: '1h' } },
    });

    const result = await getCollector()(makeContext());
    const server = result.server as Record<string, unknown>;
    expect(server.port).toBe(3001);
    expect(server.nodeEnv).toBe('production');
  });

  it('skips database url redaction when config has no database key', async () => {
    mockGetConfig.mockReturnValue({
      server: { port: 3001, nodeEnv: 'production' },
      security: { jwt: { secret: 'super-secret-jwt-key', expiresIn: '1h' } },
    });

    const result = await getCollector()(makeContext());

    // database and redis keys should not exist in output
    expect(result.database).toBeUndefined();
    expect(result.redis).toBeUndefined();
    // non-sensitive values still preserved
    expect((result.server as Record<string, unknown>).port).toBe(3001);
  });

  it('skips redis url redaction when config has no redis key', async () => {
    mockGetConfig.mockReturnValue({
      server: { port: 3001, nodeEnv: 'production' },
      database: { url: 'postgresql://user:secret@db:5432/sanctuary' },
      security: { jwt: { secret: 'super-secret-jwt-key', expiresIn: '1h' } },
    });

    const result = await getCollector()(makeContext());

    // database should be redacted, redis should not exist
    expect((result.database as Record<string, unknown>).url).toBe('[REDACTED]');
    expect(result.redis).toBeUndefined();
  });

  it('overlays runtime feature flags from database over static config defaults', async () => {
    mockGetConfig.mockReturnValue({
      server: { port: 3001 },
      features: {
        telegramNotifications: false,
        aiAssistant: false,
        experimental: { taprootAddresses: false },
      },
    });
    mockGetAllFlags.mockResolvedValue([
      { key: 'telegramNotifications', enabled: true },
      { key: 'aiAssistant', enabled: true },
      { key: 'experimental.taprootAddresses', enabled: true },
    ]);

    const result = await getCollector()(makeContext());
    const features = result.features as Record<string, unknown>;

    expect(features.telegramNotifications).toBe(true);
    expect(features.aiAssistant).toBe(true);
    expect((features.experimental as Record<string, unknown>).taprootAddresses).toBe(true);
  });

  it('falls back to static config when featureFlagService throws', async () => {
    mockGetConfig.mockReturnValue({
      server: { port: 3001 },
      features: {
        telegramNotifications: false,
        experimental: { taprootAddresses: false },
      },
    });
    mockGetAllFlags.mockRejectedValue(new Error('service not initialized'));

    const result = await getCollector()(makeContext());
    const features = result.features as Record<string, unknown>;

    expect(features.telegramNotifications).toBe(false);
  });
});
