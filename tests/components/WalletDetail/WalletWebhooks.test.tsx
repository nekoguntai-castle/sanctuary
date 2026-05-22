import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletWebhooks } from '../../../components/WalletDetail/WalletWebhooks';

const {
  mockListWalletWebhooks,
  mockCreateWalletWebhook,
  mockUpdateWalletWebhook,
  mockDeleteWalletWebhook,
  mockTestWalletWebhook,
  mockGetWalletWebhookDeliveries,
  mockReplayWalletWebhookDelivery,
} = vi.hoisted(() => ({
  mockListWalletWebhooks: vi.fn(),
  mockCreateWalletWebhook: vi.fn(),
  mockUpdateWalletWebhook: vi.fn(),
  mockDeleteWalletWebhook: vi.fn(),
  mockTestWalletWebhook: vi.fn(),
  mockGetWalletWebhookDeliveries: vi.fn(),
  mockReplayWalletWebhookDelivery: vi.fn(),
}));

vi.mock('../../../src/api/wallets', () => ({
  listWalletWebhooks: mockListWalletWebhooks,
  createWalletWebhook: mockCreateWalletWebhook,
  updateWalletWebhook: mockUpdateWalletWebhook,
  deleteWalletWebhook: mockDeleteWalletWebhook,
  testWalletWebhook: mockTestWalletWebhook,
  getWalletWebhookDeliveries: mockGetWalletWebhookDeliveries,
  replayWalletWebhookDelivery: mockReplayWalletWebhookDelivery,
}));

describe('WalletWebhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListWalletWebhooks.mockResolvedValue([makeWebhook()]);
    mockCreateWalletWebhook.mockResolvedValue(makeWebhook());
    mockUpdateWalletWebhook.mockResolvedValue(makeWebhook());
    mockDeleteWalletWebhook.mockResolvedValue(undefined);
    mockTestWalletWebhook.mockResolvedValue({ success: true, message: 'Webhook endpoint URL is allowed' });
    mockGetWalletWebhookDeliveries.mockResolvedValue([makeDelivery()]);
    mockReplayWalletWebhookDelivery.mockResolvedValue({
      success: true,
      queued: true,
      message: 'Webhook delivery replay queued',
      delivery: makeDelivery({ status: 'pending' }),
    });
  });

  it('tests, rotates, loads history, and replays an existing webhook', async () => {
    render(<WalletWebhooks walletId="wallet-1" />);

    expect(await screen.findByText('Accounting')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Test'));
    expect(await screen.findByText('Webhook endpoint URL is allowed')).toBeInTheDocument();
    expect(mockTestWalletWebhook).toHaveBeenCalledWith('wallet-1', 'webhook-1');

    fireEvent.change(screen.getByPlaceholderText('Rotate signing secret'), {
      target: { value: 'new-secret' },
    });
    fireEvent.click(screen.getByText('Rotate'));
    await waitFor(() => {
      expect(mockUpdateWalletWebhook).toHaveBeenCalledWith('wallet-1', 'webhook-1', { secret: 'new-secret' });
    });

    fireEvent.click(screen.getByText('History'));
    expect(await screen.findByText('event-1')).toBeInTheDocument();
    expect(mockGetWalletWebhookDeliveries).toHaveBeenCalledWith('wallet-1', 'webhook-1', 25);

    fireEvent.click(screen.getByText('Replay'));
    expect(await screen.findByText('Webhook delivery replay queued')).toBeInTheDocument();
    expect(mockReplayWalletWebhookDelivery).toHaveBeenCalledWith('wallet-1', 'webhook-1', 'delivery-1');
  });

  it('creates mapped JSON webhooks with configured HMAC and required valuation', async () => {
    mockListWalletWebhooks.mockResolvedValue([]);
    render(<WalletWebhooks walletId="wallet-1" />);

    fireEvent.change(screen.getByPlaceholderText('Endpoint name'), {
      target: { value: 'External receiver' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://example.com/webhook'), {
      target: { value: 'https://example.com/webhook' },
    });
    fireEvent.change(screen.getByLabelText('Payload'), {
      target: { value: 'mapped_json_v1' },
    });
    fireEvent.change(screen.getByLabelText('Auth'), {
      target: { value: 'configured_hmac_sha256' },
    });
    fireEvent.change(screen.getByPlaceholderText('Signing secret'), {
      target: { value: 'shared-secret' },
    });
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText('Valuation'), {
      target: { value: 'required' },
    });
    fireEvent.click(screen.getByText('Add webhook'));

    await waitFor(() => expect(mockCreateWalletWebhook).toHaveBeenCalledTimes(1));
    expect(mockCreateWalletWebhook).toHaveBeenCalledWith('wallet-1', expect.objectContaining({
      name: 'External receiver',
      payloadProfile: 'mapped_json_v1',
      authType: 'configured_hmac_sha256',
      secret: 'shared-secret',
      profileConfig: expect.objectContaining({
        body: expect.objectContaining({
          eventId: { path: 'eventId' },
        }),
        valuation: expect.objectContaining({
          mode: 'required',
          currency: 'USD',
        }),
      }),
      headerConfig: expect.objectContaining({
        hmac: expect.objectContaining({
          signatureHeader: 'x-webhook-signature',
        }),
      }),
    }));
  });
});

function makeWebhook(overrides: Record<string, unknown> = {}) {
  return {
    id: 'webhook-1',
    walletId: 'wallet-1',
    name: 'Accounting',
    enabled: true,
    url: 'https://example.com/hook',
    eventTypes: ['wallet.transaction.received'],
    filters: null,
    payloadProfile: 'sanctuary_wallet_event_v1',
    authType: 'hmac_sha256',
    hasSecret: true,
    headerConfig: null,
    profileConfig: null,
    retryConfig: null,
    maxAttempts: 5,
    failureNotificationEnabled: true,
    createdByUserId: 'user-1',
    lastDeliveryStatus: 'failed',
    lastDeliveredAt: null,
    lastError: null,
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
    ...overrides,
  };
}

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    endpointId: 'webhook-1',
    walletId: 'wallet-1',
    eventId: 'event-1',
    eventType: 'wallet.transaction.received',
    payloadProfile: 'sanctuary_wallet_event_v1',
    status: 'failed',
    attemptCount: 2,
    nextAttemptAt: null,
    lastAttemptAt: '2026-05-22T00:00:00.000Z',
    deliveredAt: null,
    lastStatusCode: 503,
    lastError: 'Webhook endpoint returned HTTP 503',
    requestBodyHash: 'a'.repeat(64),
    requestHeadersRedacted: { 'x-sanctuary-signature': '[REDACTED]' },
    responseBodyHash: 'b'.repeat(64),
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
    ...overrides,
  };
}
