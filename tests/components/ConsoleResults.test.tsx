import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleResults } from "../../components/ConsoleResults";
import {
  dedupeConsoleTransactions,
  sortConsoleTransactions,
  summarizeConsoleTransactionFilters,
} from "../../components/ConsoleResults/transactionResults";
import { useWallets } from "../../hooks/queries/useWallets";
import { getTransactions } from "../../src/api/transactions";
import type { Transaction, Wallet } from "../../types";

vi.mock("../../hooks/queries/useWallets", () => ({
  useWallets: vi.fn(),
}));

vi.mock("../../src/api/transactions", () => ({
  getTransactions: vi.fn(),
}));

vi.mock("../../components/TransactionList", () => ({
  TransactionList: ({
    transactions,
    onWalletClick,
    onTransactionClick,
  }: {
    transactions: Transaction[];
    wallets: Wallet[];
    onWalletClick: (walletId: string) => void;
    onTransactionClick: (transaction: Transaction) => void;
  }) => (
    <div data-testid="transaction-list">
      {transactions.map((transaction) => (
        <div key={`${transaction.walletId}:${transaction.txid}`}>
          {transaction.walletId}:{transaction.txid}
          <button
            type="button"
            onClick={() => onWalletClick(transaction.walletId)}
          >
            Open wallet {transaction.walletId}
          </button>
          <button type="button" onClick={() => onTransactionClick(transaction)}>
            Open transaction {transaction.txid}
          </button>
        </div>
      ))}
    </div>
  ),
}));

const wallets: Wallet[] = [
  { id: "wallet-1", name: "Main Vault", type: "single_sig", balance: 0 },
  { id: "wallet-2", name: "Spending", type: "single_sig", balance: 0 },
];

function transaction(
  walletId: string,
  txid: string,
  blockTime: string,
): Transaction {
  return {
    id: `${walletId}-${txid}`,
    txid,
    walletId,
    amount: 10_000,
    confirmations: 6,
    blockTime,
  };
}

function renderResults(state?: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: "/console/results", state }]}>
        <ConsoleResults />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderResultsWithLocationProbe(
  state: Record<string, unknown>,
  onLocationChange: (location: ReturnType<typeof useLocation>) => void,
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: "/console/results", state }]}>
        <ConsoleResults />
        <LocationProbe onChange={onLocationChange} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe({
  onChange,
}: {
  onChange: (location: ReturnType<typeof useLocation>) => void;
}) {
  const location = useLocation();
  useEffect(() => onChange(location), [location, onChange]);
  return null;
}

function transactionQueryState(walletFilters: Array<Record<string, unknown>>) {
  return {
    consoleTransactionQuery: {
      prompt: "show transactions",
      walletFilters,
    },
  };
}

describe("ConsoleResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWallets).mockReturnValue({
      data: wallets,
      isLoading: false,
    } as any);
    vi.mocked(getTransactions).mockImplementation(async (walletId) => [
      transaction(walletId, `tx-${walletId}`, "2020-03-01T00:00:00.000Z"),
    ]);
  });

  it("loads and renders aggregate transaction results from Console route state", async () => {
    renderResults({
      consoleTransactionQuery: {
        prompt: "show all wallets transactions between feb 2020 and june 2020",
        walletFilters: [
          {
            walletId: "wallet-1",
            dateFrom: "2020-02-01",
            dateTo: "2020-06-30",
            type: "received",
            limit: 25,
          },
          {
            walletId: "wallet-2",
            dateFrom: "2020-02-01",
            dateTo: "2020-06-30",
            type: "received",
            limit: 25,
          },
        ],
      },
    });

    expect(await screen.findByText("wallet-1:tx-wallet-1")).toBeInTheDocument();
    expect(screen.getByText("wallet-2:tx-wallet-2")).toBeInTheDocument();
    expect(
      screen.getByText(
        "show all wallets transactions between feb 2020 and june 2020",
      ),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(getTransactions).toHaveBeenCalledTimes(2);
    });
    expect(getTransactions).toHaveBeenCalledWith(
      "wallet-1",
      expect.objectContaining({
        dateFrom: "2020-02-01T00:00:00.000Z",
        dateTo: "2020-06-30T23:59:59.999Z",
        limit: 25,
        offset: 0,
        type: "received",
      }),
    );
  });

  it("does not fetch transactions without Console result state", () => {
    renderResults();

    expect(screen.getByText("No Console result selected")).toBeInTheDocument();
    expect(getTransactions).not.toHaveBeenCalled();
  });

  it("waits for wallets before filtering route state", () => {
    vi.mocked(useWallets).mockReturnValue({
      data: [],
      isLoading: true,
    } as any);

    renderResults(transactionQueryState([{ walletId: "wallet-1" }]));

    expect(
      screen.getByText("Loading transaction results..."),
    ).toBeInTheDocument();
    expect(getTransactions).not.toHaveBeenCalled();
  });

  it("filters inaccessible wallet filters before loading results", async () => {
    vi.mocked(useWallets).mockReturnValue({
      data: [wallets[0]],
      isLoading: false,
    } as any);

    renderResults({
      consoleTransactionQuery: {
        walletFilters: [{ walletId: "wallet-1" }, { walletId: "wallet-2" }],
      },
    });

    expect(await screen.findByText("wallet-1:tx-wallet-1")).toBeInTheDocument();
    expect(screen.queryByText("wallet-2:tx-wallet-2")).not.toBeInTheDocument();
    expect(getTransactions).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when no route wallet filters are accessible", () => {
    renderResults(transactionQueryState([{ walletId: "wallet-unknown" }]));

    expect(
      screen.getByText("No accessible transaction result"),
    ).toBeInTheDocument();
    expect(getTransactions).not.toHaveBeenCalled();
  });

  it("shows partial and complete wallet load failures", async () => {
    vi.mocked(getTransactions).mockImplementation(async (walletId) => {
      if (walletId === "wallet-2") {
        throw new Error("wallet unavailable");
      }
      return [
        transaction(walletId, `tx-${walletId}`, "2020-03-01T00:00:00.000Z"),
      ];
    });

    const { unmount } = renderResults(
      transactionQueryState([
        { walletId: "wallet-1" },
        { walletId: "wallet-2" },
      ]),
    );

    expect(await screen.findByText("wallet-1:tx-wallet-1")).toBeInTheDocument();
    expect(
      screen.getByText("Some wallet results could not be loaded."),
    ).toBeInTheDocument();
    unmount();

    vi.mocked(getTransactions).mockRejectedValue(
      new Error("all wallets failed"),
    );
    renderResults(transactionQueryState([{ walletId: "wallet-1" }]));

    expect(
      await screen.findByText("Failed to load transaction results"),
    ).toBeInTheDocument();
  });

  it("navigates from result rows to wallets and highlighted transactions", async () => {
    const onLocationChange = vi.fn();

    renderResultsWithLocationProbe(
      transactionQueryState([{ walletId: "wallet-1" }]),
      onLocationChange,
    );
    await screen.findByText("wallet-1:tx-wallet-1");

    fireEvent.click(
      screen.getByRole("button", { name: "Open transaction tx-wallet-1" }),
    );
    await waitFor(() => {
      expect(
        onLocationChange.mock.calls.some(
          ([location]) =>
            location.pathname === "/wallets/wallet-1" &&
            location.state?.activeTab === "tx" &&
            location.state?.highlightTxId === "wallet-1-tx-wallet-1",
        ),
      ).toBe(true);
    });
  });

  it("navigates from result rows to wallet detail pages", async () => {
    const onLocationChange = vi.fn();

    renderResultsWithLocationProbe(
      transactionQueryState([{ walletId: "wallet-1" }]),
      onLocationChange,
    );
    await screen.findByText("wallet-1:tx-wallet-1");

    fireEvent.click(
      screen.getByRole("button", { name: "Open wallet wallet-1" }),
    );
    await waitFor(() => {
      expect(
        onLocationChange.mock.calls.some(
          ([location]) => location.pathname === "/wallets/wallet-1",
        ),
      ).toBe(true);
    });
  });
});

