import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WalletWebhookRow } from '../../../../components/WalletDetail/webhooks/WalletWebhookRow';
import type { WalletWebhookDelivery, WalletWebhookEndpoint } from '../../../../types';

describe('WalletWebhookRow', () => {
  it('renders endpoint metadata and emits basic row actions', () => {
    const props = rowProps({
      webhook: makeWebhook({ enabled: false, hasSecret: false, lastDeliveryStatus: null }),
    });
    render(<WalletWebhookRow {...props} />);

    expect(screen.getByText('Accounting')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText(/attempts 5/)).toBeInTheDocument();
    expect(screen.getByText('Configured headers: X-API-Key')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Test'));
    fireEvent.click(screen.getByText('History'));
    fireEvent.click(screen.getByText('Disabled'));
    fireEvent.click(screen.getByLabelText('Delete Accounting'));

    expect(props.onTest).toHaveBeenCalledTimes(1);
    expect(props.onLoadDeliveries).toHaveBeenCalledTimes(1);
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it('hides mutations for read-only roles and allows signer diagnostics only', () => {
    const props = rowProps({ canManage: false, canInspectDeliveries: true });
    const { rerender } = render(<WalletWebhookRow {...props} />);

    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.queryByText('Test')).not.toBeInTheDocument();
    expect(screen.queryByText('Update headers')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Rotate signing secret')).not.toBeInTheDocument();

    rerender(<WalletWebhookRow {...props} canInspectDeliveries={false} />);
    expect(screen.queryByText('History')).not.toBeInTheDocument();
  });

  it('renders errors, deliveries, and secret rotation controls', () => {
    const delivery = makeDelivery({
      lastAttemptAt: null,
      lastStatusCode: null,
    });
    const props = rowProps({
      webhook: makeWebhook({ lastError: 'Receiver returned HTTP 503' }),
      deliveries: { loading: false, deliveries: [delivery], error: null },
      secretValue: 'new-secret',
    });
    render(<WalletWebhookRow {...props} />);

    expect(screen.getByText('Receiver returned HTTP 503')).toBeInTheDocument();
    expect(screen.getByText(/last failed/)).toBeInTheDocument();
    expect(screen.getByText(/secret stored/)).toBeInTheDocument();
    expect(screen.getByText('event-1')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Rotate signing secret'), {
      target: { value: 'rotated-secret' },
    });
    fireEvent.click(screen.getByText('Rotate'));
    fireEvent.click(screen.getByText('Replay'));

    expect(props.onSecretChange).toHaveBeenCalledWith('rotated-secret');
    expect(props.onRotateSecret).toHaveBeenCalledTimes(1);
    expect(props.onReplay).toHaveBeenCalledWith(delivery);
  });

  it('shows delivery empty and error states', () => {
    render(
      <WalletWebhookRow
        {...rowProps({
          deliveries: {
            loading: false,
            deliveries: [],
            error: 'History unavailable',
          },
        })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('History unavailable');
    expect(screen.getByText('No deliveries yet.')).toBeInTheDocument();
  });

  it('reflects per-action busy states', () => {
    const delivery = makeDelivery();
    const props = rowProps({
      deliveries: { loading: false, deliveries: [delivery], error: null },
      secretValue: 'new-secret',
    });
    const { rerender } = render(<WalletWebhookRow {...props} busyAction="toggle:webhook-1" />);

    expect(screen.getByText('Enabled')).toBeDisabled();

    rerender(<WalletWebhookRow {...props} busyAction="delete:webhook-1" />);
    expect(screen.getByLabelText('Delete Accounting')).toBeDisabled();

    rerender(<WalletWebhookRow {...props} busyAction="secret:webhook-1" />);
    expect(screen.getByText('Rotate')).toBeDisabled();

    rerender(<WalletWebhookRow {...props} busyAction="replay:delivery-1" />);
    expect(screen.getByText('Replay')).toBeDisabled();

    rerender(<WalletWebhookRow {...props} busyAction="test:webhook-1" />);
    expect(screen.getByText('Test')).toBeDisabled();

    rerender(
      <WalletWebhookRow
        {...props}
        busyAction={null}
        deliveries={{ loading: true, deliveries: [], error: null }}
      />,
    );
    expect(screen.getByText('History')).toBeDisabled();
    expect(screen.queryByText('No deliveries yet.')).not.toBeInTheDocument();
  });
});

function rowProps(overrides: Partial<Parameters<typeof WalletWebhookRow>[0]> = {}) {
  return {
    webhook: makeWebhook(),
    canManage: true,
    canInspectDeliveries: true,
    deliveries: undefined,
    secretValue: '',
    headerUpdateValue: '',
    busyAction: null,
    onToggle: vi.fn(),
    onTest: vi.fn(),
    onLoadDeliveries: vi.fn(),
    onReplay: vi.fn(),
    onSecretChange: vi.fn(),
    onRotateSecret: vi.fn(),
    onHeaderUpdateChange: vi.fn(),
    onUpdateHeaders: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

function makeWebhook(overrides: Partial<WalletWebhookEndpoint> = {}): WalletWebhookEndpoint {
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
    configuredHeaderNames: ['X-API-Key'],
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

function makeDelivery(overrides: Partial<WalletWebhookDelivery> = {}): WalletWebhookDelivery {
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
