import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WalletHeader } from "../../../src/components/WalletDetail/WalletHeader";
import { WalletType } from "../../../src/types";

vi.mock("../../../src/components/Amount", () => ({
  Amount: ({ sats }: { sats: number }) => (
    <div data-testid="amount">{sats}</div>
  ),
}));

const baseWallet = {
  id: "wallet-1",
  name: "Primary Wallet",
  type: WalletType.SINGLE_SIG,
  network: "mainnet",
  balance: 123_456,
  quorum: { m: 1, n: 1 },
  totalSigners: 1,
  userRole: "owner",
  isShared: false,
  lastSyncStatus: null,
  lastSyncedAt: null,
  syncInProgress: false,
} as any;

const idleSyncControls = {
  requestSubmitting: false,
  executionRunning: false,
  requestPending: false,
  incrementalPending: false,
  fullResyncPending: false,
  actionRequired: false,
  syncDisabled: false,
  fullResyncDisabled: false,
};

const renderHeader = (
  walletOverrides: Record<string, unknown> = {},
  propOverrides: Record<string, unknown> = {},
) => {
  const handlers = {
    onReceive: vi.fn(),
    onSend: vi.fn(),
    onSync: vi.fn(),
    onFullResync: vi.fn(),
    onExport: vi.fn(),
  };

  const view = render(
    <WalletHeader
      wallet={{ ...baseWallet, ...walletOverrides }}
      syncing={false}
      syncControls={idleSyncControls}
      syncRetryInfo={null}
      {...handlers}
      {...propOverrides}
    />,
  );

  return { ...view, handlers };
};

