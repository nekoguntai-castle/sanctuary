/**
 * persistTransaction — RBF replacement linkage
 *
 * `metadata.replacesTxid` is the only signal that may link a broadcast
 * transaction to the one it replaces; `metadata.memo` is display text and
 * must have no effect on linkage. `persistTransaction` runs AFTER the
 * transaction has already been broadcast to the network (the invalid case
 * is rejected earlier, pre-broadcast, by `assertReplacementLink` — see
 * replacementLink.test.ts), so a `replacesTxid` that no longer verifies
 * here (e.g. the original confirmed in the race between the pre-broadcast
 * check and persistence) must never fail persistence of an
 * already-accepted transaction: it only skips linkage and logs a warning.
 * See iteration-18 plan Phase 5 (rbf-memo-prefix-spoofs-transaction-replacement).
 */
import './transactionServiceBroadcastTestHarness';
import { createRawTxHex } from './transactionServiceBroadcastTestHarness';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import { persistTransaction } from '../../../../../src/services/bitcoin/transactions/persistTransaction';

const walletId = 'wallet-under-test';
const newTxid = 'new-tx-' + 'a'.repeat(57);
const originalTxid = 'b'.repeat(64);
const sharedInput = { txid: 'c'.repeat(64), vout: 0 };
const unrelatedInput = { txid: 'd'.repeat(64), vout: 1 };
const rawTxHex = '0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000';

const baseMetadata = {
  recipient: 'tb1qexternalrecipientaddress00000000000000',
  amount: 45000,
  fee: 2000,
  utxos: [sharedInput],
  inputs: [{ txid: sharedInput.txid, vout: sharedInput.vout, address: 'addr-in', amount: 50000 }],
  outputs: [{ address: 'addr-out', amount: 45000, outputType: 'recipient' as const, isOurs: false }],
};

describe('persistTransaction — RBF replacement linkage', () => {
  beforeEach(() => {
    resetPrismaMocks();
    mockLogger.warn.mockClear();
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 1 });
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
  });

  it('does not link a replacement from the memo prefix alone', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({
      id: 'original-db-id',
      txid: originalTxid,
      walletId,
      confirmations: 0,
      blockHeight: null,
      label: 'Original label',
    });

    await persistTransaction(walletId, newTxid, rawTxHex, {
      ...baseMetadata,
      memo: `Replacing transaction ${originalTxid}`,
      // No replacesTxid: the memo prefix alone must have no effect.
    });

    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          replacementForTxid: undefined,
          memo: `Replacing transaction ${originalTxid}`,
        })],
      })
    );
  });

  it('skips a stale link (original since confirmed) without throwing, and still stores the transaction', async () => {
    // The where-clause filter (confirmations: 0, blockHeight: null) excludes
    // a since-confirmed original, so the lookup resolves to null here.
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

    await expect(persistTransaction(walletId, newTxid, rawTxHex, {
      ...baseMetadata,
      replacesTxid: originalTxid,
    })).resolves.toMatchObject({ mainTransactionCreated: true });

    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ replacementForTxid: undefined })],
      })
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping RBF replacement link'),
      expect.objectContaining({ txid: newTxid, replacesTxid: originalTxid })
    );
  });

  it('skips a stale link (no shared input) without throwing, and still stores the transaction', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({
      id: 'original-db-id',
      txid: originalTxid,
      walletId,
      confirmations: 0,
      blockHeight: null,
      label: null,
    });
    mockPrismaClient.transactionInput.findMany.mockResolvedValue([unrelatedInput]);

    await expect(persistTransaction(walletId, newTxid, rawTxHex, {
      ...baseMetadata,
      replacesTxid: originalTxid,
    })).resolves.toMatchObject({ mainTransactionCreated: true });

    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ replacementForTxid: undefined })],
      })
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping RBF replacement link'),
      expect.objectContaining({ txid: newTxid, replacesTxid: originalTxid })
    );
  });

  it('links a genuine replacement and inherits the original label', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({
      id: 'original-db-id',
      txid: originalTxid,
      walletId,
      confirmations: 0,
      blockHeight: null,
      label: 'Original payment label',
    });
    mockPrismaClient.transactionInput.findMany.mockResolvedValue([sharedInput]);
    mockPrismaClient.transaction.updateMany.mockResolvedValue({ count: 1 });

    await persistTransaction(walletId, newTxid, rawTxHex, {
      ...baseMetadata,
      label: undefined,
      replacesTxid: originalTxid,
    });

    // The link is a compare-and-swap (repository `updateMany`), not a blind
    // `update`: it only commits when the original is still unreplaced at
    // write time, closing the race against a concurrent broadcast.
    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    expect(mockPrismaClient.transaction.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'original-db-id',
        rbfStatus: { not: 'replaced' },
        replacedByTxid: null,
      },
      data: { rbfStatus: 'replaced', replacedByTxid: newTxid },
    });
    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          replacementForTxid: originalTxid,
          label: 'Original payment label',
        })],
      })
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('stores the transaction without linkage and warns when the original was already replaced by a concurrent broadcast', async () => {
    // The pre-write verification found an unreplaced original...
    mockPrismaClient.transaction.findFirst.mockResolvedValue({
      id: 'original-db-id',
      txid: originalTxid,
      walletId,
      confirmations: 0,
      blockHeight: null,
      label: 'Original payment label',
    });
    mockPrismaClient.transactionInput.findMany.mockResolvedValue([sharedInput]);
    // ...but a concurrent broadcast linked a different replacement to it
    // first, so the compare-and-swap `updateMany` updates zero rows.
    mockPrismaClient.transaction.updateMany.mockResolvedValue({ count: 0 });

    await expect(persistTransaction(walletId, newTxid, rawTxHex, {
      ...baseMetadata,
      label: undefined,
      replacesTxid: originalTxid,
    })).resolves.toMatchObject({ mainTransactionCreated: true });

    expect(mockPrismaClient.transaction.update).not.toHaveBeenCalled();
    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          replacementForTxid: undefined,
          label: undefined,
        })],
      })
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('original was already replaced by a concurrent broadcast'),
      expect.objectContaining({
        txid: newTxid,
        replacesTxid: originalTxid,
        originalTransactionId: 'original-db-id',
      })
    );
  });

  it('prefers an explicitly provided label over the inherited one', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({
      id: 'original-db-id',
      txid: originalTxid,
      walletId,
      confirmations: 0,
      blockHeight: null,
      label: 'Old label',
    });
    mockPrismaClient.transactionInput.findMany.mockResolvedValue([sharedInput]);

    await persistTransaction(walletId, newTxid, rawTxHex, {
      ...baseMetadata,
      label: 'New explicit label',
      replacesTxid: originalTxid,
    });

    expect(mockPrismaClient.transaction.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          label: 'New explicit label',
        })],
      })
    );
  });
});

