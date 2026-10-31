import { expect, it, onTestFinished, vi } from 'vitest';
import './processTransactionsTestHarness';
import { mockPrismaClient } from '../../../../../mocks/prisma';
import { mockElectrumClient, createMockTransaction } from '../../../../../mocks/electrum';
import {
  checkExistingPhase,
  createTestContext,
  processTransactionsPhase,
  type SyncContext,
} from '../../../../../../src/services/bitcoin/sync';
import { transactionRepository } from '../../../../../../src/repositories';
import { CURRENT_TRANSACTION_CLASSIFICATION_VERSION } from '../../../../../../src/constants/transactionClassification';
import { getNotificationService } from '../../../../../../src/websocket/notifications';
import { notifyNewTransactions } from '../../../../../../src/services/notifications/notificationService';

const WALLET_ADDRESS = 'tb1q_wallet_change';
const EXTERNAL_ADDRESS = 'tb1q_external_payee';

/**
 * Post-commit notifications are dispatched through dynamic imports. The
 * genuine-receive guard below proves this flush is long enough for a positive
 * notification, so the negative assertions are not vacuous.
 */
const flushPostCommitNotifications = () => new Promise(resolve => setTimeout(resolve, 25));

const broadcastMock = () => vi.mocked(getNotificationService().broadcastTransactionNotification);

/**
 * A spend made outside Sanctuary: the wallet's own input references a parent
 * that cannot be fetched (no inline prevout), and the change returns to the
 * wallet. Without the parent the input is unrecognised and the change looks
 * like a receive.
 */
const spendWithChange = (txid: string, parentTxid: string, inlineWalletInput: boolean) => {
  const base = createMockTransaction({
    txid,
    blockheight: 800000,
    inputs: [{ txid: parentTxid, vout: 0, value: 0.001, address: WALLET_ADDRESS }],
    outputs: [
      { value: 0.0005, address: EXTERNAL_ADDRESS },
      { value: 0.0004, address: WALLET_ADDRESS },
    ],
  });
  return inlineWalletInput
    ? base
    : { ...base, vin: [{ txid: parentTxid, vout: 0 }] };
};

const contextFor = (walletId: string, txid: string, overrides: Partial<SyncContext> = {}) =>
  createTestContext({
    walletId,
    client: mockElectrumClient as any,
    newTxids: [txid],
    historyResults: new Map([[WALLET_ADDRESS, [{ tx_hash: txid, height: 800000 }]]]),
    walletAddressSet: new Set([WALLET_ADDRESS]),
    addressMap: new Map([[WALLET_ADDRESS, { id: 'addr-change', address: WALLET_ADDRESS } as any]]),
    currentBlockHeight: 800100,
    ...overrides,
  });

const persistedCandidates = () => mockPrismaClient.transaction.createManyAndReturn.mock.calls
  .flatMap(([args]) => (args as { data: Array<Record<string, unknown>> }).data);

/** The duplicate insert finds this stored row under the classification lock. */
const mockExistingClassification = (row: Record<string, unknown>) => {
  mockPrismaClient.transaction.createManyAndReturn.mockResolvedValueOnce([]);
  mockPrismaClient.$queryRaw.mockImplementation(async (statement: any) => {
    const sql = statement?.strings?.join('') ?? '';
    return sql.includes('address-sync-classification-lock')
      ? [{ rbfStatus: 'confirmed', replacedByTxid: null, ...row }]
      : [];
  });
};

/**
 * A later sync derives the hold set from the stored row: the sync classifier
 * wrote it (address count 1) and left its classification incomplete.
 */
const contextFromStoredIncompleteReceive = async (
  walletId: string,
  txid: string,
  stored: { blockHeight: number | null; blockTime: Date | null; createdAt: Date },
) => {
  mockPrismaClient.transaction.findMany.mockResolvedValueOnce([{
    txid,
    type: 'received',
    classificationInputsComplete: false,
    classificationVersion: CURRENT_TRANSACTION_CLASSIFICATION_VERSION,
    classificationAddressCount: 1,
    classificationLastAttemptAt: null,
    ioComplete: true,
    ioLastAttemptAt: null,
    ...stored,
  }]);
  mockPrismaClient.transactionOwnershipRepair.findMany.mockResolvedValueOnce([]);
  return checkExistingPhase(contextFor(walletId, txid, {
    wallet: { id: walletId, network: 'testnet', lastSyncedAt: new Date() } as any,
    allTxids: new Set([txid]),
    newTxids: [],
  }));
};

