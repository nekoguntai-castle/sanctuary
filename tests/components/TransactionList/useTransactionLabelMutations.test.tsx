import {
  act,
  renderHook,
  waitFor,
  type RenderHookOptions,
  type RenderHookResult,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTransactionLabelMutations } from "../../../src/components/TransactionList/hooks/useTransactionLabelMutations";
import { useTransactionList } from "../../../src/components/TransactionList/hooks/useTransactionList";
import { useTransactionSelection } from "../../../src/components/TransactionList/hooks/useTransactionSelection";
import * as bitcoinApi from "../../../src/api/bitcoin";
import * as labelsApi from "../../../src/api/labels";
import * as transactionsApi from "../../../src/api/transactions";
import type { Label, Transaction } from "../../../src/types";

vi.mock("../../../src/api/bitcoin", () => ({
  getStatus: vi.fn(),
}));

vi.mock("../../../src/api/labels", () => ({
  setTransactionLabels: vi.fn(),
  createLabel: vi.fn(),
}));

vi.mock("../../../src/api/transactions", () => ({
  getTransaction: vi.fn(),
}));

const makeTx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: "tx-1",
  txid: "txid-1",
  walletId: "wallet-1",
  amount: 1000,
  confirmations: 1,
  labels: [],
  ...overrides,
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const makeRouterWrapper = () =>
  function RouterWrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter>{children}</MemoryRouter>;
  };

function renderTxHook<Result, Props>(
  callback: (props: Props) => Result,
  options?: RenderHookOptions<Props>,
): RenderHookResult<Result, Props> {
  return renderHook(callback, { wrapper: makeRouterWrapper(), ...options });
}

