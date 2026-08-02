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
});
