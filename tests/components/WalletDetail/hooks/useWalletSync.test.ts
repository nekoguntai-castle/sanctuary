import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWalletSync } from "../../../../src/components/WalletDetail/hooks/useWalletSync";
import { useErrorHandler } from "../../../../src/hooks/useErrorHandler";
import * as syncApi from "../../../../src/api/sync";

vi.mock("../../../../src/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../../../src/api/sync", () => ({
  syncWallet: vi.fn(),
  resyncWallet: vi.fn(),
}));

vi.mock("../../../../src/hooks/useErrorHandler", () => ({
  useErrorHandler: vi.fn(),
}));

describe("useWalletSync", () => {
  const onDataRefresh = vi.fn().mockResolvedValue(undefined);
  const handleError = vi.fn();
  const showSuccess = vi.fn();
  const showWarning = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useErrorHandler).mockReturnValue({
      handleError,
      showSuccess,
      showWarning,
    } as never);
    vi.mocked(syncApi.syncWallet).mockResolvedValue({
      success: true,
      status: "requested",
      generation: 1,
      wakeup: "enqueued",
      message: "Wallet sync requested",
    });
    vi.mocked(syncApi.resyncWallet).mockResolvedValue({
      message: "queued",
    } as never);
    (
      globalThis as typeof globalThis & { confirm: (msg?: string) => boolean }
    ).confirm = vi.fn(() => true);
  });

  it("runs sync and refreshes data", async () => {
    const { result } = renderHook(() =>
      useWalletSync({
        walletId: "wallet-1",
        onDataRefresh,
      }),
    );

    await act(async () => {
      await result.current.handleSync();
    });

    expect(syncApi.syncWallet).toHaveBeenCalledWith("wallet-1");
    expect(showSuccess).toHaveBeenCalledWith(
      "Wallet sync requested",
      "Sync Requested",
    );
    expect(onDataRefresh).toHaveBeenCalled();
    expect(result.current.syncing).toBe(false);
  });

  it("handles sync errors through error handler", async () => {
    vi.mocked(syncApi.syncWallet).mockRejectedValue(new Error("sync failed"));

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: "wallet-1",
        onDataRefresh,
      }),
    );

    await act(async () => {
      await result.current.handleSync();
    });

    expect(handleError).toHaveBeenCalledWith(expect.any(Error), "Sync Failed");
    expect(result.current.syncing).toBe(false);
  });

  it("warns when a request merges with existing work", async () => {
    vi.mocked(syncApi.syncWallet).mockResolvedValue({
      success: true,
      status: "merged",
      generation: 4,
      wakeup: "enqueued",
      message: "Wallet sync merged with existing work",
    });

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: "wallet-1",
        onDataRefresh,
      }),
    );

    await act(async () => {
      await result.current.handleSync();
    });

    expect(showWarning).toHaveBeenCalledWith(
      "Wallet sync merged with existing work",
      "Sync Request Merged",
    );
    expect(onDataRefresh).toHaveBeenCalledTimes(1);
    expect(handleError).not.toHaveBeenCalled();
  });

  it("warns that a durable request was saved when its wakeup is unavailable", async () => {
    vi.mocked(syncApi.syncWallet).mockResolvedValue({
      success: true,
      status: "requested",
      generation: 5,
      wakeup: "unavailable",
      message: "Wallet sync requested",
    });

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: "wallet-1",
        onDataRefresh,
      }),
    );

    await act(async () => {
      await result.current.handleSync();
    });

    expect(showWarning).toHaveBeenCalledWith(
      "Wallet sync requested",
      "Sync Request Saved",
    );
    expect(onDataRefresh).toHaveBeenCalled();
  });

  it("warns when a durable request is deferred behind current work", async () => {
    vi.mocked(syncApi.syncWallet).mockResolvedValue({
      success: true,
      status: "requested",
      generation: 6,
      wakeup: "deferred_full_resync",
      message: "Wallet sync requested",
    });

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: "wallet-1",
        onDataRefresh,
      }),
    );

    await act(async () => {
      await result.current.handleSync();
    });

    expect(showWarning).toHaveBeenCalledWith(
      "Wallet sync requested",
      "Sync Request Deferred",
    );
    expect(onDataRefresh).toHaveBeenCalled();
  });

  it("keeps a successful sync admission pending when status refresh fails", async () => {
    onDataRefresh.mockRejectedValueOnce(new Error("refresh failed"));
    const { result } = renderHook(() => useWalletSync({
      walletId: "wallet-1",
      onDataRefresh,
    }));

    await act(async () => result.current.handleSync());

    expect(result.current.acceptedIntent).toEqual({ kind: "incremental", generation: 1 });
    expect(handleError).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledWith(
      "The sync request was accepted, but its latest status could not be refreshed yet.",
      "Sync Status Not Refreshed",
    );
  });

  it("clears only an accepted incremental watermark acknowledged by a current snapshot", async () => {
    const { result, rerender } = renderHook(
      ({ requested }) => useWalletSync({
        walletId: "wallet-1",
        onDataRefresh,
        syncState: {
          requestedIncrementalSyncGeneration: requested,
          processedIncrementalSyncGeneration: 0,
        },
      }),
      { initialProps: { requested: 0 } },
    );

    await act(async () => result.current.handleSync());
    expect(result.current.acceptedIntent?.generation).toBe(1);
    rerender({ requested: 0 });
    expect(result.current.acceptedIntent?.generation).toBe(1);
    rerender({ requested: 1 });
    expect(result.current.acceptedIntent).toBeNull();
  });

  it("retains an equal-generation reopen until state-version evidence advances", async () => {
    vi.mocked(syncApi.syncWallet).mockResolvedValue({
      success: true,
      status: "merged",
      generation: 4,
      wakeup: "enqueued",
      message: "Action-required sync reopened",
    });
    const { result, rerender } = renderHook(
      ({ stateVersion }) => useWalletSync({
        walletId: "wallet-1",
        onDataRefresh,
        syncState: {
          syncStateVersion: stateVersion,
          requestedIncrementalSyncGeneration: 4,
          processedIncrementalSyncGeneration: 3,
        },
      }),
      { initialProps: { stateVersion: 7 } },
    );

    await act(async () => result.current.handleSync());
    expect(result.current.acceptedIntent).toEqual({ kind: "incremental", generation: 4 });
    rerender({ stateVersion: 7 });
    expect(result.current.acceptedIntent).not.toBeNull();
    rerender({ stateVersion: 8 });
    expect(result.current.acceptedIntent).toBeNull();
  });

  it("aborts full resync when user cancels confirmation", async () => {
    (
      globalThis as typeof globalThis & { confirm: (msg?: string) => boolean }
    ).confirm = vi.fn(() => false);

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: "wallet-1",
        onDataRefresh,
      }),
    );

    await act(async () => {
      await result.current.handleFullResync();
    });

    expect(syncApi.resyncWallet).not.toHaveBeenCalled();
  });

  it("queues full resync and shows success when the queue accepted it", async () => {
    vi.mocked(syncApi.resyncWallet).mockResolvedValue({
      message: "queued",
      status: "accepted",
      generation: 1,
    } as never);

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: "wallet-1",
        onDataRefresh,
      }),
    );

    await act(async () => {
      await result.current.handleFullResync();
    });

    expect(syncApi.resyncWallet).toHaveBeenCalledWith("wallet-1");
    expect(showSuccess).toHaveBeenCalledWith("queued", "Resync Queued");
    expect(showWarning).not.toHaveBeenCalled();
    expect(onDataRefresh).toHaveBeenCalled();
    expect(result.current.syncing).toBe(false);
  });

  it("does not report a deduplicated resync as a success", async () => {
    vi.mocked(syncApi.resyncWallet).mockResolvedValue({
      message: "Full resync already queued for this wallet",
      status: "deduplicated",
      generation: 1,
    } as never);

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: "wallet-1",
        onDataRefresh,
      }),
    );

    await act(async () => {
      await result.current.handleFullResync();
    });

    expect(showSuccess).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledWith(
      "Full resync already queued for this wallet",
      "Resync Already Queued",
    );
  });

  it("warns when a full-resync request is saved but not yet enqueued", async () => {
    vi.mocked(syncApi.resyncWallet).mockResolvedValue({
      success: true,
      message: "Full resync requested durably",
      status: "accepted",
      walletId: "wallet-1",
      generation: 2,
      incrementalGeneration: 3,
      wakeup: "unavailable",
    });

    const { result } = renderHook(() => useWalletSync({
      walletId: "wallet-1",
      onDataRefresh,
    }));

    await act(async () => {
      await result.current.handleFullResync();
    });

    expect(showSuccess).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledWith(
      "Full resync requested durably",
      "Resync Request Saved",
    );
  });

  it("keeps a successful full-resync admission pending when status refresh fails", async () => {
    vi.mocked(syncApi.resyncWallet).mockResolvedValue({
      success: true,
      message: "queued",
      status: "accepted",
      walletId: "wallet-1",
      generation: 7,
      incrementalGeneration: 3,
      wakeup: "enqueued",
    });
    onDataRefresh.mockRejectedValueOnce(new Error("refresh failed"));
    const { result } = renderHook(() => useWalletSync({
      walletId: "wallet-1",
      onDataRefresh,
    }));

    await act(async () => result.current.handleFullResync());

    expect(result.current.acceptedIntent).toEqual({ kind: "full_resync", generation: 7 });
    expect(handleError).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledWith(
      "The full-resync request was accepted, but its latest status could not be refreshed yet.",
      "Sync Status Not Refreshed",
    );
  });

  it.each(["incremental", "full_resync"] as const)(
    "suppresses a late %s refresh warning after route ownership changes",
    async (kind) => {
      if (kind === "full_resync") {
        vi.mocked(syncApi.resyncWallet).mockResolvedValue({
          success: true,
          message: "queued",
          status: "accepted",
          walletId: "wallet-1",
          generation: 2,
          incrementalGeneration: 1,
          wakeup: "enqueued",
        });
      }
      let rejectRefresh!: (reason: unknown) => void;
      const onRefresh = vi.fn(() => new Promise<void>((_resolve, reject) => {
        rejectRefresh = reject;
      }));
      const { result, rerender } = renderHook(
        ({ walletId }) => useWalletSync({
          walletId,
          ownershipKey: walletId,
          onDataRefresh: onRefresh,
        }),
        { initialProps: { walletId: "wallet-1" } },
      );
      let operation!: Promise<void>;
      act(() => {
        operation = kind === "full_resync"
          ? result.current.handleFullResync()
          : result.current.handleSync();
      });
      await waitFor(() => expect(onRefresh).toHaveBeenCalled());

      rerender({ walletId: "wallet-2" });
      await act(async () => {
        rejectRefresh(new Error("late refresh failure"));
        await operation;
      });

      expect(showWarning).not.toHaveBeenCalledWith(
        expect.any(String),
        "Sync Status Not Refreshed",
      );
    },
  );

  it("handles full resync failures through error handler", async () => {
    vi.mocked(syncApi.resyncWallet).mockRejectedValue(
      new Error("resync failed"),
    );

    const { result } = renderHook(() =>
      useWalletSync({
        walletId: "wallet-1",
        onDataRefresh,
      }),
    );

    await act(async () => {
      await result.current.handleFullResync();
    });

    expect(handleError).toHaveBeenCalledWith(
      expect.any(Error),
      "Resync Failed",
    );
    expect(result.current.syncing).toBe(false);
  });

  it("returns early from sync actions when walletId is missing", async () => {
    const { result } = renderHook(() =>
      useWalletSync({
        walletId: undefined,
        onDataRefresh,
      }),
    );

    await act(async () => {
      await result.current.handleSync();
      await result.current.handleFullResync();
    });

    expect(syncApi.syncWallet).not.toHaveBeenCalled();
    expect(syncApi.resyncWallet).not.toHaveBeenCalled();
    expect(onDataRefresh).not.toHaveBeenCalled();
  });

  it("exposes state setters for syncing and retry info", () => {
    const { result } = renderHook(() =>
      useWalletSync({
        walletId: "wallet-1",
        onDataRefresh,
      }),
    );

    act(() => {
      result.current.setSyncing(true);
      result.current.setSyncRetryInfo({
        retryCount: 2,
        maxRetries: 5,
        error: "temporary failure",
      });
    });

    expect(result.current.syncing).toBe(true);
    expect(result.current.syncRetryInfo).toEqual({
      retryCount: 2,
      maxRetries: 5,
      error: "temporary failure",
    });
  });
});