describe("transaction label mutation concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({
      explorerUrl: "https://mempool.space",
    } as Awaited<ReturnType<typeof bitcoinApi.getStatus>>);
    vi.mocked(labelsApi.setTransactionLabels).mockResolvedValue([]);
    vi.mocked(labelsApi.createLabel).mockResolvedValue({
      id: "lbl-new",
      walletId: "wallet-1",
      name: "New Label",
      color: "#6366f1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(transactionsApi.getTransaction).mockResolvedValue(makeTx());
  });

  it("does not let a stale label save overwrite a newer transaction selection", async () => {
    const txA = makeTx({ id: "tx-a", txid: "txid-a" });
    const txB = makeTx({ id: "tx-b", txid: "txid-b" });
    const saved = {
      id: "lbl-a",
      walletId: "wallet-1",
      name: "A",
      color: "#111111",
    } as Label;
    const save = createDeferred<Label[]>();
    vi.mocked(labelsApi.setTransactionLabels).mockReturnValueOnce(save.promise);
    vi.mocked(transactionsApi.getTransaction).mockImplementation(
      async (_walletId, txid) => (txid === txA.txid ? txA : txB),
    );

    const { result } = renderTxHook(() =>
      useTransactionList({
        transactions: [txA, txB],
        walletLabels: [saved],
      }),
    );

    act(() => result.current.handleTxClick(txA));
    await waitFor(() => expect(result.current.selectedTx?.id).toBe("tx-a"));
    act(() => {
      result.current.handleEditLabels(txA);
      result.current.handleToggleLabel(saved.id);
    });
    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.handleSaveLabels();
    });
    await waitFor(() => expect(result.current.savingLabels).toBe(true));

    act(() => result.current.handleTxClick(txB));
    await waitFor(() => expect(result.current.selectedTx?.id).toBe("tx-b"));
    await act(async () => {
      save.resolve([saved]);
      await savePromise;
    });

    expect(result.current.selectedTx?.id).toBe("tx-b");
    expect(result.current.selectedTx?.labels).toEqual([]);
    expect(result.current.savingLabels).toBe(false);
    expect(result.current.labelMutationError).toBeNull();
  });

  it("does not let a stale AI label creation mutate a newer transaction selection", async () => {
    const txA = makeTx({ id: "tx-ai-a", txid: "txid-ai-a" });
    const txB = makeTx({ id: "tx-ai-b", txid: "txid-ai-b" });
    const created = {
      id: "lbl-created-a",
      walletId: "wallet-1",
      name: "Created for A",
      color: "#6366f1",
    } as Label;
    const create = createDeferred<Label>();
    vi.mocked(labelsApi.createLabel).mockReturnValueOnce(create.promise);
    vi.mocked(transactionsApi.getTransaction).mockImplementation(
      async (_walletId, txid) => (txid === txA.txid ? txA : txB),
    );

    const { result } = renderTxHook(() =>
      useTransactionList({
        transactions: [txA, txB],
      }),
    );

    act(() => result.current.handleTxClick(txA));
    await waitFor(() => expect(result.current.selectedTx?.id).toBe(txA.id));
    act(() => result.current.handleEditLabels(txA));
    let createPromise!: Promise<void>;
    act(() => {
      createPromise = result.current.handleAISuggestion(created.name);
    });

    act(() => result.current.handleTxClick(txB));
    await waitFor(() => expect(result.current.selectedTx?.id).toBe(txB.id));
    await act(async () => {
      create.resolve(created);
      await createPromise;
    });

    expect(result.current.selectedTx?.id).toBe(txB.id);
    expect(result.current.availableLabels).toEqual([]);
    expect(result.current.selectedLabelIds).toEqual([]);
    expect(result.current.editingLabels).toBe(false);
    expect(result.current.labelMutationError).toBeNull();
  });

  it("invalidates pending label operations when editing is cancelled", async () => {
    const tx = makeTx({ id: "tx-cancel", txid: "txid-cancel" });
    const save = createDeferred<Label[]>();
    const create = createDeferred<Label>();
    vi.mocked(labelsApi.setTransactionLabels).mockReturnValueOnce(save.promise);
    vi.mocked(labelsApi.createLabel).mockReturnValueOnce(create.promise);

    const { result } = renderTxHook(() =>
      useTransactionList({ transactions: [tx] }),
    );
    act(() => result.current.handleTxClick(tx));
    await waitFor(() => expect(result.current.selectedTx?.id).toBe(tx.id));
    act(() => result.current.handleEditLabels(tx));
    let savePromise!: Promise<void>;
    let createPromise!: Promise<void>;
    act(() => {
      savePromise = result.current.handleSaveLabels();
      createPromise = result.current.handleAISuggestion("Cancelled");
    });
    await waitFor(() => expect(result.current.savingLabels).toBe(true));
    act(() => result.current.handleCancelEdit());

    await act(async () => {
      save.reject(new Error("late save failure"));
      create.reject(new Error("late create failure"));
      await Promise.all([savePromise, createPromise]);
    });

    expect(result.current.editingLabels).toBe(false);
    expect(result.current.savingLabels).toBe(false);
    expect(result.current.availableLabels).toEqual([]);
    expect(result.current.selectedLabelIds).toEqual([]);
    expect(result.current.labelMutationError).toBeNull();
  });

  it("keeps a current save failure visible while an overlapping AI create succeeds", async () => {
    const tx = makeTx({ id: "tx-overlap-error", txid: "txid-overlap-error" });
    const created = {
      id: "lbl-overlap-created",
      walletId: "wallet-1",
      name: "Created",
      color: "#6366f1",
    } as Label;
    const save = createDeferred<Label[]>();
    const create = createDeferred<Label>();
    vi.mocked(labelsApi.setTransactionLabels).mockReturnValueOnce(save.promise);
    vi.mocked(labelsApi.createLabel).mockReturnValueOnce(create.promise);

    const { result } = renderTxHook(() =>
      useTransactionList({ transactions: [tx] }),
    );
    act(() => result.current.handleTxClick(tx));
    await waitFor(() => expect(result.current.selectedTx?.id).toBe(tx.id));
    act(() => result.current.handleEditLabels(tx));
    let savePromise!: Promise<void>;
    let createPromise!: Promise<void>;
    act(() => {
      savePromise = result.current.handleSaveLabels();
      createPromise = result.current.handleAISuggestion(created.name);
    });

    await act(async () => {
      save.reject(new Error("save failed while creating"));
      await savePromise;
    });
    expect(result.current.labelMutationError).toBe(
      "save failed while creating",
    );

    await act(async () => {
      create.resolve(created);
      await createPromise;
    });
    expect(result.current.labelMutationError).toBe(
      "save failed while creating",
    );
    expect(result.current.selectedLabelIds).toEqual([created.id]);
    expect(result.current.savingLabels).toBe(false);
  });

  it.each(["save-fails-first", "ai-fails-first"] as const)(
    "keeps the newer operation error when overlapping save and AI create both fail (%s)",
    async (completionOrder) => {
      const tx = makeTx({
        id: "tx-overlap-errors",
        txid: "txid-overlap-errors",
      });
      const save = createDeferred<Label[]>();
      const create = createDeferred<Label>();
      vi.mocked(labelsApi.setTransactionLabels).mockReturnValueOnce(
        save.promise,
      );
      vi.mocked(labelsApi.createLabel).mockReturnValueOnce(create.promise);

      const { result } = renderTxHook(() =>
        useTransactionList({ transactions: [tx] }),
      );
      act(() => result.current.handleTxClick(tx));
      await waitFor(() => expect(result.current.selectedTx?.id).toBe(tx.id));
      act(() => result.current.handleEditLabels(tx));
      let savePromise!: Promise<void>;
      let createPromise!: Promise<void>;
      act(() => {
        savePromise = result.current.handleSaveLabels();
        createPromise = result.current.handleAISuggestion("Newer AI operation");
      });

      await act(async () => {
        if (completionOrder === "save-fails-first") {
          save.reject(new Error("older save failure"));
          await savePromise;
          create.reject(new Error("newer AI failure"));
          await createPromise;
        } else {
          create.reject(new Error("newer AI failure"));
          await createPromise;
          save.reject(new Error("older save failure"));
          await savePromise;
        }
      });

      expect(result.current.labelMutationError).toBe("newer AI failure");
      expect(result.current.savingLabels).toBe(false);
      expect(result.current.editingLabels).toBe(true);
    },
  );

  it("uses fallback mutation errors and omits labels absent from the saved snapshot", async () => {
    const tx = makeTx({
      id: "tx-fallbacks",
      txid: "txid-fallbacks",
      labels: undefined,
    });
    vi.mocked(labelsApi.setTransactionLabels)
      .mockRejectedValueOnce(null)
      .mockResolvedValueOnce([]);

    const { result } = renderTxHook(() =>
      useTransactionList({ transactions: [tx] }),
    );
    act(() => result.current.handleTxClick(tx));
    await waitFor(() => expect(result.current.selectedTx?.id).toBe(tx.id));
    act(() => {
      result.current.handleEditLabels(tx);
      result.current.handleToggleLabel("missing-label");
    });

    await act(async () => result.current.handleSaveLabels());
    expect(result.current.labelMutationError).toBe("Failed to save labels");

    await act(async () => result.current.handleSaveLabels());
    expect(result.current.selectedTx?.labels).toEqual([]);
  });

  it("does not duplicate an AI-created label selected while creation is pending", async () => {
    const tx = makeTx({ id: "tx-ai-pending", txid: "txid-ai-pending" });
    const created = {
      id: "lbl-pending",
      walletId: "wallet-1",
      name: "Pending",
      color: "#6366f1",
    } as Label;
    const create = createDeferred<Label>();
    vi.mocked(labelsApi.createLabel).mockReturnValueOnce(create.promise);

    const { result } = renderTxHook(() =>
      useTransactionList({ transactions: [tx] }),
    );
    act(() => result.current.handleTxClick(tx));
    await waitFor(() => expect(result.current.selectedTx?.id).toBe(tx.id));
    act(() => result.current.handleEditLabels(tx));
    let createPromise!: Promise<void>;
    act(() => {
      createPromise = result.current.handleAISuggestion(created.name);
      result.current.handleToggleLabel(created.id);
    });
    await act(async () => {
      create.resolve(created);
      await createPromise;
    });

    expect(result.current.selectedLabelIds).toEqual([created.id]);
  });

  it("ignores label patches whose expected selection key is stale", async () => {
    const tx = makeTx({ id: "tx-patch-guard", txid: "txid-patch-guard" });
    vi.mocked(transactionsApi.getTransaction).mockResolvedValueOnce(tx);
    const { result } = renderTxHook(() =>
      useTransactionSelection({
        ownsSelection: true,
        selectionTransactions: [tx],
        walletId: tx.walletId,
      }),
    );

    act(() => result.current.selectTx(tx));
    await waitFor(() =>
      expect(result.current.selection.selectedTx?.id).toBe(tx.id),
    );
    act(() => {
      result.current.patchSelectedTxLabels("stale-selection-key", tx.id, [
        {
          id: "should-not-apply",
          walletId: tx.walletId,
          name: "Stale",
          color: "#000000",
        } as Label,
      ]);
    });

    expect(result.current.selection.selectedTx?.labels).toEqual([]);
  });

  it("skips AI mutation when a selected summary has no resolvable selection key", async () => {
    const tx = makeTx({ id: "tx-missing-key", txid: "txid-missing-key" });
    const { result } = renderHook(() =>
      useTransactionLabelMutations({
        selection: {
          key: null,
          status: "error",
          selectedTx: tx,
          fullTxDetails: null,
          error: "Unable to determine the transaction wallet",
        },
        walletLabels: [],
        patchSelectedTxLabels: vi.fn(),
      }),
    );

    await act(async () => result.current.handleAISuggestion("No key"));

    expect(labelsApi.createLabel).not.toHaveBeenCalled();
    expect(result.current.selectedLabelIds).toEqual([]);
  });

  it("patches only persisted labels when a selected transaction refreshes during save", async () => {
    const original = makeTx({
      id: "tx-refresh",
      txid: "txid-refresh",
      memo: "old",
      confirmations: 1,
    });
    const refreshed = { ...original, memo: "new", confirmations: 9 };
    const label = {
      id: "lbl-save",
      walletId: "wallet-1",
      name: "Saved",
      color: "#222222",
    } as Label;
    const save = createDeferred<Label[]>();
    vi.mocked(labelsApi.setTransactionLabels).mockReturnValueOnce(save.promise);

    const { result, rerender } = renderTxHook(
      ({ transactions }) =>
        useTransactionList({ transactions, walletLabels: [label] }),
      { initialProps: { transactions: [original] } },
    );
    act(() => result.current.handleTxClick(original));
    await waitFor(() =>
      expect(result.current.selectedTx?.id).toBe(original.id),
    );
    act(() => {
      result.current.handleEditLabels(original);
      result.current.handleToggleLabel(label.id);
    });
    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.handleSaveLabels();
    });
    rerender({ transactions: [refreshed] });
    await waitFor(() => expect(result.current.selectedTx?.memo).toBe("new"));

    await act(async () => {
      save.resolve([label]);
      await savePromise;
    });
    expect(result.current.selectedTx).toMatchObject({
      id: original.id,
      memo: "new",
      confirmations: 9,
      labels: [label],
    });
  });

  it.each(["ai-first", "save-first"] as const)(
    "keeps exact saved labels when same-selection save and AI create overlap (%s)",
    async (completionOrder) => {
      const tx = makeTx({ id: "tx-overlap", txid: "txid-overlap" });
      const saved = {
        id: "lbl-saved",
        walletId: "wallet-1",
        name: "Saved",
        color: "#111111",
      } as Label;
      const created = {
        id: "lbl-created",
        walletId: "wallet-1",
        name: "Created",
        color: "#6366f1",
      } as Label;
      const save = createDeferred<Label[]>();
      const create = createDeferred<Label>();
      vi.mocked(labelsApi.setTransactionLabels).mockReturnValueOnce(
        save.promise,
      );
      vi.mocked(labelsApi.createLabel).mockReturnValueOnce(create.promise);

      const { result } = renderTxHook(() =>
        useTransactionList({
          transactions: [tx],
          walletLabels: [saved],
        }),
      );
      act(() => result.current.handleTxClick(tx));
      await waitFor(() => expect(result.current.selectedTx?.id).toBe(tx.id));
      act(() => {
        result.current.handleEditLabels(tx);
        result.current.handleToggleLabel(saved.id);
      });
      let aiPromise!: Promise<void>;
      let savePromise!: Promise<void>;
      act(() => {
        aiPromise = result.current.handleAISuggestion("Created");
        savePromise = result.current.handleSaveLabels();
      });

      await act(async () => {
        if (completionOrder === "ai-first") {
          create.resolve(created);
          await aiPromise;
          save.resolve([saved]);
          await savePromise;
        } else {
          save.resolve([saved]);
          await savePromise;
          create.resolve(created);
          await aiPromise;
        }
      });

      expect(
        result.current.selectedTx?.labels?.map((label) => label.id),
      ).toEqual([saved.id]);
      expect(result.current.editingLabels).toBe(false);
      expect(result.current.savingLabels).toBe(false);
      expect(result.current.labelMutationError).toBeNull();
    },
  );
});
