import { describe, it, expect, vi } from 'vitest';

const { collectorMap } = vi.hoisted(() => ({
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/config', () => ({
  getConfig: () => ({
    server: { port: 3001, nodeEnv: 'production' },
    database: { url: 'postgresql://user:secret@db:5432/sanctuary' },
    redis: { url: 'redis://:password@redis:6379' },
    security: { jwt: { secret: 'super-secret-jwt-key', expiresIn: '1h' } },
  }),
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
    const result = await getCollector()(makeContext());
    const db = result.database as Record<string, unknown>;
    const redis = result.redis as Record<string, unknown>;
    expect(db.url).toBe('[REDACTED]');
    expect(redis.url).toBe('[REDACTED]');
  });

  it('redacts jwt field via redactDeep', async () => {
    const result = await getCollector()(makeContext());
    const security = result.security as Record<string, unknown>;
    // 'jwt' is in SENSITIVE_FIELDS, so the entire field is redacted
    expect(security.jwt).toBe('[REDACTED]');
  });

  it('preserves non-sensitive values', async () => {
    const result = await getCollector()(makeContext());
    const server = result.server as Record<string, unknown>;
    expect(server.port).toBe(3001);
    expect(server.nodeEnv).toBe('production');
  });
});