describe("WalletHeader", () => {
  it("renders single-sig owner wallet actions and handles button clicks", () => {
    const { handlers } = renderHeader();

    expect(screen.getByText("Single Sig")).toBeInTheDocument();
    expect(screen.queryByText("mainnet")).not.toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Receive/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Receive/i }));
    fireEvent.click(screen.getByRole("button", { name: /Send/i }));
    fireEvent.click(screen.getByTitle("Sync wallet"));
    fireEvent.click(
      screen.getByTitle("Full resync (clears and re-syncs all transactions)"),
    );
    fireEvent.click(screen.getByTitle("Export wallet"));

    expect(handlers.onReceive).toHaveBeenCalledTimes(1);
    expect(handlers.onSend).toHaveBeenCalledTimes(1);
    expect(handlers.onSync).toHaveBeenCalledTimes(1);
    expect(handlers.onFullResync).toHaveBeenCalledTimes(1);
    expect(handlers.onExport).toHaveBeenCalledTimes(1);
  });

  it("renders multisig retrying state with signer/shared badges", () => {
    renderHeader(
      {
        type: WalletType.MULTI_SIG,
        quorum: { m: 2, n: 3 },
        totalSigners: 3,
        network: "signet",
        userRole: "signer",
        isShared: true,
        lastSyncStatus: "retrying",
        requestedIncrementalSyncGeneration: 1,
        processedIncrementalSyncGeneration: 0,
      },
      {
        syncRetryInfo: {
          retryCount: 2,
          maxRetries: 5,
          error: "temporary error",
        },
      },
    );

    expect(screen.getByText("2/3 Multisig")).toBeInTheDocument();
    expect(screen.getByText("Signet")).toHaveClass("dark:text-signet-300");
    expect(screen.getByText("Retrying 2/5")).toBeInTheDocument();
    expect(screen.getByText("Signer")).toBeInTheDocument();
    expect(screen.getByText("Shared")).toBeInTheDocument();
  });

  it("renders linked agent wallet role badges", () => {
    renderHeader(
      {},
      {
        agentLinks: [
          {
            agentId: "agent-1",
            agentName: "Treasury Agent",
            role: "funding",
            linkedWalletName: "Operational",
            status: "active",
          },
          {
            agentId: "agent-2",
            agentName: "Ops Agent",
            role: "operational",
            linkedWalletName: "Funding",
            status: "paused",
          },
        ],
      },
    );

    expect(screen.getByText("Agent Funding Wallet")).toBeInTheDocument();
    expect(screen.getByText("Agent Operational Wallet")).toBeInTheDocument();
    expect(
      screen.getByText("Agent Funding Wallet").closest("span"),
    ).toHaveAttribute(
      "title",
      "Treasury Agent links this wallet to Operational",
    );
  });

  it("never fabricates an attempt count when retry metadata is absent", () => {
    renderHeader({
      lastSyncStatus: "retrying",
      lastSyncError: "connect ECONNREFUSED 127.0.0.1:50002",
      network: "testnet3",
      requestedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 0,
    });

    expect(screen.getByText("Testnet3")).toHaveClass("dark:text-testnet-300");
    expect(screen.getByText("Testnet3")).toHaveClass("dark:bg-testnet-900/20");
    expect(screen.getByText("Retrying")).toBeInTheDocument();
    expect(screen.queryByText("Retrying 1/3")).not.toBeInTheDocument();
    expect(
      screen.getByRole("tooltip"),
    ).toHaveTextContent("connect ECONNREFUSED 127.0.0.1:50002");
    expect(
      screen.queryByText("Sync failed, retrying..."),
    ).not.toBeInTheDocument();
  });

  it("keeps the sync-now affordance for a never-synced wallet stuck in retry", () => {
    const { handlers } = renderHeader({
      lastSyncStatus: "retrying",
      lastSyncedAt: null,
      syncInProgress: false,
    });

    fireEvent.click(screen.getByRole("button", { name: /Sync Now/i }));
    expect(handlers.onSync).toHaveBeenCalledTimes(1);
  });

  it("flags resync execution markers without a public lease as attention", () => {
    renderHeader({
      lastSyncStatus: "resyncing",
      lastSyncedAt: null,
      syncInProgress: false,
      syncStateVersion: 1,
    });

    expect(screen.getByText("Attention")).toBeInTheDocument();
    expect(screen.queryByText("Not Synced")).not.toBeInTheDocument();
    expect(screen.queryByText("Wallet not synced")).not.toBeInTheDocument();
  });

  it("renders durable queued work instead of the never-synced banner", () => {
    renderHeader({
      lastSyncedAt: null,
      lastSyncStatus: null,
      syncInProgress: false,
      requestedIncrementalSyncGeneration: 2,
      processedIncrementalSyncGeneration: 1,
    });

    expect(screen.getByText("Sync pending")).toBeInTheDocument();
    expect(screen.queryByText("Wallet not synced")).not.toBeInTheDocument();
  });

  it("renders durable full-resync work instead of the never-synced banner", () => {
    renderHeader({
      lastSyncedAt: null,
      lastSyncStatus: null,
      syncInProgress: false,
      requestedFullResyncGeneration: 2,
      processedFullResyncGeneration: 1,
    });

    expect(screen.getByText("Resync pending")).toBeInTheDocument();
    expect(screen.queryByText("Wallet not synced")).not.toBeInTheDocument();
  });

  it("shows syncing badge and disables sync controls while syncing", () => {
    const now = Date.now();
    renderHeader({
      syncInProgress: true,
      syncExecutionOwner: 'worker',
      requestedIncrementalSyncGeneration: 1,
      claimedIncrementalSyncGeneration: 1,
      processedIncrementalSyncGeneration: 0,
      incrementalSyncClaimedAt: new Date(now - 1_000).toISOString(),
      incrementalSyncLeaseExpiresAt: new Date(now + 60_000).toISOString(),
    }, {
      syncing: true,
      syncControls: {
        ...idleSyncControls,
        executionRunning: true,
        syncDisabled: true,
        fullResyncDisabled: true,
      },
    });

    expect(screen.getByText("Syncing")).toBeInTheDocument();
    expect(screen.getByTitle("Sync wallet")).toBeDisabled();
    expect(
      screen.getByTitle("Full resync (clears and re-syncs all transactions)"),
    ).toBeDisabled();
  });

  it("renders success status when sync completed", () => {
    renderHeader({
      lastSyncStatus: "success",
      lastSyncedAt: new Date(Date.now() - 60_000).toISOString(),
    });

    expect(screen.getByText("Synced")).toBeInTheDocument();
  });

  it("does not show a green success badge for a sync that is hours old", () => {
    renderHeader({
      lastSyncStatus: "success",
      lastSyncedAt: "2026-02-02T00:00:00.000Z",
    });

    expect(screen.queryByText("Synced")).not.toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
  });

  it("renders success status without last-synced timestamp and supports custom network badge", () => {
    renderHeader({
      lastSyncStatus: "success",
      lastSyncedAt: null,
      network: "testnet4",
    });

    expect(screen.getByText("Synced")).toBeInTheDocument();
    expect(screen.getByText("Testnet4")).toHaveClass("text-teal-700");
  });

  it("renders failed and cached sync statuses", () => {
    const { rerender } = renderHeader({ lastSyncStatus: "failed" });
    expect(screen.getByText("Failed")).toBeInTheDocument();

    rerender(
      <WalletHeader
        wallet={{
          ...baseWallet,
          lastSyncStatus: null,
          lastSyncedAt: "2026-02-01T00:00:00.000Z",
        }}
        syncing={false}
        syncControls={idleSyncControls}
        syncRetryInfo={null}
        onReceive={vi.fn()}
        onSend={vi.fn()}
        onSync={vi.fn()}
        onFullResync={vi.fn()}
        onExport={vi.fn()}
      />,
    );

    expect(screen.getByText("Cached")).toBeInTheDocument();
  });

  it("renders an arbitrary sync failure reason inline, not only in a tooltip", () => {
    const { handlers } = renderHeader({
      lastSyncStatus: "failed",
      lastSyncError: "connect ECONNREFUSED 127.0.0.1:50002",
    });

    expect(screen.getByText("Sync failed")).toBeInTheDocument();
    expect(
      screen.getByTestId("wallet-sync-failure-reason"),
    ).toHaveTextContent("connect ECONNREFUSED 127.0.0.1:50002");
    // One banner, not the real reason plus a vaguer card repeating it.
    expect(screen.queryByText("Wallet not synced")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sync Now/i }));
    expect(handlers.onSync).toHaveBeenCalledTimes(1);
  });

  it("shows a network sync-off warning for disabled testnet sync failures", () => {
    renderHeader({
      network: "testnet3",
      lastSyncStatus: "failed",
      lastSyncError:
        "Testnet3 sync is off in Node Configuration. Enable Testnet3 under Network Connections, save settings, then sync testnet3 wallets again.",
    });

    expect(screen.getByText("Network sync is off")).toBeInTheDocument();
    expect(screen.queryByText("Sync failed")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("wallet-sync-failure-reason"),
    ).toHaveTextContent(/Enable Testnet3 under Network Connections/i);
    expect(screen.queryByText("Wallet not synced")).not.toBeInTheDocument();
  });

  it("hides send action for viewer role", () => {
    renderHeader({ userRole: "viewer" });

    expect(screen.getByText("Viewer")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Send/i }),
    ).not.toBeInTheDocument();
  });

  it("hides send action for approver role", () => {
    renderHeader({ userRole: "approver" });

    expect(screen.getByText("Approver")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Send/i }),
    ).not.toBeInTheDocument();
  });

  it("shows initial sync banner for first sync attempts", () => {
    renderHeader({ lastSyncedAt: null, syncInProgress: true }, { syncing: true });

    expect(screen.getByText("Initial sync in progress")).toBeInTheDocument();
    expect(screen.queryByText("Wallet not synced")).not.toBeInTheDocument();
  });

  it("does not animate expired raw execution evidence", () => {
    renderHeader({
      lastSyncedAt: null,
      syncInProgress: true,
      syncStateVersion: 2,
    });

    expect(screen.queryByText("Initial sync in progress")).not.toBeInTheDocument();
  });

  it("disables every sync-now CTA while an accepted request is pending", () => {
    const pendingControls = {
      ...idleSyncControls,
      requestPending: true,
      incrementalPending: true,
      syncDisabled: true,
    };
    const failure = renderHeader({
      lastSyncStatus: "failed",
      lastSyncError: "temporary failure",
    }, { syncControls: pendingControls });
    expect(screen.getByRole("button", { name: /Sync Now/i })).toBeDisabled();
    failure.unmount();

    renderHeader({}, { syncControls: pendingControls });
    expect(screen.getByRole("button", { name: /Sync Now/i })).toBeDisabled();
  });

  it("shows never-synced banner and triggers sync now action", () => {
    const { handlers } = renderHeader({
      lastSyncedAt: null,
      lastSyncStatus: null,
      syncInProgress: false,
    });

    expect(screen.getByText("Wallet not synced")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sync Now/i }));
    expect(handlers.onSync).toHaveBeenCalledTimes(1);
  });
});
