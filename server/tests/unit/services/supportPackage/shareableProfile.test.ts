import { describe, expect, it } from 'vitest';
import { safeConfigProfileSchema } from '../../../../src/services/supportPackage/collectors/configSafeSchema';
import { generateSerializedSupportPackage } from '../../../../src/services/supportPackage/runner';

describe('assembled shareable support profile', () => {
  it('serializes the real admitted registry with only the strict config profile', async () => {
    const bytes = await generateSerializedSupportPackage({ only: ['config'] });
    const serialized = bytes.toString('utf8');
    const parsed = JSON.parse(serialized) as {
      collectors: Record<string, { status: string; data?: unknown }>;
      profile: string;
      version: string;
    };

    expect(parsed.version).toBe('2.0.0');
    expect(parsed.profile).toBe('shareable_aggregate');
    expect(Object.keys(parsed.collectors)).toEqual(['config']);
    expect(parsed.collectors.config?.status).toBe('ok');
    expect(safeConfigProfileSchema.safeParse(parsed.collectors.config?.data).success).toBe(true);
    expect(serialized).not.toMatch(/(?:databaseUrl|redisUrl|jwtSecret|gatewaySecret)/i);
  });

  it('assembles every admitted section through the final poisoned-byte gate', async () => {
    const secret = 'support-poison:/?=&% user wallet tx payload';
    const originalJwt = process.env.JWT_SECRET;
    const originalDiagnostics = process.env.WORKER_DIAGNOSTICS_SECRET;
    process.env.JWT_SECRET = secret;
    process.env.WORKER_DIAGNOSTICS_SECRET = `${secret}-worker`;
    try {
      const bytes = await generateSerializedSupportPackage({ collectorTimeoutMs: 100 });
      const serialized = bytes.toString('utf8');
      const parsed = JSON.parse(serialized) as {
        collectors: Record<string, unknown>;
      };

      expect(Object.keys(parsed.collectors).sort()).toEqual([
        'config',
        'notificationDeadLetters',
        'notificationEligibility',
        'notificationQueue',
        'notificationTelemetry',
        'notificationWorker',
        'notificationWorkerFleet',
      ]);
      for (const forbidden of [
        secret,
        `${secret}-worker`,
        encodeURIComponent(secret),
        Buffer.from(secret, 'utf8').toString('base64'),
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(serialized).not.toMatch(/(?:walletId|userId|txid|jobId|payload|rawError)/i);
    } finally {
      if (originalJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalJwt;
      if (originalDiagnostics === undefined) delete process.env.WORKER_DIAGNOSTICS_SECRET;
      else process.env.WORKER_DIAGNOSTICS_SECRET = originalDiagnostics;
    }
  });
});
