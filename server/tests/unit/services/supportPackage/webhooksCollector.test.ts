import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  collectorMap,
  mockListSupportPackageEndpoints,
} = vi.hoisted(() => ({
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
  mockListSupportPackageEndpoints: vi.fn(),
}));

vi.mock('../../../../src/repositories', () => ({
  webhookRepository: {
    listSupportPackageEndpoints: mockListSupportPackageEndpoints,
  },
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
  getCollectors: () => collectorMap,
}));

import '../../../../src/services/supportPackage/collectors/webhooks';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  const generatedAt = new Date('2026-05-22T00:00:00.000Z');
  return {
    anonymize: createAnonymizer('test-salt'),
    generatedAt,
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 30_000,
  } satisfies CollectorContext;
}

describe('webhooks collector', () => {
  beforeEach(() => {
    mockListSupportPackageEndpoints.mockReset();
    mockListSupportPackageEndpoints.mockResolvedValue([]);
  });

  const getCollector = () => {
    const collector = collectorMap.get('webhooks');
    if (!collector) throw new Error('webhooks collector not registered');
    return collector;
  };

  it('registers itself as webhooks', () => {
    expect(collectorMap.has('webhooks')).toBe(true);
  });

  it('returns endpoint health without leaking secrets, URLs, mapping keys, headers, or raw errors', async () => {
    mockListSupportPackageEndpoints.mockResolvedValue([{
      id: 'endpoint-real-id',
      walletId: 'wallet-real-id',
      enabled: true,
      url: 'https://hooks.example/private/path',
      eventTypes: ['wallet.transaction.received'],
      payloadProfile: 'mapped_json_v1',
      authType: 'configured_hmac_sha256',
      secretEncrypted: 'encrypted-secret-value',
      headerConfig: {
        headers: {
          'x-custom-static-header': 'secret-header-value',
        },
        hmac: {
          signatureHeader: 'x-custom-signature',
          canonical: ['method', 'path', 'bodyHash'],
        },
      },
      profileConfig: {
        body: {
          externalFieldName: { path: 'eventId' },
        },
        valuation: {
          mode: 'required',
          currency: 'USD',
        },
      },
      retryConfig: {
        initialDelayMs: 1000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
      },
      maxAttempts: 5,
      failureNotificationEnabled: true,
      lastDeliveryStatus: 'dead',
      lastDeliveredAt: null,
      deliveries: [{
        status: 'dead',
        attemptCount: 5,
        lastStatusCode: 503,
        lastError: 'Webhook endpoint returned HTTP 503 at https://hooks.example/private/path',
        createdAt: new Date('2026-05-22T01:00:00.000Z'),
      }],
    }]);

    const result = await getCollector()(makeContext());
    const serialized = JSON.stringify(result);

    expect(result.endpointCount).toBe(1);
    expect(result.enabledCount).toBe(1);
    expect((result.endpoints as any[])[0]).toMatchObject({
      id: expect.stringMatching(/^webhook-endpoint-[a-f0-9]{8}$/),
      walletId: expect.stringMatching(/^wallet-[a-f0-9]{8}$/),
      url: {
        valid: true,
        scheme: 'https',
        hostHash: expect.stringMatching(/^webhook-host-[a-f0-9]{8}$/),
        hostKind: 'dns',
        pathDepth: 2,
      },
      headerConfig: {
        staticHeaderCount: 1,
        hasConfiguredHmac: true,
        configuredHmacComponentCount: 3,
      },
      profileConfig: {
        bodyMappingFieldCount: 1,
        valuationMode: 'required',
        valuationCurrency: 'USD',
      },
      deliveryHealth: {
        sampledCount: 1,
        maxAttemptCount: 5,
        lastStatusCode: 503,
        lastErrorKind: 'http_5xx',
      },
    });
    expect(serialized).not.toContain('encrypted-secret-value');
    expect(serialized).not.toContain('secret-header-value');
    expect(serialized).not.toContain('x-custom-static-header');
    expect(serialized).not.toContain('x-custom-signature');
    expect(serialized).not.toContain('externalFieldName');
    expect(serialized).not.toContain('hooks.example');
    expect(serialized).not.toContain('/private/path');
  });

  it('summarizes invalid URLs, empty configs, host kinds, and delivery error categories', async () => {
    mockListSupportPackageEndpoints.mockResolvedValue([
      makeEndpoint({
        id: 'endpoint-invalid-url',
        walletId: 'wallet-1',
        enabled: false,
        url: 'not a url',
        eventTypes: ['wallet.transaction.received'],
        lastDeliveryStatus: null,
        deliveries: [],
      }),
      makeEndpoint({
        id: 'endpoint-loopback',
        walletId: 'wallet-1',
        url: 'http://127.0.0.1:3000/hook',
        eventTypes: ['*'],
        retryConfig: { initialDelayMs: 'bad', maxDelayMs: 5000, backoffMultiplier: Number.NaN },
        deliveries: [
          makeDelivery({ lastError: 'request timeout while sending' }),
          makeDelivery({ status: 'failed', attemptCount: 2, lastError: 'fetch failed' }),
          makeDelivery({ status: 'dead', attemptCount: 3, lastError: 'URL blocked by allowlist' }),
          makeDelivery({ status: 'dead', attemptCount: 4, lastError: 'unexpected receiver failure' }),
          makeDelivery({ status: 'dead', attemptCount: 5, lastError: 'Webhook endpoint returned HTTP 400' }),
        ],
      }),
      makeEndpoint({
        id: 'endpoint-private',
        walletId: 'wallet-2',
        url: 'https://192.168.1.20/hook',
        eventTypes: ['wallet.transaction.received'],
        deliveries: [makeDelivery({ lastError: null })],
      }),
      makeEndpoint({
        id: 'endpoint-public',
        walletId: 'wallet-3',
        url: 'https://93.184.216.34/hook',
        eventTypes: ['wallet.transaction.received'],
        deliveries: [makeDelivery({ lastError: 'network unreachable' })],
      }),
      makeEndpoint({
        id: 'endpoint-policy',
        walletId: 'wallet-4',
        url: 'https://hooks.example/policy',
        eventTypes: ['wallet.transaction.received'],
        deliveries: [makeDelivery({ lastError: 'URL blocked by allowlist' })],
      }),
      makeEndpoint({
        id: 'endpoint-other',
        walletId: 'wallet-5',
        url: 'https://hooks.example/other',
        eventTypes: ['wallet.transaction.received'],
        deliveries: [makeDelivery({ lastError: 'unexpected receiver failure' })],
      }),
      makeEndpoint({
        id: 'endpoint-http4',
        walletId: 'wallet-6',
        url: 'https://hooks.example/http4',
        eventTypes: ['wallet.transaction.received'],
        deliveries: [makeDelivery({ lastError: 'Webhook endpoint returned HTTP 400' })],
      }),
      makeEndpoint({
        id: 'endpoint-localhost',
        walletId: 'wallet-7',
        url: 'http://localhost:8080/hook',
        eventTypes: ['wallet.transaction.received'],
        deliveries: undefined,
      }),
    ]);

    const result = await getCollector()(makeContext());
    const endpoints = result.endpoints as any[];

    expect(result.endpointCount).toBe(8);
    expect(result.enabledCount).toBe(7);
    expect(endpoints[0].url).toEqual({ valid: false });
    expect(endpoints[0].deliveryHealth).toMatchObject({
      sampledCount: 0,
      lastStatusCode: null,
      lastErrorKind: null,
      newestCreatedAt: null,
    });
    expect(endpoints[1]).toMatchObject({
      url: { hostKind: 'loopback' },
      usesWildcardEvents: true,
      retryConfig: {
        initialDelayMs: null,
        maxDelayMs: 5000,
        backoffMultiplier: null,
      },
      deliveryHealth: {
        maxAttemptCount: 5,
        lastErrorKind: 'timeout',
      },
    });
    expect(endpoints[2].url.hostKind).toBe('private-ip');
    expect(endpoints[3].url.hostKind).toBe('public-ip');
    expect(endpoints[3].deliveryHealth.lastErrorKind).toBe('network');
    expect(endpoints[4].deliveryHealth.lastErrorKind).toBe('endpoint_policy');
    expect(endpoints[5].deliveryHealth.lastErrorKind).toBe('other');
    expect(endpoints[6].deliveryHealth.lastErrorKind).toBe('http_4xx');
    expect(endpoints[7].url.hostKind).toBe('loopback');
    expect(endpoints[7].deliveryHealth.sampledCount).toBe(0);
  });
});

function makeEndpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'endpoint-real-id',
    walletId: 'wallet-real-id',
    enabled: true,
    url: 'https://hooks.example/path',
    eventTypes: ['wallet.transaction.received'],
    payloadProfile: 'sanctuary_wallet_event_v1',
    authType: 'none',
    secretEncrypted: null,
    headerConfig: null,
    profileConfig: null,
    retryConfig: null,
    maxAttempts: 5,
    failureNotificationEnabled: true,
    lastDeliveryStatus: 'failed',
    lastDeliveredAt: null,
    deliveries: [],
    ...overrides,
  };
}

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    status: 'failed',
    attemptCount: 1,
    lastStatusCode: null,
    lastError: 'Webhook endpoint returned HTTP 503',
    createdAt: new Date('2026-05-22T01:00:00.000Z'),
    ...overrides,
  };
}
