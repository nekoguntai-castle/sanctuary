import { beforeEach, describe, expect, it, vi } from 'vitest';

const { collectorMap, mockGetConfig } = vi.hoisted(() => ({
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
  mockGetConfig: vi.fn(),
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

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerShareableCollector: (
    name: string,
    definition: { collect: (ctx: any) => Promise<Record<string, unknown>> },
  ) => {
    collectorMap.set(name, definition.collect);
  },
}));

import '../../../../src/services/supportPackage/collectors/config';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import { safeConfigProfileSchema } from '../../../../src/services/supportPackage/collectors/configSafeSchema';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  const generatedAt = new Date();
  return {
    anonymize: createAnonymizer('test-salt'),
    generatedAt,
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 30_000,
  } satisfies CollectorContext;
}

function makeConfig() {
  return {
    server: {
      nodeEnv: 'production',
      port: 3001,
      apiUrl: 'https://api.internal.invalid',
      clientUrl: 'https://client.invalid',
    },
    bitcoin: {
      network: 'mainnet',
      rpc: { host: 'bitcoin', port: 8332, user: 'rpc-user', password: 'rpc-password' },
      electrum: { host: 'electrum', port: 50002, protocol: 'ssl' },
    },
    database: { url: 'postgresql://user:password@database:5432/sanctuary' },
    redis: { url: 'redis://:password@redis:6379', enabled: true },
    worker: {
      healthUrl: 'http://worker:3002/ready',
      healthPort: 3002,
      healthTimeoutMs: 5000,
      healthCheckIntervalMs: 30000,
      concurrency: 5,
    },
    sync: { electrumSubscriptionsEnabled: true },
    features: { telegramNotifications: false },
  };
}

describe('config collector', () => {
  const getCollector = () => {
    const collector = collectorMap.get('config');
    if (!collector) throw new Error('config collector not registered');
    return collector;
  };

  beforeEach(() => {
    mockGetConfig.mockReset();
    mockGetConfig.mockReturnValue(makeConfig());
  });

  it('registers itself as config', () => {
    expect(collectorMap.has('config')).toBe(true);
  });

  it('returns only the reviewed notification-support profile', async () => {
    const result = await getCollector()(makeContext());

    expect(result).toEqual({
      environment: 'production',
      bitcoinNetwork: 'mainnet',
      notificationPipeline: {
        databaseConfigured: true,
        redisConfigured: true,
        workerHealthConfigured: true,
        electrumSubscriptionsEnabled: true,
        telegramFeatureDefaultEnabled: false,
      },
    });
  });

  it('rejects unreviewed fields at every schema boundary', () => {
    const profile = {
      environment: 'production',
      bitcoinNetwork: 'mainnet',
      notificationPipeline: {
        databaseConfigured: true,
        redisConfigured: true,
        workerHealthConfigured: true,
        electrumSubscriptionsEnabled: true,
        telegramFeatureDefaultEnabled: true,
      },
    };

    expect(safeConfigProfileSchema.safeParse({ ...profile, databaseUrl: 'poison' }).success).toBe(
      false,
    );
    expect(
      safeConfigProfileSchema.safeParse({
        ...profile,
        notificationPipeline: { ...profile.notificationPipeline, workerUrl: 'poison' },
      }).success,
    ).toBe(false);
  });

  it('reports only the static Telegram default and does not claim effective state', async () => {
    mockGetConfig.mockReturnValue({
      ...makeConfig(),
      features: { telegramNotifications: true },
    });

    const result = await getCollector()(makeContext());

    expect(result.notificationPipeline).toMatchObject({
      telegramFeatureDefaultEnabled: true,
    });
    expect(JSON.stringify(result)).not.toContain('effective');
  });

  it('omits flat and nested aliases plus raw and encoded sentinel URIs', async () => {
    const rawSentinelUri = 'postgresql://support:phase1-secret@private-db:5432/sanctuary?sslmode=require';
    const encodedSentinelUri = encodeURIComponent(rawSentinelUri);
    const config = makeConfig();

    mockGetConfig.mockReturnValue({
      ...config,
      databaseUrl: rawSentinelUri,
      redisUrl: encodedSentinelUri,
      jwtSecret: 'phase1-secret',
      gatewaySecret: 'phase1-gateway-secret',
      database: {
        url: rawSentinelUri,
        databaseUrl: encodedSentinelUri,
        credentials: { username: 'support', password: 'phase1-secret' },
      },
      redis: {
        enabled: true,
        url: `redis://:${encodedSentinelUri}@private-redis:6379`,
        connectionString: rawSentinelUri,
      },
      worker: {
        ...config.worker,
        healthUrl: `https://worker.invalid/ready?dsn=${encodedSentinelUri}`,
      },
      unexpectedAliases: {
        database_url: rawSentinelUri,
        nested: { dsn: encodedSentinelUri },
      },
    });

    const result = await getCollector()(makeContext());
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      environment: 'production',
      bitcoinNetwork: 'mainnet',
      notificationPipeline: {
        databaseConfigured: true,
        redisConfigured: true,
        workerHealthConfigured: true,
        electrumSubscriptionsEnabled: true,
        telegramFeatureDefaultEnabled: false,
      },
    });
    expect(serialized).not.toContain(rawSentinelUri);
    expect(serialized).not.toContain(encodedSentinelUri);
    expect(serialized).not.toContain('phase1-secret');
    expect(serialized).not.toContain('private-db');
    expect(serialized).not.toContain('private-redis');
    expect(serialized).not.toContain('databaseUrl');
    expect(serialized).not.toContain('connectionString');
    expect(serialized).not.toContain('unexpectedAliases');
  });

  it('derives false configuration-presence facts without emitting source values', async () => {
    const config = makeConfig();
    mockGetConfig.mockReturnValue({
      ...config,
      database: { url: '' },
      redis: { url: '', enabled: false },
      worker: { ...config.worker, healthUrl: '' },
      sync: { electrumSubscriptionsEnabled: false },
    });

    const result = await getCollector()(makeContext());

    expect(result.notificationPipeline).toEqual({
      databaseConfigured: false,
      redisConfigured: false,
      workerHealthConfigured: false,
      electrumSubscriptionsEnabled: false,
      telegramFeatureDefaultEnabled: false,
    });
  });
});