describe("Console transaction result helpers", () => {
  it("summarizes date and type filters across single and mixed result sets", () => {
    expect(
      summarizeConsoleTransactionFilters([
        {
          walletId: "wallet-1",
          dateFrom: new Date(2020, 1, 1).getTime(),
          dateTo: null,
          type: null,
          limit: null,
        },
      ]),
    ).toContain("From Feb 1, 2020");

    expect(
      summarizeConsoleTransactionFilters([
        {
          walletId: "wallet-1",
          dateFrom: null,
          dateTo: new Date(2020, 5, 30).getTime(),
          type: null,
          limit: null,
        },
      ]),
    ).toContain("Through Jun 30, 2020");

    expect(
      summarizeConsoleTransactionFilters([
        {
          walletId: "wallet-1",
          dateFrom: new Date(2020, 1, 1).getTime(),
          dateTo: null,
          type: "sent",
          limit: null,
        },
        {
          walletId: "wallet-2",
          dateFrom: new Date(2020, 2, 1).getTime(),
          dateTo: null,
          type: "received",
          limit: null,
        },
      ]),
    ).toEqual(["2 wallets", "Mixed dates", "Mixed types"]);
  });

  it("dedupes and sorts transactions with timestamp and block-time fallbacks", () => {
    const newestByTimestamp = {
      ...transaction("wallet-1", "timestamp", "not-a-date"),
      timestamp: Date.UTC(2020, 6, 1),
    };
    const validBlockTime = transaction(
      "wallet-1",
      "valid-block-time",
      "2020-05-01T00:00:00.000Z",
    );
    const invalidBlockTime = transaction(
      "wallet-1",
      "invalid-block-time",
      "bad",
    );
    const withoutBlockTime = {
      ...transaction(
        "wallet-1",
        "without-block-time",
        "2020-01-01T00:00:00.000Z",
      ),
      blockTime: undefined,
    };

    expect(
      sortConsoleTransactions([
        withoutBlockTime,
        invalidBlockTime,
        validBlockTime,
        newestByTimestamp,
      ]).map((item) => item.txid),
    ).toEqual([
      "timestamp",
      "valid-block-time",
      "without-block-time",
      "invalid-block-time",
    ]);

    expect(
      dedupeConsoleTransactions([
        transaction("wallet-1", "duplicate", "2020-01-01T00:00:00.000Z"),
        transaction("wallet-1", "duplicate", "2020-01-02T00:00:00.000Z"),
        transaction("wallet-2", "duplicate", "2020-01-03T00:00:00.000Z"),
        {
          ...transaction("wallet-3", "", "2020-01-04T00:00:00.000Z"),
          txid: "",
        },
      ]).map((item) => `${item.walletId}:${item.txid}`),
    ).toEqual(["wallet-1:duplicate", "wallet-2:duplicate", "wallet-3:"]);
  });
});
