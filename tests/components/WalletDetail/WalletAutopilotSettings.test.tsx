import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WalletAutopilotSettings } from '../../../components/WalletDetail/WalletAutopilotSettings';
import { ApiError } from '../../../src/api/client';
import * as walletsApi from '../../../src/api/wallets';
import { useUser } from '../../../contexts/UserContext';

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../contexts/UserContext', () => ({
  useUser: vi.fn(),
}));

vi.mock('../../../src/api/wallets', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getWalletAutopilotSettings: vi.fn(),
    updateWalletAutopilotSettings: vi.fn(),
    getWalletAutopilotStatus: vi.fn(),
  };
});

const defaultSettings = {
  enabled: false,
  maxFeeRate: 5,
  minUtxoCount: 10,
  dustThreshold: 10_000,
  cooldownHours: 24,
  notifyTelegram: true,
  notifyPush: true,
  minDustCount: 0,
  maxUtxoSize: 0,
};

const defaultStatus = {
  utxoHealth: {
    totalUtxos: 25,
    dustCount: 3,
    dustValue: '15000',
    totalValue: '5000000',
    avgUtxoSize: '200000',
    smallestUtxo: '2000',
    largestUtxo: '1000000',
    consolidationCandidates: 8,
  },
  feeSnapshot: {
    timestamp: Date.now(),
    fastest: 20,
    halfHour: 15,
    hour: 10,
    economy: 4,
    minimum: 1,
  },
  settings: defaultSettings,
};

function mockTelegramUser() {
  vi.mocked(useUser).mockReturnValue({
    user: {
      id: 'u1',
      preferences: {
        telegram: {
          botToken: 'token',
          chatId: 'chat-id',
          enabled: true,
        },
      },
    },
    isLoading: false,
  } as never);
}

function mockTelegramDisabledUser() {
  vi.mocked(useUser).mockReturnValue({
    user: {
      id: 'u1',
      preferences: {
        telegram: {
          botToken: 'token',
          chatId: 'chat-id',
          enabled: false,
        },
      },
    },
    isLoading: false,
  } as never);
}

function mockNoTelegramUser() {
  vi.mocked(useUser).mockReturnValue({
    user: { id: 'u1', preferences: {} },
    isLoading: false,
  } as never);
}

