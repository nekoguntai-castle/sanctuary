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

// A separate top-level describe (rather than more `it`s above) keeps that
// block's setup/render callback under the lizard NLOC warning threshold.
describe('useWalletTelegramSettingsController save ordering', () => {
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

  it('shows the latest successful save and ignores an earlier save on the same wallet that rejects afterward', async () => {
    vi.mocked(walletsApi.getWalletTelegramSettings).mockResolvedValue(settingsFor(false));

    let rejectFirst!: (err: unknown) => void;
    let callCount = 0;
    vi.mocked(walletsApi.updateWalletTelegramSettings).mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        // The first save (toggling `enabled`) stays pending until released
        // below, well after the second save has already resolved.
        return new Promise((_resolve, reject) => {
          rejectFirst = reject;
        });
      }
      return Promise.resolve(undefined as never);
    });

    const { result } = renderHook(() => useWalletTelegramSettingsController('wallet-a'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.handleToggle('enabled');
    });
    await waitFor(() => expect(result.current.saving).toBe(true));

    act(() => {
      result.current.handleToggle('notifyReceived');
    });

    // The second (later) save resolves first.
    await waitFor(() => expect(result.current.success).toBe(true));
    expect(result.current.settings.enabled).toBe(true);
    expect(result.current.settings.notifyReceived).toBe(false);
    expect(result.current.error).toBeNull();

    // The first save — now stale — rejects after the second already
    // committed. It must not revert the second save's committed change.
    await act(async () => {
      rejectFirst(new Error('boom'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.settings.enabled).toBe(true);
    expect(result.current.settings.notifyReceived).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('reverts to the last confirmed settings when both saves in a rapid toggle sequence fail', async () => {
    vi.mocked(walletsApi.getWalletTelegramSettings).mockResolvedValue(settingsFor(false));

    const rejections: Array<(err: unknown) => void> = [];
    vi.mocked(walletsApi.updateWalletTelegramSettings).mockImplementation(
      () => new Promise((_resolve, reject) => {
        rejections.push(reject);
      })
    );

    const { result } = renderHook(() => useWalletTelegramSettingsController('wallet-a'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Two rapid toggles, both queued before either save settles. Both must
    // apply optimistically — the second must not read a stale closure and
    // clobber the first's change.
    act(() => {
      result.current.handleToggle('enabled');
      result.current.handleToggle('notifyReceived');
    });

    expect(result.current.settings.enabled).toBe(true);
    expect(result.current.settings.notifyReceived).toBe(false);

    await waitFor(() => expect(rejections.length).toBe(2));

    await act(async () => {
      rejections[0](new Error('first save failed'));
      rejections[1](new Error('second save failed'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Only the latest (second) save's failure is live; it reverts to the
    // last confirmed settings (the state as loaded), not the first toggle's
    // captured snapshot.
    expect(result.current.settings).toEqual(settingsFor(false));
    expect(result.current.error).not.toBeNull();
  });
});
