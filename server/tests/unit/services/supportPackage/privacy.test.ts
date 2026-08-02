import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildSupportPackageSchema,
  MAX_SUPPORT_PACKAGE_BYTES,
  serializePrivacySafeArtifact,
  serializeShareablePackage,
} from '../../../../src/services/supportPackage/privacy';
import type { SupportPackage } from '../../../../src/services/supportPackage/types';

const emptyPackage: SupportPackage = {
  version: '2.0.0',
  profile: 'shareable_aggregate',
  generatedAt: '2026-08-02T00:00:00.000Z',
  serverVersion: '0.8.58',
  collectors: {},
  meta: { totalDurationMs: 0, succeeded: [], failed: [] },
};

describe('support package privacy boundary', () => {
  it('rejects unknown envelope and collector keys', () => {
    const packageSchema = buildSupportPackageSchema({ safe: z.object({ ok: z.boolean() }).strict() });
    expect(() => packageSchema.parse({ ...emptyPackage, unexpected: true })).toThrow();
    expect(() => packageSchema.parse({
      ...emptyPackage,
      collectors: { legacy: { arbitrary: 'data' } },
    })).toThrow();
  });

  it.each([
    'postgres://user:credential@database.internal/sanctuary',
    'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    'a'.repeat(64),
    '"databaseUrl":"private"',
  ])('rejects a forbidden serialized sentinel', (sentinel) => {
    const poisoned = { ...emptyPackage, serverVersion: sentinel };
    expect(() => serializeShareablePackage(poisoned)).toThrow();
  });

  it('enforces the final byte budget', () => {
    const oversized = { ...emptyPackage, serverVersion: 'v'.repeat(MAX_SUPPORT_PACKAGE_BYTES) };
    expect(() => serializeShareablePackage(oversized)).toThrow();
  });

  it('maps impossible serialization values to a fixed privacy error', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const invalidPackage = {
      ...emptyPackage,
      collectors: circular,
    } as SupportPackage;

    expect(() => serializeShareablePackage(invalidPackage))
      .toThrow('support_package_serialization_failed');
  });

  it.each([
    (value: string) => value,
    (value: string) => encodeURIComponent(value),
    (value: string) => Buffer.from(value, 'utf8').toString('base64'),
  ])('rejects known configuration secrets and their encodings', (encode) => {
    const original = process.env.JWT_SECRET;
    const secret = 'opaque-value-9137:/?=';
    process.env.JWT_SECRET = secret;
    try {
      expect(() => serializeShareablePackage({
        ...emptyPackage,
        serverVersion: encode(secret),
      })).toThrow('support_package_privacy_policy_violation');
    } finally {
      if (original === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = original;
    }
  });

  it('does not treat short configuration markers as secret values', () => {
    const original = process.env.BITCOIN_RPC_USER;
    process.env.BITCOIN_RPC_USER = 'rpc';
    try {
      expect(serializeShareablePackage(emptyPackage)).toBeInstanceOf(Buffer);
    } finally {
      if (original === undefined) delete process.env.BITCOIN_RPC_USER;
      else process.env.BITCOIN_RPC_USER = original;
    }
  });

  it('rejects the dedicated worker diagnostics credential', () => {
    const original = process.env.WORKER_DIAGNOSTICS_SECRET;
    const secret = 'worker-diagnostics-credential-sentinel';
    process.env.WORKER_DIAGNOSTICS_SECRET = secret;
    try {
      expect(() => serializeShareablePackage({
        ...emptyPackage,
        serverVersion: secret,
      })).toThrow('support_package_privacy_policy_violation');
    } finally {
      if (original === undefined) delete process.env.WORKER_DIAGNOSTICS_SECRET;
      else process.env.WORKER_DIAGNOSTICS_SECRET = original;
    }
  });

  it('ignores empty transient selectors while scanning non-empty selector encodings', () => {
    const selector = 'selector-private-value';
    expect(() => serializePrivacySafeArtifact({ safe: true }, ['', selector])).not.toThrow();
    expect(() => serializePrivacySafeArtifact({ value: selector }, ['', selector]))
      .toThrow('support_package_privacy_policy_violation');
  });
});
