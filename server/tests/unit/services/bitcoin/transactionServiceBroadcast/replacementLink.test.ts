/**
 * replacementLink — shared pre- and post-broadcast RBF verification
 *
 * Exercises `assertReplacementLink`, `resolveReplacementLinkAfterBroadcast`,
 * and `selectCandidateOutpoints` directly, independent of the broadcast
 * pipeline. See persistTransaction.test.ts (post-broadcast, via
 * `persistTransaction`) and transactionServiceBroadcast.broadcastAndSave.failures-rbf.contracts.ts
 * (pre-broadcast, via `broadcastAndSave`) for the integrated behavior.
 */
import './transactionServiceBroadcastTestHarness';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import {
  assertReplacementLink,
  resolveReplacementLinkAfterBroadcast,
  selectCandidateOutpoints,
} from '../../../../../src/services/bitcoin/transactions/replacementLink';
import { InvalidInputError } from '../../../../../src/errors/ApiError';

const walletId = 'wallet-under-test';
const newTxid = 'e'.repeat(64);
const originalTxid = 'b'.repeat(64);
const sharedOutpoint = { txid: 'c'.repeat(64), vout: 0 };
const unrelatedOutpoint = { txid: 'd'.repeat(64), vout: 1 };

describe('selectCandidateOutpoints', () => {
  it('prefers the detailed input list when present', () => {
    const inputs = [{ txid: 'x'.repeat(64), vout: 0, address: 'addr', amount: 1000 }];
    const utxos = [{ txid: 'y'.repeat(64), vout: 1 }];

    expect(selectCandidateOutpoints(inputs, utxos)).toBe(inputs);
  });

  it('falls back to the bare UTXO outpoints when inputs is undefined', () => {
    const utxos = [{ txid: 'y'.repeat(64), vout: 1 }];

    expect(selectCandidateOutpoints(undefined, utxos)).toBe(utxos);
  });

  it('falls back to the bare UTXO outpoints when inputs is an empty array', () => {
    const utxos = [{ txid: 'y'.repeat(64), vout: 1 }];

    expect(selectCandidateOutpoints([], utxos)).toBe(utxos);
  });
});

describe('assertReplacementLink', () => {
  beforeEach(() => {
    resetPrismaMocks();
  });

  it('resolves without throwing for a verified replacement', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({ id: 'original-id', label: null });
    mockPrismaClient.transactionInput.findMany.mockResolvedValue([sharedOutpoint]);

    await expect(assertReplacementLink(walletId, originalTxid, [sharedOutpoint]))
      .resolves.toBeUndefined();
  });

  it('throws InvalidInputError when no matching unconfirmed original exists', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

    await expect(assertReplacementLink(walletId, originalTxid, [sharedOutpoint]))
      .rejects.toBeInstanceOf(InvalidInputError);
  });

  it('throws InvalidInputError when the original has no recorded inputs', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({ id: 'original-id', label: null });
    mockPrismaClient.transactionInput.findMany.mockResolvedValue([]);

    await expect(assertReplacementLink(walletId, originalTxid, [sharedOutpoint]))
      .rejects.toBeInstanceOf(InvalidInputError);
  });

  it('throws InvalidInputError when the same txid is spent at a different vout', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({ id: 'original-id', label: null });
    mockPrismaClient.transactionInput.findMany.mockResolvedValue([
      { txid: sharedOutpoint.txid, vout: sharedOutpoint.vout + 1 },
    ]);

    await expect(assertReplacementLink(walletId, originalTxid, [sharedOutpoint]))
      .rejects.toBeInstanceOf(InvalidInputError);
  });

  it('throws InvalidInputError when no candidate outpoint matches', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({ id: 'original-id', label: null });
    mockPrismaClient.transactionInput.findMany.mockResolvedValue([unrelatedOutpoint]);

    await expect(assertReplacementLink(walletId, originalTxid, [sharedOutpoint]))
      .rejects.toBeInstanceOf(InvalidInputError);
  });

  it('refuses an original that is already replaced, with a specific message', async () => {
    // findUnconfirmedTransactionForReplacement excludes an already-replaced
    // original, so the verified lookup resolves to null...
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
    // ...and the direct-by-txid lookup (used only to produce a precise
    // error) finds it and reports it as replaced.
    mockPrismaClient.transaction.findUnique.mockResolvedValue({
      rbfStatus: 'replaced',
      replacedByTxid: 'f'.repeat(64),
    });

    await expect(assertReplacementLink(walletId, originalTxid, [sharedOutpoint]))
      .rejects.toMatchObject({
        message: expect.stringContaining('already replaced'),
      });
  });

  it('refuses an original with replacedByTxid set even if rbfStatus was not updated, with a specific message', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
    mockPrismaClient.transaction.findUnique.mockResolvedValue({
      rbfStatus: 'active',
      replacedByTxid: 'f'.repeat(64),
    });

    await expect(assertReplacementLink(walletId, originalTxid, [sharedOutpoint]))
      .rejects.toMatchObject({
        message: expect.stringContaining('already replaced'),
      });
  });

  it('throws the generic message when the original truly does not exist', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
    mockPrismaClient.transaction.findUnique.mockResolvedValue(null);

    await expect(assertReplacementLink(walletId, originalTxid, [sharedOutpoint]))
      .rejects.toMatchObject({
        message: expect.stringContaining('does not match an unconfirmed transaction'),
      });
  });
});

