import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTransactionLabelMutations } from "../../../src/components/TransactionList/hooks/useTransactionLabelMutations";
import { useTransactionResolution } from "../../../src/components/TransactionList/hooks/useTransactionResolution";
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

/**
 * The two hooks a detail panel runs: one resolution and the label editor bound
 * to it. Each open tab mounts its own pair, so "a stale mutation must not touch
 * a newer transaction" is now a statement about two panels rather than about one
 * slot being switched between transactions.
 */
function renderPanelHooks(
  initialProps: { rows: Transaction[]; walletLabels?: Label[] },
) {
  const onLabelsChange = vi.fn();
  const view = renderHook(
    ({ rows, walletLabels = [] }: { rows: Transaction[]; walletLabels?: Label[] }) => {
      const resolution = useTransactionResolution({
        txid: rows[0].txid,
        selectionTransactions: rows,
        walletId: "wallet-1",
        onUnresolvable: vi.fn(),
      });
      const mutations = useTransactionLabelMutations({
        selection: resolution.selection,
        walletLabels,
        onLabelsChange,
        patchSelectedTxLabels: resolution.patchSelectedTxLabels,
      });
      return { ...mutations, selection: resolution.selection };
    },
    { initialProps },
  );
  return { ...view, onLabelsChange };
}