export function registerProcessTransactionIncompleteReceiveNotificationTests(walletId: string): void {
  it('does not announce the change of a spend whose own parent could not be fetched', async () => {
    const txid = 'unfetched_parent_spend'.padEnd(64, 'a');
    const parentTxid = 'unfetched_parent'.padEnd(64, 'b');
    // Only the candidate is served; the parent fetch yields nothing, which is
    // what an exhausted candidate fetch budget leaves behind.
    mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => new Map(
      txids.filter(requested => requested === txid)
        .map(requested => [requested, spendWithChange(txid, parentTxid, false)]),
    ));

    await processTransactionsPhase(contextFor(walletId, txid));
    await flushPostCommitNotifications();

    // The row is still persisted as incomplete so the durable repair backlog
    // revisits it; only the announcement is withheld.
    expect(persistedCandidates()).toEqual([expect.objectContaining({
      txid,
      type: 'received',
      classificationInputsComplete: false,
    })]);
    expect(notifyNewTransactions).not.toHaveBeenCalled();
    expect(broadcastMock()).not.toHaveBeenCalled();
  });

  it('still announces a genuine receive whose input evidence is complete', async () => {
    const txid = 'genuine_receive_complete'.padEnd(64, 'c');
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([[txid, createMockTransaction({
      txid,
      blockheight: 800000,
      inputs: [{ txid: 'payer_parent'.padEnd(64, 'd'), vout: 0, value: 0.001, address: EXTERNAL_ADDRESS }],
      outputs: [{ value: 0.0009, address: WALLET_ADDRESS }],
    })]]));

    await processTransactionsPhase(contextFor(walletId, txid));
    await flushPostCommitNotifications();

    expect(notifyNewTransactions).toHaveBeenCalledWith(walletId, [
      expect.objectContaining({ txid, type: 'received', amount: BigInt(90000) }),
    ]);
    expect(broadcastMock()).toHaveBeenCalledWith(expect.objectContaining({ txid, type: 'received' }));
  });

  it('announces the authoritative classification when a withheld receive is repaired', async () => {
    const txid = 'withheld_receive_repair'.padEnd(64, 'e');
    const parentTxid = 'now_fetchable_parent'.padEnd(64, 'f');
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([
      [txid, spendWithChange(txid, parentTxid, true)],
    ]));
    // The incomplete 'received' row already exists, so the insert is a
    // duplicate and the complete candidate repairs it.
    mockExistingClassification({
      id: 'existing-row',
      classificationInputsComplete: false,
      classificationVersion: CURRENT_TRANSACTION_CLASSIFICATION_VERSION,
      classificationAddressCount: 1,
    });

    await processTransactionsPhase(contextFor(walletId, txid, {
      existingTxidSet: new Set([txid]),
      classificationRepairTxids: new Set([txid]),
      incompleteReceiveTxids: new Set([txid]),
    }));
    await flushPostCommitNotifications();

    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'existing-row' },
      data: expect.objectContaining({ type: 'sent', classificationInputsComplete: true }),
    }));
    expect(broadcastMock()).toHaveBeenCalledWith(expect.objectContaining({ txid, type: 'sent' }));
    expect(notifyNewTransactions).toHaveBeenCalledWith(walletId, [
      expect.objectContaining({ txid, type: 'sent' }),
    ]);
  });

  it('does not re-announce a repair of a row that was never withheld', async () => {
    const txid = 'complete_row_upgrade'.padEnd(64, '1');
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([
      [txid, spendWithChange(txid, 'upgrade_parent'.padEnd(64, '2'), true)],
    ]));
    mockExistingClassification({
      id: 'existing-sent-row',
      classificationInputsComplete: true,
      classificationVersion: CURRENT_TRANSACTION_CLASSIFICATION_VERSION - 1,
      classificationAddressCount: 1,
    });

    await processTransactionsPhase(contextFor(walletId, txid, {
      existingTxidSet: new Set([txid]),
      classificationRepairTxids: new Set([txid]),
    }));
    await flushPostCommitNotifications();

    expect(mockPrismaClient.transaction.update).toHaveBeenCalled();
    expect(notifyNewTransactions).not.toHaveBeenCalled();
    expect(broadcastMock()).not.toHaveBeenCalled();
  });

  it('holds a receive whose input lacks only its value, then announces it once on repair', async () => {
    const txid = 'valueless_input_receive'.padEnd(64, '8');
    const payerParentTxid = 'valueless_payer_parent'.padEnd(64, '9');
    const payerParent = createMockTransaction({
      txid: payerParentTxid,
      blockheight: 799000,
      outputs: [{ value: 0.001, address: EXTERNAL_ADDRESS }],
    });
    const receive = {
      ...createMockTransaction({
        txid,
        blockheight: 800000,
        outputs: [{ value: 0.0009, address: WALLET_ADDRESS }],
      }),
      // The payer's address is known inline, but its value needs the parent
      // (the electrum fixture type always carries a value, hence the cast).
      vin: [{ txid: payerParentTxid, vout: 0, prevout: { scriptPubKey: { address: EXTERNAL_ADDRESS } } }] as any[],
    };
    let serveParent = false;
    mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => new Map(
      txids.flatMap(requested => {
        if (requested === txid) return [[requested, receive]];
        if (serveParent && requested === payerParentTxid) return [[requested, payerParent]];
        return [];
      }),
    ));

    await processTransactionsPhase(contextFor(walletId, txid));
    await flushPostCommitNotifications();

    expect(persistedCandidates()).toEqual([expect.objectContaining({
      txid,
      type: 'received',
      classificationInputsComplete: false,
    })]);
    expect(notifyNewTransactions).not.toHaveBeenCalled();
    expect(broadcastMock()).not.toHaveBeenCalled();

    serveParent = true;
    mockExistingClassification({
      id: 'valueless-input-row',
      classificationInputsComplete: false,
      classificationVersion: CURRENT_TRANSACTION_CLASSIFICATION_VERSION,
      classificationAddressCount: 1,
    });
    await processTransactionsPhase(contextFor(walletId, txid, {
      existingTxidSet: new Set([txid]),
      classificationRepairTxids: new Set([txid]),
      incompleteReceiveTxids: new Set([txid]),
    }));
    await flushPostCommitNotifications();

    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'valueless-input-row' },
      data: expect.objectContaining({ type: 'received', classificationInputsComplete: true }),
    }));
    expect(notifyNewTransactions).toHaveBeenCalledTimes(1);
    expect(notifyNewTransactions).toHaveBeenCalledWith(walletId, [
      expect.objectContaining({ txid, type: 'received', amount: BigInt(90000) }),
    ]);
    expect(broadcastMock()).toHaveBeenCalledTimes(1);
  });

  it('keeps the repair of a broadcast-created internal receive silent', async () => {
    const txid = 'internal_receive_repair'.padEnd(64, '3');
    // Broadcast-created internal receives keep the schema default address
    // count; the set is derived from the stored row, not set by hand.
    const storedRow = {
      txid,
      type: 'received',
      classificationInputsComplete: false,
      classificationVersion: CURRENT_TRANSACTION_CLASSIFICATION_VERSION,
      classificationAddressCount: 0,
      classificationLastAttemptAt: null,
      ioComplete: true,
      ioLastAttemptAt: null,
    };
    mockPrismaClient.transaction.findMany.mockResolvedValueOnce([storedRow]);
    mockPrismaClient.transactionOwnershipRepair.findMany.mockResolvedValueOnce([]);
    const ctx = await checkExistingPhase(contextFor(walletId, txid, {
      allTxids: new Set([txid]),
      newTxids: [],
    }));
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([
      [txid, spendWithChange(txid, 'internal_parent'.padEnd(64, '4'), true)],
    ]));
    mockExistingClassification({
      id: 'internal-receive-row',
      classificationInputsComplete: false,
      classificationVersion: CURRENT_TRANSACTION_CLASSIFICATION_VERSION,
      classificationAddressCount: 0,
    });

    await processTransactionsPhase(ctx);
    await flushPostCommitNotifications();

    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'internal-receive-row' },
      data: expect.objectContaining({ classificationInputsComplete: true }),
    }));
    expect(notifyNewTransactions).not.toHaveBeenCalled();
    expect(broadcastMock()).not.toHaveBeenCalled();
  });

  it('keeps holding a receive whose sibling input spends a non-standard output', async () => {
    const txid = 'nonstandard_sibling_receive'.padEnd(64, '5');
    const payerParentTxid = 'unfetched_payer_parent'.padEnd(64, '6');
    const payerParent = createMockTransaction({
      txid: payerParentTxid,
      blockheight: 799000,
      outputs: [{ value: 0.002, address: EXTERNAL_ADDRESS }],
    });
    const receive = {
      ...createMockTransaction({
        txid,
        blockheight: 800000,
        outputs: [{ value: 0.0025, address: WALLET_ADDRESS }],
      }),
      vin: [
        // Script known but decodes to no address: non-standard, so the
        // classification can never complete.
        { txid: 'nonstandard_parent'.padEnd(64, '7'), vout: 0, prevout: { value: 0.001, scriptPubKey: { hex: '51' } } },
        { txid: payerParentTxid, vout: 0 },
      ],
    };
    const reconcile = vi.spyOn(transactionRepository, 'reconcileTransactionBatch');
    onTestFinished(() => reconcile.mockRestore());
    let serveParent = false;
    mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => new Map(
      txids.flatMap(requested => {
        if (requested === txid) return [[requested, receive]];
        if (serveParent && requested === payerParentTxid) return [[requested, payerParent]];
        return [];
      }),
    ));

    await processTransactionsPhase(contextFor(walletId, txid));
    await flushPostCommitNotifications();

    expect(persistedCandidates()).toEqual([expect.objectContaining({
      txid,
      type: 'received',
      classificationInputsComplete: false,
    })]);
    expect(notifyNewTransactions).not.toHaveBeenCalled();
    expect(broadcastMock()).not.toHaveBeenCalled();

    // A later sync fetches the payer's parent, but the non-standard sibling
    // keeps the classification incomplete, so the row is never repaired and
    // never announced.
    serveParent = true;
    mockPrismaClient.transaction.createManyAndReturn.mockResolvedValueOnce([]);
    await processTransactionsPhase(contextFor(walletId, txid, {
      existingTxidSet: new Set([txid]),
      classificationRepairTxids: new Set([txid]),
      incompleteReceiveTxids: new Set([txid]),
    }));
    await flushPostCommitNotifications();

    expect(await reconcile.mock.results[1]?.value).toEqual([
      expect.objectContaining({ outcome: 'unchanged' }),
    ]);
    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    expect(notifyNewTransactions).not.toHaveBeenCalled();
    expect(broadcastMock()).not.toHaveBeenCalled();
  });

  it('does not announce a historical row a baseline sync stored incomplete when a later sync repairs it', async () => {
    const txid = 'baseline_historical_spend'.padEnd(64, 'a');
    const parentTxid = 'baseline_historical_parent'.padEnd(64, 'b');
    // First sync after an import or full resync: an old confirmed spend whose
    // parent cannot be fetched is stored incomplete and, being history, is not
    // announced.
    mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => new Map(
      txids.filter(requested => requested === txid)
        .map(requested => [requested, spendWithChange(txid, parentTxid, false)]),
    ));
    await processTransactionsPhase(contextFor(walletId, txid, {
      wallet: { id: walletId, network: 'testnet', lastSyncedAt: null } as any,
    }));
    await flushPostCommitNotifications();
    expect(notifyNewTransactions).not.toHaveBeenCalled();
    expect(broadcastMock()).not.toHaveBeenCalled();

    // A later sync completes it. The row was confirmed years before it was
    // stored, so it was never due an announcement.
    const ctx = await contextFromStoredIncompleteReceive(walletId, txid, {
      blockHeight: 800000,
      blockTime: new Date('2023-07-24T00:00:00.000Z'),
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([
      [txid, spendWithChange(txid, parentTxid, true)],
    ]));
    mockExistingClassification({
      id: 'baseline-historical-row',
      classificationInputsComplete: false,
      classificationVersion: CURRENT_TRANSACTION_CLASSIFICATION_VERSION,
      classificationAddressCount: 1,
    });
    await processTransactionsPhase({ ...ctx, currentBlockHeight: 900000 });
    await flushPostCommitNotifications();

    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'baseline-historical-row' },
      data: expect.objectContaining({ type: 'sent', classificationInputsComplete: true }),
    }));
    expect(notifyNewTransactions).not.toHaveBeenCalled();
    expect(broadcastMock()).not.toHaveBeenCalled();
  });

  it('announces once a held row that confirmed between syncs when a later sync repairs it', async () => {
    const txid = 'between_syncs_spend'.padEnd(64, 'c');
    const createdAt = new Date('2026-10-01T12:00:00.000Z');
    const ctx = await contextFromStoredIncompleteReceive(walletId, txid, {
      // Mined an hour before the sync that stored it: a normal sync would
      // have announced it, so the hold withheld a due announcement.
      blockHeight: 800000,
      blockTime: new Date(createdAt.getTime() - 60 * 60 * 1000),
      createdAt,
    });
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([
      [txid, spendWithChange(txid, 'between_syncs_parent'.padEnd(64, 'd'), true)],
    ]));
    mockExistingClassification({
      id: 'between-syncs-row',
      classificationInputsComplete: false,
      classificationVersion: CURRENT_TRANSACTION_CLASSIFICATION_VERSION,
      classificationAddressCount: 1,
    });

    await processTransactionsPhase(ctx);
    await flushPostCommitNotifications();

    expect(notifyNewTransactions).toHaveBeenCalledTimes(1);
    expect(notifyNewTransactions).toHaveBeenCalledWith(walletId, [
      expect.objectContaining({ txid, type: 'sent' }),
    ]);
    expect(broadcastMock()).toHaveBeenCalledTimes(1);
  });

  it('does not announce a confirmed row stored without a block time when a later sync repairs it', async () => {
    const txid = 'baseline_untimed_spend'.padEnd(64, 'e');
    const parentTxid = 'baseline_untimed_parent'.padEnd(64, 'f');
    // A baseline sync stores old confirmed history; the block-header
    // timestamp fetch failed, so the row has a height but no block time.
    mockElectrumClient.getTransactionsBatch.mockImplementation(async (txids: string[]) => new Map(
      txids.filter(requested => requested === txid)
        .map(requested => [requested, spendWithChange(txid, parentTxid, false)]),
    ));
    await processTransactionsPhase(contextFor(walletId, txid, {
      wallet: { id: walletId, network: 'testnet', lastSyncedAt: null } as any,
    }));
    await flushPostCommitNotifications();
    expect(notifyNewTransactions).not.toHaveBeenCalled();

    const ctx = await contextFromStoredIncompleteReceive(walletId, txid, {
      blockHeight: 800000,
      blockTime: null,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([
      [txid, spendWithChange(txid, parentTxid, true)],
    ]));
    mockExistingClassification({
      id: 'baseline-untimed-row',
      classificationInputsComplete: false,
      classificationVersion: CURRENT_TRANSACTION_CLASSIFICATION_VERSION,
      classificationAddressCount: 1,
    });
    await processTransactionsPhase({ ...ctx, currentBlockHeight: 900000 });
    await flushPostCommitNotifications();

    expect(mockPrismaClient.transaction.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'baseline-untimed-row' },
      data: expect.objectContaining({ type: 'sent', classificationInputsComplete: true }),
    }));
    expect(notifyNewTransactions).not.toHaveBeenCalled();
    expect(broadcastMock()).not.toHaveBeenCalled();
  });
}
