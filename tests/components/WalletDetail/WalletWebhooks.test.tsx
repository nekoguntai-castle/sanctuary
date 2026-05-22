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

  it('surfaces load errors and refreshes the list', async () => {
    mockListWalletWebhooks
      .mockRejectedValueOnce(new Error('Cannot load webhooks'))
      .mockRejectedValueOnce('offline');
    render(<WalletWebhooks walletId="wallet-1" />);

    expect(await screen.findByText('Cannot load webhooks')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Refresh webhooks'));
    expect(await screen.findByText('Failed to load webhooks')).toBeInTheDocument();
    expect(mockListWalletWebhooks).toHaveBeenCalledTimes(2);
  });

  it('reports create errors from validation and API failures', async () => {
    mockListWalletWebhooks.mockResolvedValue([]);
    render(<WalletWebhooks walletId="wallet-1" />);

    fillRequiredFields();
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText('Filters JSON'), {
      target: { value: '[' },
    });
    fireEvent.click(screen.getByText('Add webhook'));

    expect(await screen.findByText('Unexpected end of JSON input')).toBeInTheDocument();
    expect(mockCreateWalletWebhook).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Filters JSON'), {
      target: { value: '' },
    });
    mockCreateWalletWebhook.mockRejectedValueOnce('offline');
    fireEvent.click(screen.getByText('Add webhook'));

    expect(await screen.findByText('Failed to save webhook')).toBeInTheDocument();
  });

  it('toggles and deletes existing webhooks', async () => {
    mockListWalletWebhooks
      .mockResolvedValueOnce([makeWebhook()])
      .mockResolvedValueOnce([makeWebhook({ enabled: false })])
      .mockResolvedValueOnce([]);
    render(<WalletWebhooks walletId="wallet-1" />);

    expect(await screen.findByText('Accounting')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Enabled'));

    await waitFor(() => {
      expect(mockUpdateWalletWebhook).toHaveBeenCalledWith('wallet-1', 'webhook-1', { enabled: false });
    });
    expect(await screen.findByText('Disabled')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Delete Accounting'));
    await waitFor(() => {
      expect(mockDeleteWalletWebhook).toHaveBeenCalledWith('wallet-1', 'webhook-1');
    });
    expect(await screen.findByText('No webhooks configured.')).toBeInTheDocument();
  });

  it('reports endpoint action and delivery history failures', async () => {
    mockUpdateWalletWebhook.mockRejectedValueOnce('offline');
    mockTestWalletWebhook.mockRejectedValueOnce(new Error('Test endpoint failed'));
    mockGetWalletWebhookDeliveries
      .mockRejectedValueOnce(new Error('History failed'))
      .mockRejectedValueOnce('offline');
    render(<WalletWebhooks walletId="wallet-1" />);

    expect(await screen.findByText('Accounting')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Enabled'));
    expect(await screen.findByText('Failed to update webhook')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Test'));
    expect(await screen.findByText('Test endpoint failed')).toBeInTheDocument();

    fireEvent.click(screen.getByText('History'));
    expect(await screen.findByText('History failed')).toBeInTheDocument();

    fireEvent.click(screen.getByText('History'));
    expect(await screen.findByText('Failed to load deliveries')).toBeInTheDocument();
  });

  it('preserves existing delivery rows when a history refresh fails', async () => {
    mockGetWalletWebhookDeliveries
      .mockResolvedValueOnce([makeDelivery()])
      .mockRejectedValueOnce('offline');
    render(<WalletWebhooks walletId="wallet-1" />);

    expect(await screen.findByText('Accounting')).toBeInTheDocument();

    fireEvent.click(screen.getByText('History'));
    expect(await screen.findByText('event-1')).toBeInTheDocument();

    fireEvent.click(screen.getByText('History'));
    expect(await screen.findByText('Failed to load deliveries')).toBeInTheDocument();
    expect(screen.getByText('event-1')).toBeInTheDocument();
  });
});

function fillRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText('Endpoint name'), {
    target: { value: 'External receiver' },
  });
  fireEvent.change(screen.getByPlaceholderText('https://example.com/webhook'), {
    target: { value: 'https://example.com/webhook' },
  });
}

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
