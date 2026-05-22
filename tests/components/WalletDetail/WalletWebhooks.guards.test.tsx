import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletWebhooks } from '../../../components/WalletDetail/WalletWebhooks';

const {
  mockListWalletWebhooks,
  mockCreateWalletWebhook,
  mockUpdateWalletWebhook,
} = vi.hoisted(() => ({
  mockListWalletWebhooks: vi.fn(),
  mockCreateWalletWebhook: vi.fn(),
  mockUpdateWalletWebhook: vi.fn(),
}));

vi.mock('../../../src/api/wallets', () => ({
  listWalletWebhooks: mockListWalletWebhooks,
  createWalletWebhook: mockCreateWalletWebhook,
  updateWalletWebhook: mockUpdateWalletWebhook,
  deleteWalletWebhook: vi.fn(),
  testWalletWebhook: vi.fn(),
  getWalletWebhookDeliveries: vi.fn(),
  replayWalletWebhookDelivery: vi.fn(),
}));

vi.mock('../../../components/WalletDetail/webhooks/WalletWebhookForm', () => ({
  WalletWebhookForm: ({ onCreate }: { onCreate: () => void }) => (
    <button type="button" onClick={onCreate}>Force create</button>
  ),
}));

vi.mock('../../../components/WalletDetail/webhooks/WalletWebhookRow', () => ({
  WalletWebhookRow: ({ onRotateSecret }: { onRotateSecret: () => void }) => (
    <button type="button" onClick={onRotateSecret}>Force rotate</button>
  ),
}));

describe('WalletWebhooks guard callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListWalletWebhooks.mockResolvedValue([makeWebhook()]);
  });

  it('keeps create and rotate handlers as no-ops when child controls call them without required values', async () => {
    render(<WalletWebhooks walletId="wallet-1" />);

    expect(await screen.findByText('Force create')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Force rotate')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Force create'));
    fireEvent.click(screen.getByText('Force rotate'));

    expect(mockCreateWalletWebhook).not.toHaveBeenCalled();
    expect(mockUpdateWalletWebhook).not.toHaveBeenCalled();
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