describe('persistTransaction — marks the wallet\'s own output addresses used', () => {
  beforeEach(() => {
    resetPrismaMocks();
    mockLogger.warn.mockClear();
    mockPrismaClient.transaction.createMany.mockResolvedValue({ count: 1 });
    mockPrismaClient.wallet.findUnique.mockResolvedValue({ network: 'testnet' });
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
  });

  it('marks a change output used with one updateMany scoped to the wallet', async () => {
    await persistTransaction(walletId, newTxid, rawTxHex, {
      ...baseMetadata,
      outputs: [
        { address: 'bc1qrecipient', amount: 45000, outputType: 'recipient', isOurs: false },
        { address: 'bc1qchange', amount: 4000, outputType: 'change', isOurs: true },
      ],
    });

    expect(mockPrismaClient.address.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrismaClient.address.updateMany).toHaveBeenCalledWith({
      where: { walletId, address: { in: ['bc1qchange'] }, used: false },
      data: { used: true },
    });
  });

  it('includes the recipient address when the recipient is our own (consolidation)', async () => {
    await persistTransaction(walletId, newTxid, rawTxHex, {
      ...baseMetadata,
      recipient: 'bc1qownrecipient',
      outputs: [
        { address: 'bc1qownrecipient', amount: 45000, outputType: 'consolidation', isOurs: true },
      ],
    });

    expect(mockPrismaClient.address.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrismaClient.address.updateMany).toHaveBeenCalledWith({
      where: { walletId, address: { in: ['bc1qownrecipient'] }, used: false },
      data: { used: true },
    });
  });

  it('marks our output used when ownership is derived from the raw transaction (no output metadata)', async () => {
    const ownedChange = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
    mockPrismaClient.address.findMany.mockResolvedValue([{ address: ownedChange }]);

    await persistTransaction(walletId, newTxid, createRawTxHex([
      { address: 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7', value: 45000 },
      { address: ownedChange, value: 4000 },
    ]), { ...baseMetadata, outputs: undefined });

    expect(mockPrismaClient.address.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrismaClient.address.updateMany).toHaveBeenCalledWith({
      where: { walletId, address: { in: [ownedChange] }, used: false },
      data: { used: true },
    });
  });

  it('does not mark anything used when no output is our own', async () => {
    await persistTransaction(walletId, newTxid, rawTxHex, {
      ...baseMetadata,
      outputs: [
        { address: 'bc1qrecipient', amount: 45000, outputType: 'recipient', isOurs: false },
      ],
    });

    expect(mockPrismaClient.address.updateMany).not.toHaveBeenCalled();
  });
});
