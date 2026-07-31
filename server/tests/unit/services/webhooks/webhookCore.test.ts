import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WEBHOOK_AUTH_TYPE_BEARER,
  WEBHOOK_AUTH_TYPE_CONFIGURED_HMAC_SHA256,
  WEBHOOK_AUTH_TYPE_HMAC_SHA256,
  WEBHOOK_PAYLOAD_PROFILE_GENERIC,
  WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON,
} from '@sanctuary/shared/constants/webhooks';
import type { WebhookEndpoint } from '../../../../src/generated/prisma/client';
import { getFilterConfig, getRetryConfig } from '../../../../src/services/webhooks/config';
import { validateWebhookEndpointUrl } from '../../../../src/services/webhooks/endpointPolicy';
import { genericWebhookPayloadProfile } from '../../../../src/services/webhooks/payloadProfiles/generic';
import { mappedJsonWebhookPayloadProfile } from '../../../../src/services/webhooks/payloadProfiles/mappedJson';
import { signWebhookRequest } from '../../../../src/services/webhooks/signers';
import {
  findMatchingWebhookEndpoints,
  matchesEndpointEventType,
  matchesEndpointFilters,
} from '../../../../src/services/webhooks/subscriptions';
import {
  GENERIC_WEBHOOK_PROFILE,
  MAPPED_JSON_WEBHOOK_PROFILE,
  WEBHOOK_AUTH_BEARER,
  WEBHOOK_AUTH_CONFIGURED_HMAC_SHA256,
  WEBHOOK_AUTH_HMAC_SHA256,
  WebhookRetryableError,
  type WalletWebhookEvent,
} from '../../../../src/services/webhooks/types';

const { mockFindEnabledEndpointsForEvent, mockGetHistoricalPrice } = vi.hoisted(() => ({
  mockFindEnabledEndpointsForEvent: vi.fn(),
  mockGetHistoricalPrice: vi.fn(),
}));

vi.mock('../../../../src/services/price', () => ({
  getPriceService: () => ({
    getHistoricalPrice: mockGetHistoricalPrice,
  }),
}));

vi.mock('../../../../src/repositories', () => ({
  webhookRepository: {
    findEnabledEndpointsForEvent: mockFindEnabledEndpointsForEvent,
  },
}));

