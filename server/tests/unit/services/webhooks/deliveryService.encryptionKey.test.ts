import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PinnedRequestOptions,
  PinnedResponse,
} from '../../../../src/services/outboundNetwork/nativeRequest';
import { makeDelivery, makeEndpoint } from './deliveryService.fixtures';

// Split out of deliveryService.test.ts (large-file classifier: unclassified test
// files cap at 1000 lines) because this scenario brings its own hoisted logger
// and encryption mocks that no other test in that file needs.

const outboundTransport = vi.hoisted(() => ({
  actual: null as ((options: PinnedRequestOptions) => Promise<PinnedResponse>) | null,
  request: vi.fn<(options: PinnedRequestOptions) => Promise<PinnedResponse>>(),
}));

const mockClaimDeliveryAttempt = vi.fn();
const mockDnsLookup = vi.fn();
const mockFindDeliveryById = vi.fn();
const mockListDueDeliveries = vi.fn();
const mockListEndpoints = vi.fn();
const mockMarkDeliveryDead = vi.fn();
const mockMarkDeliveryFailed = vi.fn();
const mockMarkDeliveryDelivered = vi.fn();
const mockMarkDeliveryPendingForReplay = vi.fn();
const mockCreateDelivery = vi.fn();
const mockQueueWebhookDeliveryNotification = vi.fn();
const mockWalletLog = vi.fn();
const realFetch = globalThis.fetch;

const loggerMocks = vi.hoisted(() => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const encryptionMocks = vi.hoisted(() => ({
  decryptIfEncrypted: vi.fn<(value: string) => string>(),
}));

vi.mock('../../../../src/repositories', () => ({
  webhookRepository: {
    claimDeliveryAttempt: mockClaimDeliveryAttempt,
    createDelivery: mockCreateDelivery,
    findDeliveryById: mockFindDeliveryById,
    listDueDeliveries: mockListDueDeliveries,
    listEndpoints: mockListEndpoints,
    markDeliveryDead: mockMarkDeliveryDead,
    markDeliveryFailed: mockMarkDeliveryFailed,
    markDeliveryDelivered: mockMarkDeliveryDelivered,
    markDeliveryPendingForReplay: mockMarkDeliveryPendingForReplay,
  },
}));

vi.mock('../../../../src/infrastructure', () => ({
  queueWebhookDeliveryNotification: mockQueueWebhookDeliveryNotification,
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  walletLog: mockWalletLog,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => loggerMocks.log,
}));

vi.mock('../../../../src/utils/encryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/utils/encryption')>();
  return {
    ...actual,
    decryptIfEncrypted: (value: string) => encryptionMocks.decryptIfEncrypted(value),
  };
});

vi.mock('node:dns/promises', () => ({
  default: { lookup: mockDnsLookup },
  lookup: mockDnsLookup,
}));

vi.mock('../../../../src/services/outboundNetwork/nativeRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/services/outboundNetwork/nativeRequest')>();
  outboundTransport.actual = actual.requestPinnedAddress;
  return {
    ...actual,
    requestPinnedAddress: outboundTransport.request,
  };
});

describe('webhook delivery service - encryption key not initialized', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    const actualEncryption = await vi.importActual<typeof import('../../../../src/utils/encryption')>(
      '../../../../src/utils/encryption',
    );
    encryptionMocks.decryptIfEncrypted.mockImplementation(actualEncryption.decryptIfEncrypted);
    mockClaimDeliveryAttempt.mockImplementation(
      async () => mockFindDeliveryById.mock.results.at(-1)?.value,
    );
    delete process.env.WEBHOOK_ALLOWED_HOSTS;
    delete process.env.WEBHOOK_ALLOW_HTTP;
    delete process.env.WEBHOOK_ALLOWED_CIDRS;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network timeout')));
    outboundTransport.request.mockImplementation(async (options) => {
      if (options.url.hostname === 'webhook.test' || globalThis.fetch === realFetch) {
        return outboundTransport.actual!(options);
      }
      const response = await globalThis.fetch(options.url.toString(), {
        body: options.body,
        headers: options.headers,
        method: options.method,
      });
      const bodyText = await response.text().catch(() => '');
      const captureLimit = options.responseCaptureByteLimit ?? Number.POSITIVE_INFINITY;
      return {
        body: Buffer.from(bodyText).subarray(0, captureLimit),
        ok: response.ok,
        status: response.status,
      };
    });
  });

  it('logs an error naming the missing startup step and dead-letters on attempt 1 when the encryption key was never initialized', async () => {
    const { ENCRYPTION_KEY_NOT_INITIALIZED_MESSAGE } = await import('../../../../src/utils/encryption');
    encryptionMocks.decryptIfEncrypted.mockImplementationOnce(() => {
      throw new Error(ENCRYPTION_KEY_NOT_INITIALIZED_MESSAGE);
    });
    const { sendWebhookDelivery } = await import('../../../../src/services/webhooks/deliveryService');
    const delivery = makeDelivery({
      endpoint: makeEndpoint({
        authType: 'bearer',
        secretEncrypted: 'shared-secret',
        maxAttempts: 5,
        url: 'https://93.184.216.34/webhook',
      }),
    });
    mockFindDeliveryById.mockResolvedValueOnce(delivery);
    mockMarkDeliveryDead.mockImplementationOnce(async input => ({
      ...delivery,
      status: 'dead',
      attemptCount: input.expectedAttempt,
      lastError: input.error,
    }));

    const result = await sendWebhookDelivery(delivery.id);

    expect(result).toEqual({
      success: false,
      error: ENCRYPTION_KEY_NOT_INITIALIZED_MESSAGE,
    });
    // Non-retryable: dead-lettered on the very first attempt, not queued for retry.
    expect(mockMarkDeliveryDead).toHaveBeenCalledWith({
      deliveryId: delivery.id,
      error: ENCRYPTION_KEY_NOT_INITIALIZED_MESSAGE,
      expectedAttempt: 1,
      leaseToken: expect.any(String),
    });
    expect(mockMarkDeliveryFailed).not.toHaveBeenCalled();
    expect(mockQueueWebhookDeliveryNotification).not.toHaveBeenCalled();
    expect(loggerMocks.log.error).toHaveBeenCalledWith(
      'Webhook signing failed: encryption key not initialized at startup',
      expect.objectContaining({
        deliveryId: delivery.id,
        endpointId: delivery.endpointId,
        walletId: delivery.walletId,
        hint: expect.stringContaining('validateEncryptionKey()'),
      }),
    );
  });
});