describe('WalletAutopilotSettings', () => {
  const walletId = 'wallet-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue(defaultSettings);
    vi.mocked(walletsApi.updateWalletAutopilotSettings).mockResolvedValue(undefined as never);
    vi.mocked(walletsApi.getWalletAutopilotStatus).mockResolvedValue(defaultStatus);
  });

  it('shows loading skeleton initially', () => {
    mockTelegramUser();
    // Never resolve to keep loading state
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockReturnValue(new Promise(() => {}));
    vi.mocked(walletsApi.getWalletAutopilotStatus).mockReturnValue(new Promise(() => {}));

    render(<WalletAutopilotSettings walletId={walletId} />);
    expect(screen.getByText((_, el) => el?.classList.contains('animate-pulse') ?? false)).toBeInTheDocument();
  });

  it('shows feature unavailable on 403 error', async () => {
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockRejectedValue(
      new ApiError('Feature not available', 403)
    );

    render(<WalletAutopilotSettings walletId={walletId} />);

    expect(await screen.findByText('Feature not available')).toBeInTheDocument();
    expect(screen.getByText('Treasury Autopilot is not enabled on this server.')).toBeInTheDocument();
    expect(screen.queryByText('Enable Autopilot')).not.toBeInTheDocument();
  });

  it('shows warning banner when notifications are not configured', async () => {
    mockNoTelegramUser();

    render(<WalletAutopilotSettings walletId={walletId} />);

    expect(await screen.findByText('Notifications required')).toBeInTheDocument();
    expect(screen.queryByText('Enable Autopilot')).not.toBeInTheDocument();
  });

  it('renders enable toggle when telegram is configured', async () => {
    mockTelegramUser();

    render(<WalletAutopilotSettings walletId={walletId} />);

    expect(await screen.findByText('Enable Autopilot')).toBeInTheDocument();
  });

  it('toggles enabled and calls API', async () => {
    const user = userEvent.setup();
    mockTelegramUser();

    render(<WalletAutopilotSettings walletId={walletId} />);

    await screen.findByText('Enable Autopilot');
    const toggle = screen.getByRole('button');
    await user.click(toggle);

    await waitFor(() => {
      expect(walletsApi.updateWalletAutopilotSettings).toHaveBeenCalledWith(
        walletId,
        expect.objectContaining({ enabled: true })
      );
    });

    expect(await screen.findByText('Saved!')).toBeInTheDocument();
  });

  it('shows settings fields when enabled', async () => {
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue({
      ...defaultSettings,
      enabled: true,
    });

    render(<WalletAutopilotSettings walletId={walletId} />);

    expect(await screen.findByText('Max fee rate (sat/vB)')).toBeInTheDocument();
    expect(screen.getByText('Min UTXO count')).toBeInTheDocument();
    expect(screen.getByText('Dust threshold (sats)')).toBeInTheDocument();
    expect(screen.getByText('Telegram')).toBeInTheDocument();
    expect(screen.getByText('Push notifications')).toBeInTheDocument();
  });

  it('saves number field on blur', async () => {
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue({
      ...defaultSettings,
      enabled: true,
    });

    render(<WalletAutopilotSettings walletId={walletId} />);

    await screen.findByText('Max fee rate (sat/vB)');
    const inputs = screen.getAllByRole('spinbutton');
    const maxFeeInput = inputs[0]; // First number input is maxFeeRate

    fireEvent.change(maxFeeInput, { target: { value: '15' } });
    fireEvent.blur(maxFeeInput);

    await waitFor(() => {
      expect(walletsApi.updateWalletAutopilotSettings).toHaveBeenCalledWith(
        walletId,
        expect.objectContaining({ maxFeeRate: 15 })
      );
    });
  });

  it('does not save on blur when value has not changed', async () => {
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue({
      ...defaultSettings,
      enabled: true,
    });

    render(<WalletAutopilotSettings walletId={walletId} />);

    await screen.findByText('Max fee rate (sat/vB)');
    const inputs = screen.getAllByRole('spinbutton');
    const maxFeeInput = inputs[0];

    // Blur without changing
    fireEvent.blur(maxFeeInput);

    expect(walletsApi.updateWalletAutopilotSettings).not.toHaveBeenCalled();
  });

  it('shows advanced filters when expanded', async () => {
    const user = userEvent.setup();
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue({
      ...defaultSettings,
      enabled: true,
    });

    render(<WalletAutopilotSettings walletId={walletId} />);

    await screen.findByText('Advanced Filters');
    expect(screen.queryByText('Cooldown (hours)')).not.toBeInTheDocument();

    await user.click(screen.getByText('Advanced Filters'));

    expect(screen.getByText('Min dust UTXOs')).toBeInTheDocument();
    expect(screen.getByText('Max UTXO size (sats)')).toBeInTheDocument();
    expect(screen.getByText('Cooldown (hours)')).toBeInTheDocument();
  });

  it('renders UTXO health status card when enabled and status available', async () => {
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue({
      ...defaultSettings,
      enabled: true,
    });

    render(<WalletAutopilotSettings walletId={walletId} />);

    expect(await screen.findByText('UTXO Health')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument(); // totalUtxos
    expect(screen.getByText('8')).toBeInTheDocument(); // consolidationCandidates
    expect(screen.getByText('3')).toBeInTheDocument(); // dustCount
    expect(screen.getByText('4 sat/vB')).toBeInTheDocument(); // economy fee
  });

  it('does not show UTXO health card when notifications are not available', async () => {
    mockNoTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue({
      ...defaultSettings,
      enabled: true,
    });

    render(<WalletAutopilotSettings walletId={walletId} />);

    await screen.findByText('Notifications required');
    expect(screen.queryByText('UTXO Health')).not.toBeInTheDocument();
  });

  it('reverts settings and shows error on save failure', async () => {
    const user = userEvent.setup();
    mockTelegramUser();

    vi.mocked(walletsApi.updateWalletAutopilotSettings).mockRejectedValue(
      new ApiError('Could not update', 400)
    );

    render(<WalletAutopilotSettings walletId={walletId} />);

    await screen.findByText('Enable Autopilot');
    const toggle = screen.getByRole('button');
    await user.click(toggle);

    expect(await screen.findByText('Could not update')).toBeInTheDocument();
  });

  it('shows default error message for non-ApiError failures', async () => {
    const user = userEvent.setup();
    mockTelegramUser();

    vi.mocked(walletsApi.updateWalletAutopilotSettings).mockRejectedValue(new Error('network'));

    render(<WalletAutopilotSettings walletId={walletId} />);

    await screen.findByText('Enable Autopilot');
    const toggle = screen.getByRole('button');
    await user.click(toggle);

    expect(await screen.findByText('Failed to update settings')).toBeInTheDocument();
  });

  it('clears success message after timeout', async () => {
    const user = userEvent.setup();
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    mockTelegramUser();

    render(<WalletAutopilotSettings walletId={walletId} />);

    await screen.findByText('Enable Autopilot');
    const toggle = screen.getByRole('button');
    await user.click(toggle);

    expect(await screen.findByText('Saved!')).toBeInTheDocument();

    const timeoutCallbacks = timeoutSpy.mock.calls
      .filter(([, delay]) => delay === 2000)
      .map(([callback]) => callback)
      .filter((cb): cb is () => void => typeof cb === 'function');

    act(() => {
      timeoutCallbacks.forEach((cb) => cb());
    });

    expect(screen.queryByText('Saved!')).not.toBeInTheDocument();
    timeoutSpy.mockRestore();
  });

  it('toggles notification channel checkboxes', async () => {
    const user = userEvent.setup();
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue({
      ...defaultSettings,
      enabled: true,
    });

    render(<WalletAutopilotSettings walletId={walletId} />);

    const telegramCheckbox = await screen.findByLabelText('Telegram');
    await user.click(telegramCheckbox);

    await waitFor(() => {
      expect(walletsApi.updateWalletAutopilotSettings).toHaveBeenCalledWith(
        walletId,
        expect.objectContaining({ notifyTelegram: false })
      );
    });
  });

  it('toggles push notification checkbox', async () => {
    const user = userEvent.setup();
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue({
      ...defaultSettings,
      enabled: true,
    });

    render(<WalletAutopilotSettings walletId={walletId} />);

    const pushCheckbox = await screen.findByLabelText('Push notifications');
    await user.click(pushCheckbox);

    await waitFor(() => {
      expect(walletsApi.updateWalletAutopilotSettings).toHaveBeenCalledWith(
        walletId,
        expect.objectContaining({ notifyPush: false })
      );
    });
  });

  it('shows feature unavailable on 404 error', async () => {
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockRejectedValue(
      new ApiError('Not found', 404)
    );

    render(<WalletAutopilotSettings walletId={walletId} />);

    expect(await screen.findByText('Feature not available')).toBeInTheDocument();
  });

  it('shows warning when telegram is configured but globally disabled', async () => {
    mockTelegramDisabledUser();

    render(<WalletAutopilotSettings walletId={walletId} />);

    expect(await screen.findByText('Notifications required')).toBeInTheDocument();
    expect(screen.queryByText('Enable Autopilot')).not.toBeInTheDocument();
  });

  it('hides settings fields when not enabled', async () => {
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue({
      ...defaultSettings,
      enabled: false,
    });

    render(<WalletAutopilotSettings walletId={walletId} />);

    await screen.findByText('Enable Autopilot');
    expect(screen.queryByText('Max fee rate (sat/vB)')).not.toBeInTheDocument();
    expect(screen.queryByText('Conditions')).not.toBeInTheDocument();
  });

  it('rejects negative number input', async () => {
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue({
      ...defaultSettings,
      enabled: true,
    });

    render(<WalletAutopilotSettings walletId={walletId} />);

    await screen.findByText('Max fee rate (sat/vB)');
    const inputs = screen.getAllByRole('spinbutton');
    const maxFeeInput = inputs[0];

    fireEvent.change(maxFeeInput, { target: { value: '-5' } });
    // Value should not have changed from original
    expect(maxFeeInput).toHaveValue(5);
  });

  it('hides economy fee row when feeSnapshot is null', async () => {
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue({
      ...defaultSettings,
      enabled: true,
    });
    vi.mocked(walletsApi.getWalletAutopilotStatus).mockResolvedValue({
      ...defaultStatus,
      feeSnapshot: null,
    });

    render(<WalletAutopilotSettings walletId={walletId} />);

    expect(await screen.findByText('UTXO Health')).toBeInTheDocument();
    expect(screen.queryByText('Economy fee')).not.toBeInTheDocument();
  });

  it('formats large values as BTC in UTXO health card', async () => {
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue({
      ...defaultSettings,
      enabled: true,
    });
    vi.mocked(walletsApi.getWalletAutopilotStatus).mockResolvedValue({
      ...defaultStatus,
      utxoHealth: {
        ...defaultStatus.utxoHealth,
        largestUtxo: '250000000', // 2.5 BTC
      },
    });

    render(<WalletAutopilotSettings walletId={walletId} />);

    expect(await screen.findByText('2.50000000 BTC')).toBeInTheDocument();
  });

  it('hides UTXO health card when status fetch fails', async () => {
    mockTelegramUser();
    vi.mocked(walletsApi.getWalletAutopilotSettings).mockResolvedValue({
      ...defaultSettings,
      enabled: true,
    });
    vi.mocked(walletsApi.getWalletAutopilotStatus).mockRejectedValue(new Error('fetch failed'));

    render(<WalletAutopilotSettings walletId={walletId} />);

    await screen.findByText('Enable Autopilot');
    expect(screen.queryByText('UTXO Health')).not.toBeInTheDocument();
  });
});
