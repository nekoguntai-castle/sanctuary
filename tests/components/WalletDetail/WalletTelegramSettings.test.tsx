import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WalletTelegramSettings } from '../../../components/WalletDetail/WalletTelegramSettings';
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
    getWalletTelegramSettings: vi.fn(),
    updateWalletTelegramSettings: vi.fn(),
  };
});

describe('WalletTelegramSettings', () => {
  const walletId = 'wallet-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(walletsApi.getWalletTelegramSettings).mockResolvedValue({
      enabled: false,
      notifyReceived: true,
      notifySent: true,
      notifyConsolidation: true,
      notifyDraft: true,
    });
    vi.mocked(walletsApi.updateWalletTelegramSettings).mockResolvedValue(undefined as never);
  });

  it('shows setup warning when telegram is not configured', async () => {
    vi.mocked(useUser).mockReturnValue({
      user: { id: 'u1', preferences: {} },
      isLoading: false,
    } as never);

    render(<WalletTelegramSettings walletId={walletId} />);

    expect(await screen.findByText('Telegram Notifications')).toBeInTheDocument();
    expect(screen.getByText('Telegram not configured')).toBeInTheDocument();
    expect(screen.queryByText('Enable for this wallet')).not.toBeInTheDocument();
  });

  it('shows global-disabled warning when telegram is configured but disabled', async () => {
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

    render(<WalletTelegramSettings walletId={walletId} />);

    expect(await screen.findByText('Telegram notifications disabled')).toBeInTheDocument();
    expect(screen.queryByText('Enable for this wallet')).not.toBeInTheDocument();
  });

  it('renders wallet-level toggles and persists setting changes', async () => {
    const user = userEvent.setup();
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

    render(<WalletTelegramSettings walletId={walletId} />);

    await screen.findByText('Enable for this wallet');

    const walletToggle = screen.getByRole('button');
    await user.click(walletToggle);

    await waitFor(() => {
      expect(walletsApi.updateWalletTelegramSettings).toHaveBeenCalledWith(walletId, {
        enabled: true,
        notifyReceived: true,
        notifySent: true,
        notifyConsolidation: true,
        notifyDraft: true,
      });
    });

    expect(await screen.findByText('Saved!')).toBeInTheDocument();
    expect(screen.getByLabelText('Bitcoin sent')).toBeInTheDocument();
  });

  it('reverts UI and shows API error message when save fails', async () => {
    const user = userEvent.setup();

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

    vi.mocked(walletsApi.getWalletTelegramSettings).mockResolvedValue({
      enabled: true,
      notifyReceived: true,
      notifySent: true,
      notifyConsolidation: true,
      notifyDraft: true,
    });

    vi.mocked(walletsApi.updateWalletTelegramSettings).mockRejectedValue(
      new ApiError('Could not update', 400)
    );

    render(<WalletTelegramSettings walletId={walletId} />);

    const sentCheckbox = await screen.findByLabelText('Bitcoin sent');
    expect(sentCheckbox).toBeChecked();

    await user.click(sentCheckbox);

    expect(await screen.findByText('Could not update')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Bitcoin sent')).toBeChecked();
    });
  });

  it('uses default error message for non-ApiError failures', async () => {
    const user = userEvent.setup();

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

    vi.mocked(walletsApi.getWalletTelegramSettings).mockRejectedValue(new Error('fetch failed'));
    vi.mocked(walletsApi.updateWalletTelegramSettings).mockRejectedValue(new Error('boom'));

    render(<WalletTelegramSettings walletId={walletId} />);

    await screen.findByText('Enable for this wallet');
    const walletToggle = screen.getByRole('button');
    await user.click(walletToggle);

    expect(await screen.findByText('Failed to update settings')).toBeInTheDocument();
  });

  it('covers remaining notification toggles and success-timeout reset', async () => {
    const user = userEvent.setup();
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

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

    vi.mocked(walletsApi.getWalletTelegramSettings).mockResolvedValue({
      enabled: true,
      notifyReceived: true,
      notifySent: true,
      notifyConsolidation: true,
      notifyDraft: true,
    });

    render(<WalletTelegramSettings walletId={walletId} />);

    const receivedCheckbox = await screen.findByLabelText('Bitcoin received');
    const consolidationCheckbox = screen.getByLabelText('Consolidation transactions');
    const draftCheckbox = screen.getByLabelText('Draft transactions (awaiting signature)');

    await user.click(receivedCheckbox);
    await waitFor(() => {
      expect(walletsApi.updateWalletTelegramSettings).toHaveBeenCalledWith(
        walletId,
        expect.objectContaining({ notifyReceived: false })
      );
    });

    await user.click(consolidationCheckbox);
    await waitFor(() => {
      expect(walletsApi.updateWalletTelegramSettings).toHaveBeenCalledWith(
        walletId,
        expect.objectContaining({ notifyConsolidation: false })
      );
    });

    await user.click(draftCheckbox);
    await waitFor(() => {
      expect(walletsApi.updateWalletTelegramSettings).toHaveBeenCalledWith(
        walletId,
        expect.objectContaining({ notifyDraft: false })
      );
    });

    expect(screen.getByText('Saved!')).toBeInTheDocument();

    const timeoutCallbacks = timeoutSpy.mock.calls
      .filter(([, delay]) => delay === 2000)
      .map(([callback]) => callback)
      .filter((callback): callback is () => void => typeof callback === 'function');

    act(() => {
      timeoutCallbacks.forEach((callback) => callback());
    });

    expect(screen.queryByText('Saved!')).not.toBeInTheDocument();
    timeoutSpy.mockRestore();
  });
});