async function renderResolvedPanel(
  tx: Transaction,
  walletLabels: Label[] = [],
) {
  const view = renderPanelHooks({ rows: [tx], walletLabels });
  await waitFor(() =>
    expect(view.result.current.selection.selectedTx?.id).toBe(tx.id),
  );
  return view;
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

  it("keeps a slow label save inside the tab that started it", async () => {
    // Before tabs, this was one editor slot switched between transactions, and a
    // save that finished after the switch could write onto whatever was showing.
    // Two open tabs are two editors, so the guarantee is structural — and the
    // save still has to land correctly on the tab that started it.
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

    const panelA = await renderResolvedPanel(txA, [saved]);
    const panelB = await renderResolvedPanel(txB, [saved]);

    act(() => {
      panelA.result.current.handleEditLabels(txA);
      panelA.result.current.handleToggleLabel(saved.id);
    });
    let savePromise!: Promise<void>;
    act(() => {
      savePromise = panelA.result.current.handleSaveLabels();
    });
    await waitFor(() => expect(panelA.result.current.savingLabels).toBe(true));
    expect(panelB.result.current.savingLabels).toBe(false);

    await act(async () => {
      save.resolve([saved]);
      await savePromise;
    });

    expect(labelsApi.setTransactionLabels).toHaveBeenCalledWith(txA.id, [saved.id]);
    expect(panelA.result.current.selection.selectedTx?.labels).toEqual([saved]);
    expect(panelA.result.current.savingLabels).toBe(false);
    expect(panelA.result.current.labelMutationError).toBeNull();
    // The other open transaction is untouched: different editor, different
    // resolution, no shared slot to overwrite.
    expect(panelB.result.current.selection.selectedTx?.labels).toEqual([]);
    expect(panelB.result.current.editingLabels).toBe(false);
  });

  it("keeps a slow AI label creation inside the tab that started it", async () => {
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

    const panelA = await renderResolvedPanel(txA);
    const panelB = await renderResolvedPanel(txB);

    act(() => panelA.result.current.handleEditLabels(txA));
    let createPromise!: Promise<void>;
    act(() => {
      createPromise = panelA.result.current.handleAISuggestion(created.name);
    });

    await act(async () => {
      create.resolve(created);
      await createPromise;
    });

    expect(panelA.result.current.selectedLabelIds).toEqual([created.id]);
    expect(panelA.result.current.availableLabels).toEqual([created]);
    expect(panelA.result.current.labelMutationError).toBeNull();
    expect(panelB.result.current.selectedLabelIds).toEqual([]);
    expect(panelB.result.current.availableLabels).toEqual([]);
    expect(panelB.result.current.editingLabels).toBe(false);
  });

  it("invalidates pending label operations when editing is cancelled", async () => {
    const tx = makeTx({ id: "tx-cancel", txid: "txid-cancel" });
    const save = createDeferred<Label[]>();
    const create = createDeferred<Label>();
    vi.mocked(labelsApi.setTransactionLabels).mockReturnValueOnce(save.promise);
    vi.mocked(labelsApi.createLabel).mockReturnValueOnce(create.promise);

    const { result } = await renderResolvedPanel(tx);
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

    const { result } = await renderResolvedPanel(tx);
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

      const { result } = await renderResolvedPanel(tx);
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

    const { result } = await renderResolvedPanel(tx);
    act(() => {
      result.current.handleEditLabels(tx);
      result.current.handleToggleLabel("missing-label");
    });

    await act(async () => result.current.handleSaveLabels());
    expect(result.current.labelMutationError).toBe("Failed to save labels");

    await act(async () => result.current.handleSaveLabels());
    expect(result.current.selection.selectedTx?.labels).toEqual([]);
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

    const { result } = await renderResolvedPanel(tx);
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

    const { result, rerender } = renderPanelHooks({
      rows: [original],
      walletLabels: [label],
    });
    await waitFor(() =>
      expect(result.current.selection.selectedTx?.id).toBe(original.id),
    );
    act(() => {
      result.current.handleEditLabels(original);
      result.current.handleToggleLabel(label.id);
    });
    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.handleSaveLabels();
    });
    rerender({ rows: [refreshed], walletLabels: [label] });
    await waitFor(() =>
      expect(result.current.selection.selectedTx?.memo).toBe("new"),
    );

    await act(async () => {
      save.resolve([label]);
      await savePromise;
    });
    expect(result.current.selection.selectedTx).toMatchObject({
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

      const { result } = await renderResolvedPanel(tx, [saved]);
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
        result.current.selection.selectedTx?.labels?.map((label) => label.id),
      ).toEqual([saved.id]);
      expect(result.current.editingLabels).toBe(false);
      expect(result.current.savingLabels).toBe(false);
      expect(result.current.labelMutationError).toBeNull();
    },
  );

  it("falls back to empty selected labels when transaction labels are undefined", async () => {
    const tx = makeTx({
      id: "tx-no-labels",
      txid: "txid-no-labels",
      labels: undefined as any,
    });

    const { result } = await renderResolvedPanel(tx);

    await act(async () => {
      await result.current.handleEditLabels(tx);
    });

    expect(result.current.selectedLabelIds).toEqual([]);
  });

  it("edits labels, toggles add/remove branches, and saves selected labels", async () => {
    const tx = makeTx({
      id: "tx-edit",
      txid: "txid-edit",
      labels: [{ id: "lbl-existing-on-tx", name: "Existing", color: "#333333" } as Label],
    });
    const labelA: Label = {
      id: "lbl-a",
      walletId: "wallet-1",
      name: "A",
      color: "#111111",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const labelB: Label = {
      id: "lbl-b",
      walletId: "wallet-1",
      name: "B",
      color: "#222222",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const { result, onLabelsChange } = await renderResolvedPanel(tx, [labelA, labelB]);

    await act(async () => {
      await result.current.handleEditLabels(tx);
    });
    expect(result.current.selectedLabelIds).toEqual(["lbl-existing-on-tx"]);

    act(() => {
      result.current.handleToggleLabel("lbl-a");
    });
    expect(result.current.selectedLabelIds).toEqual(["lbl-existing-on-tx", "lbl-a"]);

    act(() => {
      result.current.handleToggleLabel("lbl-a");
    });
    expect(result.current.selectedLabelIds).toEqual(["lbl-existing-on-tx"]);

    act(() => {
      result.current.handleToggleLabel("lbl-b");
    });
    expect(result.current.selectedLabelIds).toEqual(["lbl-existing-on-tx", "lbl-b"]);
    vi.mocked(labelsApi.setTransactionLabels).mockResolvedValueOnce([labelB]);

    await act(async () => {
      await result.current.handleSaveLabels();
    });

    expect(labelsApi.setTransactionLabels).toHaveBeenCalledWith("tx-edit", ["lbl-existing-on-tx", "lbl-b"]);
    expect(result.current.selection.selectedTx?.labels?.map(l => l.id)).toEqual(["lbl-existing-on-tx", "lbl-b"]);
    expect(onLabelsChange).toHaveBeenCalledTimes(1);
  });

  it("covers save/AI suggestion error handlers", async () => {
    const tx = makeTx({ id: "tx-errors", txid: "txid-errors", walletId: "wallet-errors", labels: [] });
    vi.mocked(labelsApi.setTransactionLabels).mockRejectedValueOnce("save failed");
    vi.mocked(labelsApi.createLabel).mockRejectedValueOnce(new Error("create failed"));

    const { result } = await renderResolvedPanel(tx);

    // handleEditLabels now reads from walletLabels synchronously (no API call)
    await act(async () => {
      await result.current.handleEditLabels(tx);
    });

    act(() => {
      result.current.handleToggleLabel("lbl-x");
    });
    await act(async () => {
      await result.current.handleSaveLabels();
    });

    await act(async () => {
      await result.current.handleAISuggestion("NewLabel");
    });

    expect(labelsApi.setTransactionLabels).toHaveBeenCalled();
    expect(labelsApi.createLabel).toHaveBeenCalled();
    expect(result.current.labelMutationError).toBe("create failed");

    await act(async () => {
      await result.current.handleEditLabels(tx);
    });
    expect(result.current.labelMutationError).toBeNull();
  });


  it("applies AI suggestions for existing labels, avoids duplicate selection, and creates missing labels", async () => {
    const tx = makeTx({ id: "tx-ai", txid: "txid-ai", walletId: "wallet-ai", labels: [] });
    const existing: Label = {
      id: "lbl-existing",
      walletId: "wallet-ai",
      name: "Groceries",
      color: "#00aa00",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const created: Label = {
      id: "lbl-created",
      walletId: "wallet-ai",
      name: "Coffee",
      color: "#6366f1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.mocked(labelsApi.createLabel).mockResolvedValueOnce(created);

    const { result } = await renderResolvedPanel(tx, [existing]);

    // handleEditLabels now reads from walletLabels synchronously
    await act(async () => {
      await result.current.handleEditLabels(tx);
    });

    // "groceries" matches existing label (case-insensitive) - should not create
    await act(async () => {
      await result.current.handleAISuggestion("groceries");
    });
    expect(labelsApi.createLabel).not.toHaveBeenCalled();
    expect(result.current.selectedLabelIds).toEqual(["lbl-existing"]);

    // Duplicate suggestion - should remain selected without duplication
    await act(async () => {
      await result.current.handleAISuggestion("groceries");
    });
    expect(result.current.selectedLabelIds).toEqual(["lbl-existing"]);

    // "Coffee" does not exist - should create via API
    await act(async () => {
      await result.current.handleAISuggestion("Coffee");
    });

    expect(labelsApi.createLabel).toHaveBeenCalledWith("wallet-ai", {
      name: "Coffee",
      color: "#6366f1",
    });
    expect(result.current.selectedLabelIds).toEqual(expect.arrayContaining(["lbl-existing", "lbl-created"]));
  });

  it("does nothing when the panel has no resolvable transaction to edit", async () => {
    // The missing-wallet case: a summary with no selection key. Saving or
    // asking for a suggestion must not reach the API.
    const { result } = renderHook(() =>
      useTransactionLabelMutations({
        selection: {
          key: null,
          status: "error",
          selectedTx: null,
          fullTxDetails: null,
          error: "Unable to determine the transaction wallet",
        },
        walletLabels: [],
        patchSelectedTxLabels: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleSaveLabels();
      await result.current.handleAISuggestion("Coffee");
    });

    expect(labelsApi.setTransactionLabels).not.toHaveBeenCalled();
    expect(labelsApi.createLabel).not.toHaveBeenCalled();
  });

  it("saves without an onLabelsChange listener", async () => {
    // TransactionList passes it through from a caller that may not supply one.
    const tx = makeTx({ id: "tx-no-listener", txid: "txid-no-listener" });
    const label = {
      id: "lbl-quiet",
      walletId: "wallet-1",
      name: "Quiet",
      color: "#444444",
    } as Label;
    vi.mocked(labelsApi.setTransactionLabels).mockResolvedValueOnce([label]);

    const { result } = renderHook(() => {
      const resolution = useTransactionResolution({
        txid: tx.txid,
        selectionTransactions: [tx],
        walletId: "wallet-1",
        onUnresolvable: vi.fn(),
      });
      const mutations = useTransactionLabelMutations({
        selection: resolution.selection,
        walletLabels: [label],
        patchSelectedTxLabels: resolution.patchSelectedTxLabels,
      });
      return { ...mutations, selection: resolution.selection };
    });
    await waitFor(() =>
      expect(result.current.selection.selectedTx?.id).toBe(tx.id),
    );

    act(() => {
      result.current.handleEditLabels(tx);
      result.current.handleToggleLabel(label.id);
    });
    await act(async () => result.current.handleSaveLabels());

    expect(result.current.selection.selectedTx?.labels).toEqual([label]);
  });

  it("discards a save that succeeds after the editor was invalidated", async () => {
    // Cancelling closes the editor immediately. The request is already on its
    // way, so when it lands it must apply nothing rather than reopening the
    // editor over whatever the panel now shows.
    const tx = makeTx({ id: "tx-late-success", txid: "txid-late-success" });
    const label = {
      id: "lbl-late",
      walletId: "wallet-1",
      name: "Late",
      color: "#555555",
    } as Label;
    const save = createDeferred<Label[]>();
    vi.mocked(labelsApi.setTransactionLabels).mockReturnValueOnce(save.promise);

    const { result } = await renderResolvedPanel(tx, [label]);
    act(() => {
      result.current.handleEditLabels(tx);
      result.current.handleToggleLabel(label.id);
    });
    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.handleSaveLabels();
    });
    await waitFor(() => expect(result.current.savingLabels).toBe(true));

    act(() => result.current.handleCancelEdit());
    await act(async () => {
      save.resolve([label]);
      await savePromise;
    });

    expect(result.current.selection.selectedTx?.labels).toEqual([]);
    expect(result.current.editingLabels).toBe(false);
    expect(result.current.selectedLabelIds).toEqual([]);
    expect(result.current.labelMutationError).toBeNull();
  });
});