describe('webhook core', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    delete process.env.WEBHOOK_ALLOWED_CIDRS;
    delete process.env.WEBHOOK_ALLOWED_HOSTS;
    delete process.env.WEBHOOK_ALLOW_HTTP;
  });

  it('reuses shared webhook constants for service built-ins', () => {
    expect(GENERIC_WEBHOOK_PROFILE).toBe(WEBHOOK_PAYLOAD_PROFILE_GENERIC);
    expect(MAPPED_JSON_WEBHOOK_PROFILE).toBe(WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON);
    expect(WEBHOOK_AUTH_BEARER).toBe(WEBHOOK_AUTH_TYPE_BEARER);
    expect(WEBHOOK_AUTH_HMAC_SHA256).toBe(WEBHOOK_AUTH_TYPE_HMAC_SHA256);
    expect(WEBHOOK_AUTH_CONFIGURED_HMAC_SHA256).toBe(WEBHOOK_AUTH_TYPE_CONFIGURED_HMAC_SHA256);
  });

  it('builds the generic Sanctuary wallet event payload', async () => {
    const event = makeEvent();
    const request = await genericWebhookPayloadProfile.build(makeEndpoint(), event);

    expect(request.body).toMatchObject({
      schemaVersion: 'v1',
      eventId: event.eventId,
      eventType: event.eventType,
      wallet: { id: 'wallet-1', name: 'Treasury' },
    });
    expect(request.bodyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('builds a mapped JSON payload without hard-coding receiver fields', async () => {
    const endpoint = makeEndpoint({
      payloadProfile: MAPPED_JSON_WEBHOOK_PROFILE,
      profileConfig: {
        body: {
          recordId: { path: 'eventId' },
          walletAlias: { path: 'wallet.name' },
          network: { path: 'wallet.network' },
          amount: { path: 'transaction.amountSats' },
          observedAt: { path: 'transaction.blockTime', fallbackPath: 'occurredAt' },
          category: { value: 'wallet-event' },
        },
      },
    });

    const request = await mappedJsonWebhookPayloadProfile.build(endpoint, makeEvent());

    expect(request.body).toMatchObject({
      recordId: 'wallet:wallet-1:tx:tx-1:wallet.transaction.received:v1',
      walletAlias: 'Treasury',
      network: 'mainnet',
      amount: '123456',
      observedAt: '2026-05-22T10:00:00.000Z',
      category: 'wallet-event',
    });
  });

  it('builds mapped JSON arrays, nested objects, omitted fields, and included nulls', async () => {
    const endpoint = makeEndpoint({
      payloadProfile: MAPPED_JSON_WEBHOOK_PROFILE,
      profileConfig: {
        includeNulls: true,
        body: {
          literalPrimitive: 'plain-value',
          present: { path: 'eventId' },
          missing: { path: 'transaction.memo' },
          fallbackOnly: { path: '', fallbackPath: 'occurredAt' },
          list: [
            { path: 'wallet.name' },
            { path: 'transaction.label' },
            { value: 'literal' },
          ],
          nested: {
            counterparty: { path: 'transaction.counterpartyAddress' },
            fallback: { path: 'transaction.unknown', fallbackPath: 'occurredAt' },
          },
        },
      },
    });

    const request = await mappedJsonWebhookPayloadProfile.build(endpoint, makeEvent());

    expect(request.body).toMatchObject({
      literalPrimitive: 'plain-value',
      present: 'wallet:wallet-1:tx:tx-1:wallet.transaction.received:v1',
      missing: null,
      fallbackOnly: '2026-05-22T10:00:00.000Z',
      list: ['Treasury', null, 'literal'],
      nested: {
        counterparty: null,
        fallback: '2026-05-22T10:00:00.000Z',
      },
    });

    const omitMissing = await mappedJsonWebhookPayloadProfile.build(makeEndpoint({
      payloadProfile: MAPPED_JSON_WEBHOOK_PROFILE,
      profileConfig: {
        body: {
          list: [{ path: 'transaction.memo' }],
        },
      },
    }), makeEvent());
    expect(omitMissing.body).toEqual({ list: [] });
  });

  it('rejects mapped JSON profiles without body mappings or required values', async () => {
    await expect(mappedJsonWebhookPayloadProfile.build(
      makeEndpoint({
        payloadProfile: MAPPED_JSON_WEBHOOK_PROFILE,
        profileConfig: {},
      }),
      makeEvent(),
    )).rejects.toThrow('requires a body mapping');

    await expect(mappedJsonWebhookPayloadProfile.build(
      makeEndpoint({
        payloadProfile: MAPPED_JSON_WEBHOOK_PROFILE,
        profileConfig: {
          body: {
            required: { path: 'transaction.memo', required: true },
          },
        },
      }),
      makeEvent(),
    )).rejects.toThrow('Webhook mapped value is required: transaction.memo');

    await expect(mappedJsonWebhookPayloadProfile.build(
      makeEndpoint({
        payloadProfile: MAPPED_JSON_WEBHOOK_PROFILE,
        profileConfig: {
          body: {
            required: { path: '', required: true },
          },
        },
      }),
      makeEvent(),
    )).rejects.toThrow('Webhook mapped value is required: value');
  });

  it('lets mapped JSON payloads opt into required fiat valuation', async () => {
    mockGetHistoricalPrice.mockResolvedValueOnce(103000.12345678);
    const endpoint = makeEndpoint({
      payloadProfile: MAPPED_JSON_WEBHOOK_PROFILE,
      profileConfig: {
        valuation: {
          mode: 'required',
          currency: 'USD',
          amountPath: 'transaction.amountSats',
          timePath: 'transaction.blockTime',
        },
        body: {
          eventRef: { path: 'eventId' },
          fiatCurrency: { path: 'valuation.currency' },
          fiatRate: { path: 'valuation.rate' },
          fiatMinorUnits: { path: 'valuation.valueMinorUnits' },
        },
      },
    });

    const request = await mappedJsonWebhookPayloadProfile.build(endpoint, makeEvent());

    expect(mockGetHistoricalPrice).toHaveBeenCalledWith('USD', new Date('2026-05-22T10:00:00.000Z'));
    expect(request.body.fiatCurrency).toBe('USD');
    expect(request.body.fiatRate).toBe('103000.12345678');
    expect(request.body.fiatMinorUnits).toBe('12716');
  });

  it('uses default valuation paths and custom minor-unit scaling', async () => {
    mockGetHistoricalPrice.mockResolvedValueOnce(100000);
    const endpoint = makeEndpoint({
      payloadProfile: MAPPED_JSON_WEBHOOK_PROFILE,
      profileConfig: {
        valuation: {
          mode: 'required',
          minorUnitScale: 1000,
        },
        body: {
          fiatCurrency: { path: 'valuation.currency' },
          fiatMinorUnits: { path: 'valuation.valueMinorUnits' },
          scale: { path: 'valuation.minorUnitScale' },
        },
      },
    });

    const request = await mappedJsonWebhookPayloadProfile.build(endpoint, makeEvent());

    expect(mockGetHistoricalPrice).toHaveBeenCalledWith('USD', new Date('2026-05-22T10:00:00.000Z'));
    expect(request.body).toMatchObject({
      fiatCurrency: 'USD',
      fiatMinorUnits: '123456',
      scale: 1000,
    });

    mockGetHistoricalPrice.mockResolvedValueOnce(100000);
    await mappedJsonWebhookPayloadProfile.build(makeEndpoint({
      payloadProfile: MAPPED_JSON_WEBHOOK_PROFILE,
      profileConfig: {
        valuation: {
          mode: 'required',
          timePath: 'transaction.missingTime',
        },
        body: {
          fiatCurrency: { path: 'valuation.currency' },
        },
      },
    }), makeEvent());
    expect(mockGetHistoricalPrice).toHaveBeenLastCalledWith('USD', new Date('2026-05-22T10:00:00.000Z'));
  });

  it('omits optional fiat valuation when pricing is unavailable', async () => {
    mockGetHistoricalPrice.mockRejectedValueOnce(new Error('price unavailable'));
    const endpoint = makeEndpoint({
      payloadProfile: MAPPED_JSON_WEBHOOK_PROFILE,
      profileConfig: {
        valuation: { mode: 'optional', currency: 'USD' },
        body: {
          eventRef: { path: 'eventId' },
          fiatCurrency: { path: 'valuation.currency' },
        },
      },
    });

    const request = await mappedJsonWebhookPayloadProfile.build(endpoint, makeEvent());

    expect(request.body).toEqual({ eventRef: makeEvent().eventId });
  });

  it('makes required fiat valuation failures retryable', async () => {
    mockGetHistoricalPrice.mockRejectedValueOnce(new Error('price unavailable'));

    await expect(mappedJsonWebhookPayloadProfile.build(
      makeEndpoint({
        payloadProfile: MAPPED_JSON_WEBHOOK_PROFILE,
        profileConfig: {
          valuation: { mode: 'required', amountPath: 'transaction.missingAmount' },
          body: {
            fiatCurrency: { path: 'valuation.currency' },
          },
        },
      }),
      makeEvent(),
    )).rejects.toBeInstanceOf(WebhookRetryableError);
  });

  it('reads filter and retry configuration with safe fallbacks', () => {
    const configured = makeEndpoint({
      filters: {
        transactionTypes: ['received', '', 7],
        minAmountSats: '500',
        confirmationThreshold: 3,
      },
      retryConfig: {
        initialDelayMs: 1000,
        maxDelayMs: 3000,
        backoffMultiplier: 4,
      },
    });
    const invalid = makeEndpoint({
      filters: {
        transactionTypes: [7, ''],
        minAmountSats: 500,
        confirmationThreshold: Number.NaN,
      },
      retryConfig: {
        initialDelayMs: 0,
        maxDelayMs: -1,
        backoffMultiplier: Number.NaN,
      },
    });

    expect(getFilterConfig(configured)).toEqual({
      transactionTypes: ['received'],
      minAmountSats: '500',
      confirmationThreshold: 3,
    });
    expect(getRetryConfig(configured)).toEqual({
      initialDelayMs: 1000,
      maxDelayMs: 3000,
      backoffMultiplier: 4,
    });
    expect(getFilterConfig(invalid)).toEqual({
      transactionTypes: undefined,
      minAmountSats: undefined,
      confirmationThreshold: undefined,
    });
    expect(getRetryConfig(invalid)).toEqual({
      initialDelayMs: 30_000,
      maxDelayMs: 1_800_000,
      backoffMultiplier: 2,
    });
  });

  it('matches endpoint filters for direction, amount, and confirmations', async () => {
    const event = makeEvent();

    expect(matchesEndpointFilters(
      makeEndpoint({ filters: { transactionTypes: ['sent'] } }),
      event,
    )).toBe(false);
    expect(matchesEndpointFilters(
      makeEndpoint({ filters: { minAmountSats: '999999' } }),
      event,
    )).toBe(false);
    expect(matchesEndpointFilters(
      makeEndpoint({ filters: { confirmationThreshold: 2 } }),
      event,
    )).toBe(false);
    expect(matchesEndpointFilters(
      makeEndpoint({ filters: { confirmationThreshold: 1 } }),
      { ...event, transaction: { ...event.transaction!, confirmations: undefined } },
    )).toBe(false);
    expect(matchesEndpointFilters(
      makeEndpoint({ filters: { transactionTypes: ['received'], minAmountSats: '1', confirmationThreshold: 1 } }),
      event,
    )).toBe(true);
    expect(matchesEndpointFilters(
      makeEndpoint({ filters: { transactionTypes: ['received'], minAmountSats: '1', confirmationThreshold: 1 } }),
      { ...event, transaction: undefined },
    )).toBe(true);

    mockFindEnabledEndpointsForEvent.mockResolvedValueOnce([
      makeEndpoint({ id: 'match', eventTypes: ['wallet.transaction.*'] }),
      makeEndpoint({ id: 'filtered', filters: { minAmountSats: '999999' } }),
    ]);
    await expect(findMatchingWebhookEndpoints(event)).resolves.toEqual([
      expect.objectContaining({ id: 'match' }),
    ]);
    expect(mockFindEnabledEndpointsForEvent).toHaveBeenCalledWith('wallet-1', 'wallet.transaction.received');
  });

  it('signs configured HMACs using endpoint-defined headers and canonical fields', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T10:00:00Z'));
    const endpoint = makeEndpoint({
      authType: WEBHOOK_AUTH_CONFIGURED_HMAC_SHA256,
      payloadProfile: MAPPED_JSON_WEBHOOK_PROFILE,
      url: 'https://receiver.example/events/transactions',
      secretEncrypted: 'shared-secret',
      headerConfig: {
        hmac: {
          timestampHeader: 'x-webhook-timestamp',
          nonceHeader: 'x-webhook-nonce',
          idempotencyKeyHeader: 'x-webhook-idempotency-key',
          payloadHashHeader: 'x-webhook-payload-sha256',
          signatureHeader: 'x-webhook-signature',
          canonical: ['method', 'path', 'timestamp', 'nonce', 'idempotencyKey', 'bodyHash'],
        },
      },
    });
    const request = {
      body: { recordId: 'stable-event-id' },
      bodyHash: 'a'.repeat(64),
    };

    const signed = signWebhookRequest(endpoint, makeEvent(), request);
    const nonce = signed.headers['x-webhook-nonce'];
    const canonical = [
      'POST',
      '/events/transactions',
      '1779444000',
      nonce,
      'wallet:wallet-1:tx:tx-1:wallet.transaction.received:v1',
      request.bodyHash,
    ].join('\n');

    expect(signed.headers['x-webhook-timestamp']).toBe('1779444000');
    expect(signed.headers['x-webhook-signature']).toBe(
      createHmac('sha256', 'shared-secret').update(canonical).digest('hex')
    );
    expect(signed.redactedHeaders['x-webhook-signature']).toBe('[REDACTED]');
  });

  it('signs bearer, generic HMAC, configured root HMAC, and unknown auth requests generically', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T10:00:00Z'));
    const event = makeEvent();
    const request = {
      body: { eventId: event.eventId },
      bodyHash: 'b'.repeat(64),
    };

    const bearer = signWebhookRequest(makeEndpoint({
      authType: WEBHOOK_AUTH_BEARER,
      secretEncrypted: 'bearer-secret',
      headerConfig: { headers: { 'x-static': 'ok', 'x-ignored': 7 } },
    }), event, request);
    expect(bearer.headers).toMatchObject({
      authorization: 'Bearer bearer-secret',
      'x-static': 'ok',
    });
    expect(bearer.headers).not.toHaveProperty('x-ignored');
    expect(bearer.redactedHeaders.authorization).toBe('[REDACTED]');
    expect(bearer.redactedHeaders['x-static']).toBe('[REDACTED]');
    expect(Object.values(bearer.redactedHeaders)).toEqual(
      expect.arrayContaining(['[REDACTED]']),
    );
    expect(new Set(Object.values(bearer.redactedHeaders))).toEqual(new Set(['[REDACTED]']));

    const generic = signWebhookRequest(makeEndpoint({
      authType: WEBHOOK_AUTH_HMAC_SHA256,
      secretEncrypted: 'shared-secret',
    }), event, request);
    const rawBody = '{"eventId":"wallet:wallet-1:tx:tx-1:wallet.transaction.received:v1"}';
    expect(generic.headers['x-sanctuary-signature']).toBe(
      createHmac('sha256', 'shared-secret')
        .update(`${event.eventId}.1779444000.${request.bodyHash}.${rawBody}`)
        .digest('hex'),
    );
    expect(generic.redactedHeaders['x-sanctuary-signature']).toBe('[REDACTED]');

    const configuredRoot = signWebhookRequest(makeEndpoint({
      authType: WEBHOOK_AUTH_CONFIGURED_HMAC_SHA256,
      secretEncrypted: 'shared-secret',
      url: 'https://example.com/custom/path',
      headerConfig: {
        timestampFormat: 'iso8601',
        timestampHeader: 'x-time',
        idempotencyKeyPath: 'metadata.externalId',
        canonicalSeparator: '|',
        method: 'PUT',
        canonical: ['method', 'path', 'timestamp', 'idempotencyKey', 'bodyHash'],
      },
    }), {
      ...event,
      metadata: { externalId: 'external-1' },
    }, request);
    expect(configuredRoot.headers['x-time']).toBe('2026-05-22T10:00:00.000Z');
    expect(configuredRoot.headers['x-webhook-signature']).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));

    const configuredDefaultCanonical = signWebhookRequest(makeEndpoint({
      authType: WEBHOOK_AUTH_CONFIGURED_HMAC_SHA256,
      secretEncrypted: 'shared-secret',
      headerConfig: {
        canonical: ['eventId', 'missing'],
      },
    }), event, request);
    expect(configuredDefaultCanonical.headers['x-webhook-signature'])
      .toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));

    const configuredNumberIdempotency = signWebhookRequest(makeEndpoint({
      authType: WEBHOOK_AUTH_CONFIGURED_HMAC_SHA256,
      secretEncrypted: 'shared-secret',
      headerConfig: {
        idempotencyKeyPath: 'metadata.externalId',
      },
    }), {
      ...event,
      metadata: { externalId: 42 },
    }, request);
    expect(configuredNumberIdempotency.headers['x-webhook-signature'])
      .toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));

    const configuredMissingIdempotency = signWebhookRequest(makeEndpoint({
      authType: WEBHOOK_AUTH_CONFIGURED_HMAC_SHA256,
      secretEncrypted: 'shared-secret',
      headerConfig: {
        idempotencyKeyPath: 'metadata.missing.value',
      },
    }), event, request);
    expect(configuredMissingIdempotency.headers['x-webhook-signature'])
      .toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));

    const unknown = signWebhookRequest(makeEndpoint({
      authType: 'unknown',
      headerConfig: ['bad'],
    } as Partial<WebhookEndpoint>), event, request);
    expect(unknown.headers).toMatchObject({
      'content-type': 'application/json',
      'user-agent': 'Sanctuary-Webhooks/1.0',
    });
    vi.useRealTimers();
  });

  it('requires secrets for auth modes that sign requests', () => {
    expect(() => signWebhookRequest(makeEndpoint({
      authType: WEBHOOK_AUTH_BEARER,
      secretEncrypted: null,
    }), makeEvent(), { body: {}, bodyHash: 'c'.repeat(64) }))
      .toThrow('requires a secret');
  });

  it('matches exact, global, and prefix wildcard event subscriptions', () => {
    expect(matchesEndpointEventType(
      makeEndpoint({ eventTypes: ['wallet.transaction.received'] }),
      'wallet.transaction.received',
    )).toBe(true);
    expect(matchesEndpointEventType(
      makeEndpoint({ eventTypes: ['wallet.transaction.*'] }),
      'wallet.transaction.sent',
    )).toBe(true);
    expect(matchesEndpointEventType(
      makeEndpoint({ eventTypes: ['*'] }),
      'wallet.draft.created',
    )).toBe(true);
    expect(matchesEndpointEventType(
      makeEndpoint({ enabled: false, eventTypes: ['*'] }),
      'wallet.transaction.received',
    )).toBe(false);
    expect(matchesEndpointEventType(
      makeEndpoint({ eventTypes: ['wallet.transaction.*'] }),
      'wallet',
    )).toBe(false);
  });

  it('blocks private webhook targets unless explicitly allowlisted', async () => {
    await expect(validateWebhookEndpointUrl('http://192.168.5.10/hook'))
      .rejects.toThrow('HTTPS');

    process.env.WEBHOOK_ALLOWED_CIDRS = '192.168.5.0/24';
    await expect(validateWebhookEndpointUrl('http://192.168.5.10/hook'))
      .resolves.toMatchObject({ resolvedAddresses: ['192.168.5.10'] });
  });

  it('allows loopback receiver tests only when the host is explicitly allowlisted', async () => {
    await expect(validateWebhookEndpointUrl('http://127.0.0.1:8080/hook'))
      .rejects.toThrow('blocked');

    process.env.WEBHOOK_ALLOW_HTTP = 'true';
    process.env.WEBHOOK_ALLOWED_HOSTS = '127.0.0.1';
    await expect(validateWebhookEndpointUrl('http://127.0.0.1:8080/hook'))
      .resolves.toMatchObject({ resolvedAddresses: ['127.0.0.1'] });
  });

  it('allows public IPv6 webhook targets while still blocking private ranges', async () => {
    await expect(validateWebhookEndpointUrl('https://[2606:2800:220:1:248:1893:25c8:1946]/hook'))
      .resolves.toMatchObject({ resolvedAddresses: ['2606:2800:220:1:248:1893:25c8:1946'] });

    await expect(validateWebhookEndpointUrl('https://[fd00::10]/hook'))
      .rejects.toThrow('blocked network');
  });
});

