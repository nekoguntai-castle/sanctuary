import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletSync } from '../../../../components/WalletDetail/hooks/useWalletSync';
import * as syncApi from '../../../../src/api/sync';
import * as walletsApi from '../../../../src/api/wallets';
import { useErrorHandler } from '../../../../hooks/useErrorHandler';

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../src/api/sync', () => ({
  syncWallet: vi.fn(),
  resyncWallet: vi.fn(),
}));

vi.mock('../../../../src/api/wallets', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    repairWallet: vi.fn(),
  };
});

vi.mock('../../../../hooks/useErrorHandler', () => ({
  useErrorHandler: vi.fn(),
}));

describe('useWalletSync', () => {
  const onDataRefresh = vi.fn().mockResolvedValue(undefined);
  const handleError = vi.fn();
  const showSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useErrorHandler).mockReturnValue({ handleError, showSuccess } as never);
    vi.mocked(syncApi.syncWallet).mockResolvedValue({ success: true });
    vi.mocked(syncApi.resyncWallet).mockResolvedValue({ message: 'queued' } as never);
    vi.mocked(walletsApi.repairWallet).mockResolvedValue({ success: true, message: 'repaired' } as never);
    (globalThis as typeof globalThis & { confirm: (msg?: string) => boolean }).confirm = vi.fn(() => true);
  });

  it('runs sync and refreshes data', async () => {
    const { result } = renderHook(() =>
      useWalletSync({
        walletId: 'wallet-1',
        onDataRefresh,
      })
    );

    await act(async () => {
      await result.current.handleSync();
    });

    expect(syncApi.syncWallet).toHaveBeenCalledWith('wallet-1');
    expect(onDataRefresh).toHaveBeenCalled();
    expect(result.current.syncing).toBe(false);
  });

  it('handles sync errors through error handler', async () => {
    vi.mocked(syncApi.syncWallet).mockRejectedValue(new Error('sync failed'));

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: 'wallet-1',
        onDataRefresh,
      })
    );

    await act(async () => {
      await result.current.handleSync();
    });

    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Sync Failed');
    expect(result.current.syncing).toBe(false);
  });

  it('refreshes data when sync result is non-success without an explicit error', async () => {
    vi.mocked(syncApi.syncWallet).mockResolvedValue({ success: false } as never);

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: 'wallet-1',
        onDataRefresh,
      })
    );

    await act(async () => {
      await result.current.handleSync();
    });

    expect(onDataRefresh).toHaveBeenCalled();
    expect(handleError).not.toHaveBeenCalled();
  });

  it('still refreshes when sync returns an explicit API error payload', async () => {
    vi.mocked(syncApi.syncWallet).mockResolvedValue({ success: false, error: 'backend timeout' } as never);

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: 'wallet-1',
        onDataRefresh,
      })
    );

    await act(async () => {
      await result.current.handleSync();
    });

    expect(onDataRefresh).toHaveBeenCalled();
    expect(handleError).not.toHaveBeenCalled();
  });

  it('aborts full resync when user cancels confirmation', async () => {
    (globalThis as typeof globalThis & { confirm: (msg?: string) => boolean }).confirm = vi.fn(() => false);

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: 'wallet-1',
        onDataRefresh,
      })
    );

    await act(async () => {
      await result.current.handleFullResync();
    });

    expect(syncApi.resyncWallet).not.toHaveBeenCalled();
  });

  it('queues full resync and shows success', async () => {
    const { result } = renderHook(() =>
      useWalletSync({
        walletId: 'wallet-1',
        onDataRefresh,
      })
    );

    await act(async () => {
      await result.current.handleFullResync();
    });

    expect(syncApi.resyncWallet).toHaveBeenCalledWith('wallet-1');
    expect(showSuccess).toHaveBeenCalledWith('queued', 'Resync Queued');
    expect(onDataRefresh).toHaveBeenCalled();
    expect(result.current.syncing).toBe(false);
  });

  it('handles full resync failures through error handler', async () => {
    vi.mocked(syncApi.resyncWallet).mockRejectedValue(new Error('resync failed'));

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: 'wallet-1',
        onDataRefresh,
      })
    );

    await act(async () => {
      await result.current.handleFullResync();
    });

    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Resync Failed');
    expect(result.current.syncing).toBe(false);
  });

  it('repairs wallet and reports success', async () => {
    const { result } = renderHook(() =>
      useWalletSync({
        walletId: 'wallet-1',
        onDataRefresh,
      })
    );

    await act(async () => {
      await result.current.handleRepairWallet();
    });

    expect(walletsApi.repairWallet).toHaveBeenCalledWith('wallet-1');
    expect(showSuccess).toHaveBeenCalledWith('repaired', 'Repair Complete');
    expect(onDataRefresh).toHaveBeenCalled();
    expect(result.current.repairing).toBe(false);
  });

  it('reports non-successful repair result as error', async () => {
    vi.mocked(walletsApi.repairWallet).mockResolvedValue({
      success: false,
      message: 'bad descriptor',
    } as never);

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: 'wallet-1',
        onDataRefresh,
      })
    );

    await act(async () => {
      await result.current.handleRepairWallet();
    });

    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Repair Failed');
    expect(result.current.repairing).toBe(false);
  });

  it('handles thrown repair failures through error handler', async () => {
    vi.mocked(walletsApi.repairWallet).mockRejectedValue(new Error('repair exploded'));

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: 'wallet-1',
        onDataRefresh,
      })
    );

    await act(async () => {
      await result.current.handleRepairWallet();
    });

    expect(handleError).toHaveBeenCalledWith(expect.any(Error), 'Repair Failed');
    expect(result.current.repairing).toBe(false);
  });

  it('returns early from sync actions when walletId is missing', async () => {
    const { result } = renderHook(() =>
      useWalletSync({
        walletId: undefined,
        onDataRefresh,
      })
    );

    await act(async () => {
      await result.current.handleSync();
      await result.current.handleFullResync();
      await result.current.handleRepairWallet();
    });

    expect(syncApi.syncWallet).not.toHaveBeenCalled();
    expect(syncApi.resyncWallet).not.toHaveBeenCalled();
    expect(walletsApi.repairWallet).not.toHaveBeenCalled();
    expect(onDataRefresh).not.toHaveBeenCalled();
  });

  it('exposes state setters for syncing and retry info', () => {
    const { result } = renderHook(() =>
      useWalletSync({
        walletId: 'wallet-1',
        onDataRefresh,
      })
    );

    act(() => {
      result.current.setSyncing(true);
      result.current.setSyncRetryInfo({
        active: true,
        currentRetry: 2,
        maxRetries: 5,
        retryInSeconds: 8,
      });
    });

    expect(result.current.syncing).toBe(true);
    expect(result.current.syncRetryInfo).toEqual({
      active: true,
      currentRetry: 2,
      maxRetries: 5,
      retryInSeconds: 8,
    });
  });
});
