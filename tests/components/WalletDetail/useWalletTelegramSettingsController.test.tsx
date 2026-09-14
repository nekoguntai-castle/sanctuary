import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletTelegramSettingsController } from '../../../src/components/WalletDetail/WalletTelegramSettings/useWalletTelegramSettingsController';
import { useUser } from '../../../src/contexts/UserContext';
import * as walletsApi from '../../../src/api/wallets';

const debugLog = vi.hoisted(() => vi.fn());

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: debugLog,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/contexts/UserContext', () => ({
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

describe('useWalletTelegramSettingsController', () => {
  const settingsFor = (enabled: boolean) => ({
    enabled,
    notifyReceived: true,
    notifySent: true,
    notifyConsolidation: true,
    notifyDraft: true,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    debugLog.mockClear();
    vi.mocked(useUser).mockReturnValue({
      user: {
        id: 'u1',
        preferences: {
          telegram: { botToken: 'token', chatId: 'chat-id', enabled: true },
        },
      },
      isLoading: false,
    } as never);
  });

  it('ignores a stale save rejection from a previously mounted wallet after switching wallets', async () => {
    // Wallet A's load resolves immediately; its save() stays pending until
    // released below so it can reject after wallet B is already mounted.
    vi.mocked(walletsApi.getWalletTelegramSettings).mockImplementation((walletId: string) => {
      if (walletId === 'wallet-a') {
        return Promise.resolve(settingsFor(false));
      }
      return Promise.resolve(settingsFor(true));
    });

    let rejectSaveA!: (err: unknown) => void;
    vi.mocked(walletsApi.updateWalletTelegramSettings).mockImplementation((walletId: string) => {
      if (walletId === 'wallet-a') {
        return new Promise((_resolve, reject) => {
          rejectSaveA = reject;
        });
      }
      return Promise.resolve(undefined as never);
    });

    const { result, rerender } = renderHook(
      ({ walletId }) => useWalletTelegramSettingsController(walletId),
      { initialProps: { walletId: 'wallet-a' } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.enabled).toBe(false);

    // Toggle wallet A -> kicks off a save() that will remain pending.
    act(() => {
      result.current.handleToggle('enabled');
    });
    await waitFor(() => expect(result.current.settings.enabled).toBe(true));

    // Switch to wallet B before A's save settles.
    rerender({ walletId: 'wallet-b' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings.enabled).toBe(true);
    expect(result.current.error).toBeNull();

    // Now A's stale save rejects — it must not touch B's state.
    await act(async () => {
      rejectSaveA(new Error('boom'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.settings.enabled).toBe(true);
    expect(result.current.error).toBeNull();
    // saving is unaffected by the stale rejection's finally block — it was
    // already reset to false by the wallet switch, not re-set by this call.
    expect(result.current.saving).toBe(false);
    expect(debugLog).toHaveBeenCalledWith(
      'Ignoring stale telegram settings save rejection',
      expect.objectContaining({ walletId: 'wallet-a' })
    );
  });

  it('ignores a stale save resolution from a previously mounted wallet after switching wallets', async () => {
    vi.mocked(walletsApi.getWalletTelegramSettings).mockImplementation(() => Promise.resolve(settingsFor(false)));

    let resolveSaveA!: () => void;
    vi.mocked(walletsApi.updateWalletTelegramSettings).mockImplementation((walletId: string) => {
      if (walletId === 'wallet-a') {
        return new Promise((resolve) => {
          resolveSaveA = () => resolve(undefined as never);
        });
      }
      return Promise.resolve(undefined as never);
    });

    const { result, rerender } = renderHook(
      ({ walletId }) => useWalletTelegramSettingsController(walletId),
      { initialProps: { walletId: 'wallet-a' } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleToggle('enabled');
    });
    await waitFor(() => expect(result.current.settings.enabled).toBe(true));
    expect(result.current.saving).toBe(true);

    rerender({ walletId: 'wallet-b' });
    await waitFor(() => expect(result.current.settings.enabled).toBe(false));

    await act(async () => {
      resolveSaveA();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Wallet A's stale success must not flip wallet B's "Saved!" state or
    // touch its settings.
    expect(result.current.success).toBe(false);
    expect(result.current.settings.enabled).toBe(false);
  });

  it('resets saving/success state when switching wallets while a save is still in flight', async () => {
    vi.mocked(walletsApi.getWalletTelegramSettings).mockImplementation(() => Promise.resolve(settingsFor(false)));

    // Wallet A's save never settles during this test.
    vi.mocked(walletsApi.updateWalletTelegramSettings).mockImplementation((walletId: string) => {
      if (walletId === 'wallet-a') {
        return new Promise(() => {
          // intentionally never resolves/rejects within this test
        });
      }
      return Promise.resolve(undefined as never);
    });

    const { result, rerender } = renderHook(
      ({ walletId }) => useWalletTelegramSettingsController(walletId),
      { initialProps: { walletId: 'wallet-a' } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleToggle('enabled');
    });
    await waitFor(() => expect(result.current.saving).toBe(true));

    // Switch to wallet B while A's PATCH is still pending.
    rerender({ walletId: 'wallet-b' });
    await waitFor(() => expect(result.current.settings.enabled).toBe(false));

    expect(result.current.saving).toBe(false);
    expect(result.current.success).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('clears a pending success timeout from the previous wallet when switching wallets', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    vi.mocked(walletsApi.getWalletTelegramSettings).mockImplementation(() => Promise.resolve(settingsFor(false)));
    vi.mocked(walletsApi.updateWalletTelegramSettings).mockResolvedValue(undefined as never);

    const { result, rerender } = renderHook(
      ({ walletId }) => useWalletTelegramSettingsController(walletId),
      { initialProps: { walletId: 'wallet-a' } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // A successful save on wallet A arms the 2s "Saved!" timeout.
    act(() => {
      result.current.handleToggle('enabled');
    });
    await waitFor(() => expect(result.current.success).toBe(true));

    clearTimeoutSpy.mockClear();

    // Switching wallets before the timeout fires must clear it and reset
    // success, rather than letting it later flip success back on for B.
    rerender({ walletId: 'wallet-b' });
    await waitFor(() => expect(result.current.settings.enabled).toBe(false));

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(result.current.success).toBe(false);

    clearTimeoutSpy.mockRestore();
  });

  it('does not let an older stale save clobber a newer in-flight save on the same wallet after A -> B -> A', async () => {
    vi.mocked(walletsApi.getWalletTelegramSettings).mockImplementation(() => Promise.resolve(settingsFor(false)));

    let settleCount = 0;
    let rejectFirstSaveA!: (err: unknown) => void;
    vi.mocked(walletsApi.updateWalletTelegramSettings).mockImplementation((walletId: string) => {
      settleCount += 1;
      if (walletId === 'wallet-a' && settleCount === 1) {
        // The first save kicked off on wallet A never settles until this
        // test explicitly rejects it below, well after A has been
        // remounted via A -> B -> A.
        return new Promise((_resolve, reject) => {
          rejectFirstSaveA = reject;
        });
      }
      return Promise.resolve(undefined as never);
    });

    const { result, rerender } = renderHook(
      ({ walletId }) => useWalletTelegramSettingsController(walletId),
      { initialProps: { walletId: 'wallet-a' } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Start a save on wallet A that will stay pending for the whole test.
    act(() => {
      result.current.handleToggle('enabled');
    });
    await waitFor(() => expect(result.current.saving).toBe(true));

    // Switch away to wallet B and back to wallet A. The walletId is now
    // "wallet-a" again — identical to the pending save's walletId — but
    // this is a fresh mount of wallet A, not the one that started the
    // still-pending save above.
    rerender({ walletId: 'wallet-b' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ walletId: 'wallet-a' });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.settings.enabled).toBe(false);

    // The very first save (from the original wallet-a mount) now rejects.
    // Because a walletId-only staleness check would see "wallet-a" as
    // current again, this must be proven not to touch the fresh mount's
    // state.
    await act(async () => {
      rejectFirstSaveA(new Error('boom'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.saving).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.settings.enabled).toBe(false);
  });
});