describe('resolveReplacementLinkAfterBroadcast', () => {
  beforeEach(() => {
    resetPrismaMocks();
  });

  it('returns undefined when replacesTxid is absent (no lookup performed)', async () => {
    const result = await resolveReplacementLinkAfterBroadcast(
      walletId, newTxid, undefined, [sharedOutpoint], mockPrismaClient as never
    );

    expect(result).toBeUndefined();
    expect(mockPrismaClient.transaction.findFirst).not.toHaveBeenCalled();
  });

  it('returns the link and inherited label for a verified replacement', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({ id: 'original-id', label: 'Original label' });
    mockPrismaClient.transactionInput.findMany.mockResolvedValue([sharedOutpoint]);
    mockPrismaClient.transaction.updateMany.mockResolvedValue({ count: 1 });

    const result = await resolveReplacementLinkAfterBroadcast(
      walletId, newTxid, originalTxid, [sharedOutpoint], mockPrismaClient as never
    );

    expect(result).toEqual({ originalTransactionId: 'original-id', inheritedLabel: 'Original label' });
    expect(mockPrismaClient.transaction.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'original-id',
        rbfStatus: { not: 'replaced' },
        replacedByTxid: null,
      },
      data: {
        rbfStatus: 'replaced',
        replacedByTxid: newTxid,
      },
    });
  });

  it('returns the link without an inherited label when the original has none', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({ id: 'original-id', label: null });
    mockPrismaClient.transactionInput.findMany.mockResolvedValue([sharedOutpoint]);
    mockPrismaClient.transaction.updateMany.mockResolvedValue({ count: 1 });

    const result = await resolveReplacementLinkAfterBroadcast(
      walletId, newTxid, originalTxid, [sharedOutpoint], mockPrismaClient as never
    );

    expect(result).toEqual({ originalTransactionId: 'original-id', inheritedLabel: undefined });
  });

  it('returns undefined (never throws) when the link no longer verifies', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue(null);

    await expect(resolveReplacementLinkAfterBroadcast(
      walletId, newTxid, originalTxid, [sharedOutpoint], mockPrismaClient as never
    )).resolves.toBeUndefined();
    expect(mockPrismaClient.transaction.updateMany).not.toHaveBeenCalled();
  });

  it('returns undefined (never throws) when the compare-and-swap loses the race to a concurrent broadcast', async () => {
    mockPrismaClient.transaction.findFirst.mockResolvedValue({ id: 'original-id', label: 'Original label' });
    mockPrismaClient.transactionInput.findMany.mockResolvedValue([sharedOutpoint]);
    mockPrismaClient.transaction.updateMany.mockResolvedValue({ count: 0 });

    await expect(resolveReplacementLinkAfterBroadcast(
      walletId, newTxid, originalTxid, [sharedOutpoint], mockPrismaClient as never
    )).resolves.toBeUndefined();
  });
});
