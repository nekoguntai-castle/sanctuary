import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../phasesProcessTransactions/processTransactionsTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../../../../mocks/prisma';
import {
  mockElectrumClient,
  resetElectrumMocks,
  createMockTransaction,
} from '../../../../../../mocks/electrum';
import {
  createTestContext,
  processTransactionsPhase,
} from '../../../../../../../src/services/bitcoin/sync';
import { sendNotifications } from '../../../../../../../src/services/bitcoin/sync/phases/processTransactions/notifications';

vi.mock('../../../../../../../src/services/bitcoin/sync/phases/processTransactions/notifications', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../../../../../src/services/bitcoin/sync/phases/processTransactions/notifications')>()),
  sendNotifications: vi.fn().mockResolvedValue(undefined),
}));

describe('processTransactionsPhase baseline notifications', () => {
  const walletId = 'test-wallet';
  const confirmedTxid = 'confirmed_hist'.padEnd(64, 'a');
  const pendingTxid = 'pending_new'.padEnd(64, 'b');
  const walletAddress = 'tb1q_wallet_addr';

  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
    vi.clearAllMocks();
    mockPrismaClient.transaction.findMany.mockResolvedValue([]);
    mockPrismaClient.transaction.createManyAndReturn.mockImplementation(async (args: any) => args.data);
    mockPrismaClient.transactionInput.createMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.transactionOutput.createMany.mockResolvedValue({ count: 0 });
    mockPrismaClient.addressLabel.findMany.mockResolvedValue([]);
  });

  async function run(lastSyncedAt: Date | null) {
    const details = (txid: string) => createMockTransaction({
      txid,
      inputs: [{ txid: 'prev'.padEnd(64, 'c'), vout: 0, value: 0.001, address: 'external' }],
      outputs: [{ value: 0.0009, address: walletAddress }],
    });
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(new Map([
      [confirmedTxid, details(confirmedTxid)],
      [pendingTxid, details(pendingTxid)],
    ]));
    const ctx = createTestContext({
      walletId,
      wallet: { id: walletId, network: 'mainnet', lastSyncedAt } as any,
      client: mockElectrumClient as any,
      newTxids: [confirmedTxid, pendingTxid],
      historyResults: new Map([[walletAddress, [
        { tx_hash: confirmedTxid, height: 800000 },
        { tx_hash: pendingTxid, height: 0 },
      ]]]),
      walletAddressSet: new Set([walletAddress]),
      addressMap: new Map([[walletAddress, { id: 'addr-1', address: walletAddress } as any]]),
      existingTxMap: new Map(),
      txDetailsCache: new Map() as any,
      currentBlockHeight: 800100,
    });
    await processTransactionsPhase(ctx);
    await Promise.resolve();
  }

  it('notifies only unconfirmed created transactions on a baseline sync', async () => {
    await run(null);
    const sent = vi.mocked(sendNotifications).mock.calls.flatMap(([, txs]) => txs.map(t => t.txid));
    expect(sent).toEqual([pendingTxid]);
  });

  it('notifies every created transaction on an incremental sync', async () => {
    await run(new Date('2026-01-01T00:00:00Z'));
    const sent = vi.mocked(sendNotifications).mock.calls.flatMap(([, txs]) => txs.map(t => t.txid));
    expect(sent.sort()).toEqual([confirmedTxid, pendingTxid].sort());
  });
});
