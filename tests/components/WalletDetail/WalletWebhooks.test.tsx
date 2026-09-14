import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WalletWebhooks } from '../../../src/components/WalletDetail/WalletWebhooks';
import type { WalletWebhookEndpoint } from '../../../src/types';

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
    render(<WalletWebhooks walletId="wallet-1" userRole="owner" />);

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
    render(<WalletWebhooks walletId="wallet-1" userRole="owner" />);

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
    render(<WalletWebhooks walletId="wallet-1" userRole="owner" />);

    expect(await screen.findByText('Cannot load webhooks')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Refresh webhooks'));
    expect(await screen.findByText('Failed to load webhooks')).toBeInTheDocument();
    expect(mockListWalletWebhooks).toHaveBeenCalledTimes(2);
  });

  it('reports create errors from validation and API failures', async () => {
    mockListWalletWebhooks.mockResolvedValue([]);
    render(<WalletWebhooks walletId="wallet-1" userRole="owner" />);

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
    render(<WalletWebhooks walletId="wallet-1" userRole="owner" />);

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
    render(<WalletWebhooks walletId="wallet-1" userRole="owner" />);

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
    render(<WalletWebhooks walletId="wallet-1" userRole="owner" />);

    expect(await screen.findByText('Accounting')).toBeInTheDocument();

    fireEvent.click(screen.getByText('History'));
    expect(await screen.findByText('event-1')).toBeInTheDocument();

    fireEvent.click(screen.getByText('History'));
    expect(await screen.findByText('Failed to load deliveries')).toBeInTheDocument();
    expect(screen.getByText('event-1')).toBeInTheDocument();
  });

  it('updates individual hidden headers without prefilling values and rejects redaction markers', async () => {
    mockListWalletWebhooks.mockResolvedValue([
      makeWebhook({ configuredHeaderNames: ['Authorization', 'X-API-Key'] }),
    ]);
    render(<WalletWebhooks walletId="wallet-1" userRole="owner" />);

    expect(await screen.findByText('Configured headers: Authorization, X-API-Key')).toBeInTheDocument();
    const input = screen.getByLabelText('Header changes for Accounting');
    expect(input).toHaveValue('');

    fireEvent.change(input, { target: { value: '{"X-API-Key":"replacement","X-Old":null}' } });
    fireEvent.click(screen.getByText('Update headers'));
    await waitFor(() => {
      expect(mockUpdateWalletWebhook).toHaveBeenCalledWith('wallet-1', 'webhook-1', {
        headerConfig: { headers: { 'X-API-Key': 'replacement', 'X-Old': null } },
      });
    });

    fireEvent.change(input, { target: { value: '{"Authorization":"[REDACTED]"}' } });
    fireEvent.click(screen.getByText('Update headers'));
    expect(await screen.findByText('Header Authorization must be replaced with its real value or removed')).toBeInTheDocument();
    expect(mockUpdateWalletWebhook).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['signer', true],
    ['approver', false],
    ['viewer', false],
  ])('renders %s controls according to webhook capabilities', async (role, canInspect) => {
    render(<WalletWebhooks walletId="wallet-1" userRole={role} />);
    expect(await screen.findByText('Accounting')).toBeInTheDocument();
    expect(screen.queryByText('Add webhook')).not.toBeInTheDocument();
    expect(screen.queryByText('Test')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Rotate signing secret')).not.toBeInTheDocument();
    expect(screen.queryByText('Update headers')).not.toBeInTheDocument();
    expect(screen.queryByText('History') !== null).toBe(canInspect);
  });

  it.each([undefined, null, 'unknown'])('fails closed for invalid role %s', async (role) => {
    render(<WalletWebhooks walletId="wallet-1" userRole={role} />);
    expect(await screen.findByText('Webhook access is unavailable')).toBeInTheDocument();
    expect(mockListWalletWebhooks).not.toHaveBeenCalled();
  });

  it('discards a stale wallet response that resolves after switching wallets', async () => {
    let resolveA!: (value: WalletWebhookEndpoint[]) => void;
    let resolveB!: (value: WalletWebhookEndpoint[]) => void;
    const pendingA = new Promise<WalletWebhookEndpoint[]>(resolve => { resolveA = resolve; });
    const pendingB = new Promise<WalletWebhookEndpoint[]>(resolve => { resolveB = resolve; });

    mockListWalletWebhooks.mockImplementation((walletId: string) => (
      walletId === 'wallet-a' ? pendingA : pendingB
    ));

    const { rerender } = render(<WalletWebhooks walletId="wallet-a" userRole="owner" />);
    expect(mockListWalletWebhooks).toHaveBeenCalledWith('wallet-a');

    rerender(<WalletWebhooks walletId="wallet-b" userRole="owner" />);
    expect(mockListWalletWebhooks).toHaveBeenCalledWith('wallet-b');

    // List B never shows A's rows in the meantime.
    expect(screen.queryByText('Accounting')).not.toBeInTheDocument();

    // Resolve B first, then A arrives late; A's stale response must not overwrite B's list.
    resolveB([makeWebhook({ id: 'webhook-b', name: 'Bravo endpoint' })]);
    expect(await screen.findByText('Bravo endpoint')).toBeInTheDocument();

    resolveA([makeWebhook({ id: 'webhook-a', name: 'Alpha endpoint' })]);
    await waitFor(() => {
      expect(screen.queryByText('Alpha endpoint')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Bravo endpoint')).toBeInTheDocument();
  });

  it('discards a stale wallet failure that rejects after switching wallets', async () => {
    let rejectA!: (err: unknown) => void;
    let resolveB!: (value: WalletWebhookEndpoint[]) => void;
    const pendingA = new Promise<WalletWebhookEndpoint[]>((_resolve, reject) => { rejectA = reject; });
    const pendingB = new Promise<WalletWebhookEndpoint[]>(resolve => { resolveB = resolve; });

    mockListWalletWebhooks.mockImplementation((walletId: string) => (
      walletId === 'wallet-a' ? pendingA : pendingB
    ));

    const { rerender } = render(<WalletWebhooks walletId="wallet-a" userRole="owner" />);
    expect(mockListWalletWebhooks).toHaveBeenCalledWith('wallet-a');

    rerender(<WalletWebhooks walletId="wallet-b" userRole="owner" />);
    expect(mockListWalletWebhooks).toHaveBeenCalledWith('wallet-b');

    resolveB([makeWebhook({ id: 'webhook-b', name: 'Bravo endpoint' })]);
    expect(await screen.findByText('Bravo endpoint')).toBeInTheDocument();

    // A's late rejection must not surface as an error under wallet B.
    rejectA(new Error('stale wallet-a failure'));
    await waitFor(() => {
      expect(screen.queryByText('stale wallet-a failure')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Bravo endpoint')).toBeInTheDocument();
  });

  it('does not reload a stale wallet when a mutation resolves after switching wallets', async () => {
    let resolveUpdate!: (value: WalletWebhookEndpoint) => void;
    const pendingUpdate = new Promise<WalletWebhookEndpoint>(resolve => { resolveUpdate = resolve; });

    mockListWalletWebhooks.mockImplementation((walletId: string) => (
      walletId === 'wallet-a'
        ? Promise.resolve([makeWebhook({ id: 'webhook-a', name: 'Alpha endpoint' })])
        : Promise.resolve([makeWebhook({ id: 'webhook-b', name: 'Bravo endpoint' })])
    ));
    mockUpdateWalletWebhook.mockReturnValue(pendingUpdate);

    const { rerender } = render(<WalletWebhooks walletId="wallet-a" userRole="owner" />);
    expect(await screen.findByText('Alpha endpoint')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Enabled'));
    await waitFor(() => expect(mockUpdateWalletWebhook).toHaveBeenCalledTimes(1));

    const walletACallsBeforeSwitch = mockListWalletWebhooks.mock.calls
      .filter(args => args[0] === 'wallet-a').length;

    rerender(<WalletWebhooks walletId="wallet-b" userRole="owner" />);
    expect(await screen.findByText('Bravo endpoint')).toBeInTheDocument();

    // The pending toggle for wallet A resolves after the switch; its reload must be
    // dropped rather than re-fetching (or overwriting) wallet B's rows.
    resolveUpdate(makeWebhook({ id: 'webhook-a', name: 'Alpha endpoint', enabled: false }));
    await waitFor(() => {
      expect(screen.getByText('Bravo endpoint')).toBeInTheDocument();
    });
    const walletACallsAfterSwitch = mockListWalletWebhooks.mock.calls
      .filter(args => args[0] === 'wallet-a').length;
    expect(walletACallsAfterSwitch).toBe(walletACallsBeforeSwitch);
  });

  it('does not surface a stale create failure after switching wallets', async () => {
    let rejectCreate!: (err: unknown) => void;
    const pendingCreate = new Promise<WalletWebhookEndpoint>((_resolve, reject) => { rejectCreate = reject; });

    mockListWalletWebhooks.mockImplementation((walletId: string) => (
      walletId === 'wallet-a'
        ? Promise.resolve([])
        : Promise.resolve([makeWebhook({ id: 'webhook-b', name: 'Bravo endpoint' })])
    ));
    mockCreateWalletWebhook.mockReturnValue(pendingCreate);

    const { rerender } = render(<WalletWebhooks walletId="wallet-a" userRole="owner" />);
    expect(await screen.findByText('No webhooks configured.')).toBeInTheDocument();

    fillRequiredFields();
    fireEvent.click(screen.getByText('Add webhook'));
    await waitFor(() => expect(mockCreateWalletWebhook).toHaveBeenCalledTimes(1));

    rerender(<WalletWebhooks walletId="wallet-b" userRole="owner" />);
    expect(await screen.findByText('Bravo endpoint')).toBeInTheDocument();

    rejectCreate(new Error('stale create failure'));
    await waitFor(() => {
      expect(screen.queryByText('stale create failure')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Bravo endpoint')).toBeInTheDocument();
  });

  it('does not surface a stale mutation failure after switching wallets', async () => {
    let rejectUpdate!: (err: unknown) => void;
    const pendingUpdate = new Promise<WalletWebhookEndpoint>((_resolve, reject) => { rejectUpdate = reject; });

    mockListWalletWebhooks.mockImplementation((walletId: string) => (
      walletId === 'wallet-a'
        ? Promise.resolve([makeWebhook({ id: 'webhook-a', name: 'Alpha endpoint' })])
        : Promise.resolve([makeWebhook({ id: 'webhook-b', name: 'Bravo endpoint' })])
    ));
    mockUpdateWalletWebhook.mockReturnValue(pendingUpdate);

    const { rerender } = render(<WalletWebhooks walletId="wallet-a" userRole="owner" />);
    expect(await screen.findByText('Alpha endpoint')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Enabled'));
    await waitFor(() => expect(mockUpdateWalletWebhook).toHaveBeenCalledTimes(1));

    rerender(<WalletWebhooks walletId="wallet-b" userRole="owner" />);
    expect(await screen.findByText('Bravo endpoint')).toBeInTheDocument();

    rejectUpdate(new Error('stale toggle failure'));
    await waitFor(() => {
      expect(screen.queryByText('stale toggle failure')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Bravo endpoint')).toBeInTheDocument();
  });

  it('does not apply a stale secret-rotation notice after switching wallets', async () => {
    let resolveRotate!: (value: WalletWebhookEndpoint) => void;
    const pendingRotate = new Promise<WalletWebhookEndpoint>(resolve => { resolveRotate = resolve; });

    mockListWalletWebhooks.mockImplementation((walletId: string) => (
      walletId === 'wallet-a'
        ? Promise.resolve([makeWebhook({ id: 'webhook-a', name: 'Alpha endpoint' })])
        : Promise.resolve([makeWebhook({ id: 'webhook-b', name: 'Bravo endpoint' })])
    ));
    mockUpdateWalletWebhook.mockReturnValue(pendingRotate);

    const { rerender } = render(<WalletWebhooks walletId="wallet-a" userRole="owner" />);
    expect(await screen.findByText('Alpha endpoint')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Rotate signing secret'), {
      target: { value: 'new-secret' },
    });
    fireEvent.click(screen.getByText('Rotate'));
    await waitFor(() => expect(mockUpdateWalletWebhook).toHaveBeenCalledTimes(1));

    rerender(<WalletWebhooks walletId="wallet-b" userRole="owner" />);
    expect(await screen.findByText('Bravo endpoint')).toBeInTheDocument();

    resolveRotate(makeWebhook({ id: 'webhook-a', name: 'Alpha endpoint' }));
    await waitFor(() => {
      expect(screen.getByText('Bravo endpoint')).toBeInTheDocument();
    });
    expect(screen.queryByText('Secret rotated for Alpha endpoint')).not.toBeInTheDocument();
  });

  it('does not apply a stale header-update notice after switching wallets', async () => {
    let resolveHeaders!: (value: WalletWebhookEndpoint) => void;
    const pendingHeaders = new Promise<WalletWebhookEndpoint>(resolve => { resolveHeaders = resolve; });

    mockListWalletWebhooks.mockImplementation((walletId: string) => (
      walletId === 'wallet-a'
        ? Promise.resolve([makeWebhook({
          id: 'webhook-a',
          name: 'Alpha endpoint',
          configuredHeaderNames: ['Authorization'],
        })])
        : Promise.resolve([makeWebhook({ id: 'webhook-b', name: 'Bravo endpoint' })])
    ));
    mockUpdateWalletWebhook.mockReturnValue(pendingHeaders);

    const { rerender } = render(<WalletWebhooks walletId="wallet-a" userRole="owner" />);
    expect(await screen.findByText('Alpha endpoint')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Header changes for Alpha endpoint'), {
      target: { value: '{"Authorization":"replacement"}' },
    });
    fireEvent.click(screen.getByText('Update headers'));
    await waitFor(() => expect(mockUpdateWalletWebhook).toHaveBeenCalledTimes(1));

    rerender(<WalletWebhooks walletId="wallet-b" userRole="owner" />);
    expect(await screen.findByText('Bravo endpoint')).toBeInTheDocument();

    resolveHeaders(makeWebhook({ id: 'webhook-a', name: 'Alpha endpoint' }));
    await waitFor(() => {
      expect(screen.getByText('Bravo endpoint')).toBeInTheDocument();
    });
    expect(screen.queryByText('Headers updated for Alpha endpoint')).not.toBeInTheDocument();
  });

  it('does not apply a stale replay notice or reload deliveries after switching wallets', async () => {
    let resolveReplay!: (value: {
      success: boolean;
      queued: boolean;
      message: string;
      delivery: ReturnType<typeof makeDelivery>;
    }) => void;
    const pendingReplay = new Promise<{
      success: boolean;
      queued: boolean;
      message: string;
      delivery: ReturnType<typeof makeDelivery>;
    }>(resolve => { resolveReplay = resolve; });

    mockListWalletWebhooks.mockImplementation((walletId: string) => (
      walletId === 'wallet-a'
        ? Promise.resolve([makeWebhook({ id: 'webhook-a', name: 'Alpha endpoint' })])
        : Promise.resolve([makeWebhook({ id: 'webhook-b', name: 'Bravo endpoint' })])
    ));
    mockGetWalletWebhookDeliveries.mockResolvedValue([makeDelivery()]);
    mockReplayWalletWebhookDelivery.mockReturnValue(pendingReplay);

    const { rerender } = render(<WalletWebhooks walletId="wallet-a" userRole="owner" />);
    expect(await screen.findByText('Alpha endpoint')).toBeInTheDocument();

    fireEvent.click(screen.getByText('History'));
    expect(await screen.findByText('event-1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Replay'));
    await waitFor(() => expect(mockReplayWalletWebhookDelivery).toHaveBeenCalledTimes(1));

    const deliveryCallsBeforeSwitch = mockGetWalletWebhookDeliveries.mock.calls.length;

    rerender(<WalletWebhooks walletId="wallet-b" userRole="owner" />);
    expect(await screen.findByText('Bravo endpoint')).toBeInTheDocument();

    resolveReplay({
      success: true,
      queued: true,
      message: 'Webhook delivery replay queued',
      delivery: makeDelivery({ status: 'pending' }),
    });
    await waitFor(() => {
      expect(screen.getByText('Bravo endpoint')).toBeInTheDocument();
    });
    expect(screen.queryByText('Webhook delivery replay queued')).not.toBeInTheDocument();
    expect(mockGetWalletWebhookDeliveries.mock.calls.length).toBe(deliveryCallsBeforeSwitch);
  });

  it('discards a stale delivery history response after switching wallets', async () => {
    let resolveDeliveries!: (value: ReturnType<typeof makeDelivery>[]) => void;
    const pendingDeliveries = new Promise<ReturnType<typeof makeDelivery>[]>(resolve => { resolveDeliveries = resolve; });

    mockListWalletWebhooks.mockImplementation((walletId: string) => (
      walletId === 'wallet-a'
        ? Promise.resolve([makeWebhook({ id: 'webhook-a', name: 'Alpha endpoint' })])
        : Promise.resolve([makeWebhook({ id: 'webhook-b', name: 'Bravo endpoint' })])
    ));
    mockGetWalletWebhookDeliveries.mockReturnValue(pendingDeliveries);

    const { rerender } = render(<WalletWebhooks walletId="wallet-a" userRole="owner" />);
    expect(await screen.findByText('Alpha endpoint')).toBeInTheDocument();

    fireEvent.click(screen.getByText('History'));
    await waitFor(() => expect(mockGetWalletWebhookDeliveries).toHaveBeenCalledTimes(1));

    rerender(<WalletWebhooks walletId="wallet-b" userRole="owner" />);
    expect(await screen.findByText('Bravo endpoint')).toBeInTheDocument();

    resolveDeliveries([makeDelivery()]);
    await waitFor(() => {
      expect(screen.getByText('Bravo endpoint')).toBeInTheDocument();
    });
    expect(screen.queryByText('event-1')).not.toBeInTheDocument();
  });

  it('discards a stale delivery history failure after switching wallets', async () => {
    let rejectDeliveries!: (err: unknown) => void;
    const pendingDeliveries = new Promise<ReturnType<typeof makeDelivery>[]>((_resolve, reject) => { rejectDeliveries = reject; });

    mockListWalletWebhooks.mockImplementation((walletId: string) => (
      walletId === 'wallet-a'
        ? Promise.resolve([makeWebhook({ id: 'webhook-a', name: 'Alpha endpoint' })])
        : Promise.resolve([makeWebhook({ id: 'webhook-b', name: 'Bravo endpoint' })])
    ));
    mockGetWalletWebhookDeliveries.mockReturnValue(pendingDeliveries);

    const { rerender } = render(<WalletWebhooks walletId="wallet-a" userRole="owner" />);
    expect(await screen.findByText('Alpha endpoint')).toBeInTheDocument();

    fireEvent.click(screen.getByText('History'));
    await waitFor(() => expect(mockGetWalletWebhookDeliveries).toHaveBeenCalledTimes(1));

    rerender(<WalletWebhooks walletId="wallet-b" userRole="owner" />);
    expect(await screen.findByText('Bravo endpoint')).toBeInTheDocument();

    rejectDeliveries(new Error('stale history failure'));
    await waitFor(() => {
      expect(screen.getByText('Bravo endpoint')).toBeInTheDocument();
    });
    expect(screen.queryByText('stale history failure')).not.toBeInTheDocument();
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
    configuredHeaderNames: [],
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