function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: 'endpoint-1',
    walletId: 'wallet-1',
    name: 'Endpoint',
    enabled: true,
    url: 'https://example.com/webhook',
    eventTypes: ['wallet.transaction.received'],
    filters: null,
    payloadProfile: GENERIC_WEBHOOK_PROFILE,
    authType: 'none',
    secretEncrypted: null,
    headerConfig: null,
    profileConfig: null,
    retryConfig: null,
    maxAttempts: 5,
    failureNotificationEnabled: true,
    createdByUserId: 'user-1',
    lastDeliveryStatus: null,
    lastDeliveredAt: null,
    lastError: null,
    createdAt: new Date('2026-05-22T00:00:00Z'),
    updatedAt: new Date('2026-05-22T00:00:00Z'),
    ...overrides,
  };
}

function makeEvent(): WalletWebhookEvent {
  return {
    schemaVersion: 'v1',
    eventId: 'wallet:wallet-1:tx:tx-1:wallet.transaction.received:v1',
    eventType: 'wallet.transaction.received',
    occurredAt: '2026-05-22T10:00:00.000Z',
    wallet: {
      id: 'wallet-1',
      name: 'Treasury',
      network: 'mainnet',
    },
    transaction: {
      txid: 'tx-1',
      type: 'received',
      amountSats: '123456',
      feeSats: null,
      confirmations: 1,
      blockHeight: 900001,
      blockTime: '2026-05-22T10:00:00.000Z',
      memo: null,
      label: null,
      counterpartyAddress: null,
    },
    source: {
      service: 'sanctuary',
      dispatchPath: 'notifications.transaction',
    },
  };
}
