import './transactionServiceBroadcastTestHarness';
import { describe, expect, it, type Mock } from 'vitest';
import { broadcastTransaction, DefiniteBroadcastRejectionError } from '../../../../../src/services/bitcoin/blockchain';
import { ConflictError } from '../../../../../src/errors/ApiError';
import { ElectrumRpcError } from '../../../../../src/services/bitcoin/electrum/types';
import { PreNetworkBroadcastRejectionError } from '../../../../../src/services/bitcoin/transactions/broadcasting';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos } from '../../../../fixtures/bitcoin';
import {
  broadcastRecipient as recipient,
  broadcastWalletId as walletId,
  broadcastAndSave,
  withBroadcastNetwork,
} from './transactionServiceBroadcast.broadcastAndSave.shared';
import {
  createRawTxHex,
  mockClaimSigningIntentBroadcast,
  mockMarkSigningIntentBroadcastAccepted,
  mockMarkSigningIntentBroadcastStalled,
  mockMarkSigningIntentBroadcastUnknown,
  mockReleaseRejectedSigningIntentBroadcast,
} from './transactionServiceBroadcastTestHarness';

type PriorState = 'ready' | 'resumed' | 'stalled';

const INTENT = 'intent-broadcast-persistence-test';
const withOutcome = (cause?: unknown) =>
  Object.assign(new Error('Broadcast outcome is unknown: boom'), cause === undefined ? {} : { cause });

const metadata = () => withBroadcastNetwork({
  recipient,
  amount: 50000,
  fee: 1000,
  utxos: [{ txid: sampleUtxos[0].txid, vout: sampleUtxos[0].vout }],
  rawTxHex: createRawTxHex([{ address: recipient, value: 50000 }]),
});

const replacementMetadata = () => ({ ...metadata(), replacesTxid: 'orig-'.padEnd(64, '0') });

const claimAs = (priorState: PriorState) =>
  mockClaimSigningIntentBroadcast.mockResolvedValueOnce({ status: 'claimed', leaseToken: 'lease-1', priorState });

export const registerBroadcastAndSaveClaimStateContracts = () => {
  describe('claim prior state', () => {
    it.each([
      ['ready', true],
      ['resumed', false],
      ['stalled', false],
    ] as const)('forwards allowDefiniteRejection for a %s claim', async (priorState, expected) => {
      claimAs(priorState);
      await broadcastAndSave(walletId, undefined, metadata());
      expect(broadcastTransaction).toHaveBeenCalledWith(expect.anything(), expected);
    });

    it('releases a first claim on a definite node rejection', async () => {
      claimAs('ready');
      (broadcastTransaction as Mock).mockRejectedValueOnce(new DefiniteBroadcastRejectionError('rejected'));
      await expect(broadcastAndSave(walletId, undefined, metadata())).rejects.toThrow('rejected');
      expect(mockReleaseRejectedSigningIntentBroadcast).toHaveBeenCalledWith(INTENT, 'lease-1', 'rejected');
      expect(mockMarkSigningIntentBroadcastUnknown).not.toHaveBeenCalled();
      expect(mockMarkSigningIntentBroadcastStalled).not.toHaveBeenCalled();
    });

    it.each([
      ['a verdict RPC cause counts the attempt', withOutcome(new ElectrumRpcError('txn-already-known')), true],
      ['a non-verdict RPC cause gives it back', withOutcome(new ElectrumRpcError('bitcoind is down')), false],
      ['a transport cause gives it back', withOutcome(new Error('connection lost')), false],
      ['a failure without a cause gives it back', withOutcome(), false],
    ])('keeps an ambiguous outcome unknown: %s', async (_label, error, countAttempt) => {
      claimAs('ready');
      (broadcastTransaction as Mock).mockRejectedValueOnce(error);
      await expect(broadcastAndSave(walletId, undefined, metadata())).rejects.toBe(error);
      expect(mockMarkSigningIntentBroadcastUnknown).toHaveBeenCalledWith(
        INTENT, 'lease-1', 'Broadcast outcome is unknown: boom', { countAttempt },
      );
      expect(mockReleaseRejectedSigningIntentBroadcast).not.toHaveBeenCalled();
    });

    it('never rolls a resumed claim back to ready, even for a definite rejection', async () => {
      claimAs('resumed');
      (broadcastTransaction as Mock).mockRejectedValueOnce(new DefiniteBroadcastRejectionError('rejected'));
      await expect(broadcastAndSave(walletId, undefined, metadata())).rejects.toThrow('rejected');
      expect(mockReleaseRejectedSigningIntentBroadcast).not.toHaveBeenCalled();
      expect(mockMarkSigningIntentBroadcastUnknown).toHaveBeenCalledWith(
        INTENT, 'lease-1', 'rejected', { countAttempt: false },
      );
    });

    it('accepts a stalled intent when the re-submission succeeds', async () => {
      claimAs('stalled');
      await expect(broadcastAndSave(walletId, undefined, metadata()))
        .resolves.toMatchObject({ broadcasted: true });
      expect(mockMarkSigningIntentBroadcastAccepted).toHaveBeenCalledWith(INTENT, 'lease-1');
      expect(mockMarkSigningIntentBroadcastStalled).not.toHaveBeenCalled();
    });

    it('returns a failed stalled re-submission to stalled with an actionable terminal conflict', async () => {
      claimAs('stalled');
      (broadcastTransaction as Mock).mockRejectedValueOnce(withOutcome(new Error('connection lost')));
      const error = await broadcastAndSave(walletId, undefined, metadata()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error).not.toBeInstanceOf(PreNetworkBroadcastRejectionError);
      expect(error).toMatchObject({
        statusCode: 409,
        details: { reason: 'broadcast_stalled' },
        message: expect.stringContaining('Check a block explorer for the txid before creating a replacement.'),
      });
      expect((error as Error).message).not.toContain('already in progress');
      expect(mockMarkSigningIntentBroadcastStalled).toHaveBeenCalledWith(
        INTENT, 'lease-1', 'Broadcast outcome is unknown: boom',
      );
      expect(mockMarkSigningIntentBroadcastUnknown).not.toHaveBeenCalled();
      expect(mockReleaseRejectedSigningIntentBroadcast).not.toHaveBeenCalled();
    });

    it('surfaces the stalled conflict even when persisting the stalled state fails', async () => {
      claimAs('stalled');
      (broadcastTransaction as Mock).mockRejectedValueOnce(withOutcome());
      mockMarkSigningIntentBroadcastStalled.mockRejectedValueOnce(new Error('database offline'));
      await expect(broadcastAndSave(walletId, undefined, metadata())).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('replacement-link failure by claim prior state', () => {
    const arrange = (priorState: PriorState) => {
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
      claimAs(priorState);
    };

    it('releases a first claim', async () => {
      arrange('ready');
      await expect(broadcastAndSave(walletId, undefined, replacementMetadata())).rejects.toThrow();
      expect(mockReleaseRejectedSigningIntentBroadcast).toHaveBeenCalledWith(INTENT, 'lease-1', expect.any(String));
      expect(mockMarkSigningIntentBroadcastUnknown).not.toHaveBeenCalled();
      expect(mockMarkSigningIntentBroadcastStalled).not.toHaveBeenCalled();
    });

    it('keeps a resumed claim unknown instead of rolling it back', async () => {
      arrange('resumed');
      await expect(broadcastAndSave(walletId, undefined, replacementMetadata())).rejects.toThrow();
      // The failure never reached a node, so it must not count toward the stall cap.
      expect(mockMarkSigningIntentBroadcastUnknown).toHaveBeenCalledWith(
        INTENT, 'lease-1', expect.any(String), { countAttempt: false },
      );
      expect(mockReleaseRejectedSigningIntentBroadcast).not.toHaveBeenCalled();
      expect(mockMarkSigningIntentBroadcastStalled).not.toHaveBeenCalled();
    });

    it('re-marks a claim from stalled as stalled and throws the pre-network rejection', async () => {
      arrange('stalled');
      const error = await broadcastAndSave(walletId, undefined, replacementMetadata()).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PreNetworkBroadcastRejectionError);
      expect(error).not.toBeInstanceOf(ConflictError);
      expect((error as Error).message).toContain('replacesTxid does not match');
      expect(mockMarkSigningIntentBroadcastStalled).toHaveBeenCalledWith(INTENT, 'lease-1', expect.any(String));
      expect(mockMarkSigningIntentBroadcastUnknown).not.toHaveBeenCalled();
      expect(mockReleaseRejectedSigningIntentBroadcast).not.toHaveBeenCalled();
      expect(broadcastTransaction).not.toHaveBeenCalled();
    });
  });

  describe('drafts bound to the signing intent', () => {
    const boundDraftWhere = {
      where: { walletId, signingIntentId: INTENT, status: { in: ['unsigned', 'partial', 'signed'] } },
      data: { status: 'broadcasted', updatedAt: expect.any(Date) },
    };

    it('archives a draft saved while the broadcast was in flight when the broadcast is accepted', async () => {
      claimAs('ready');
      await broadcastAndSave(walletId, undefined, metadata());
      expect(mockPrismaClient.draftTransaction.updateMany).toHaveBeenCalledWith(boundDraftWhere);
    });

    it('archives the draft on an idempotent replay of an already-complete broadcast', async () => {
      mockClaimSigningIntentBroadcast.mockResolvedValueOnce({ status: 'complete' });
      await expect(broadcastAndSave(walletId, undefined, { ...metadata(), draftId: 'draft-1' }))
        .resolves.toMatchObject({ persistenceStatus: 'complete' });
      expect(mockPrismaClient.draftUtxoLock.deleteMany).toHaveBeenCalledWith({
        where: { draft: { walletId, signingIntentId: INTENT } },
      });
      expect(mockPrismaClient.draftTransaction.updateMany).toHaveBeenCalledWith(boundDraftWhere);
      expect(mockPrismaClient.transaction.createMany).not.toHaveBeenCalled();
    });

    it('still reports a complete replay when archiving its draft fails', async () => {
      mockClaimSigningIntentBroadcast.mockResolvedValueOnce({ status: 'complete' });
      mockPrismaClient.draftTransaction.updateMany.mockRejectedValueOnce(new Error('db down'));
      await expect(broadcastAndSave(walletId, undefined, { ...metadata(), draftId: 'draft-1' }))
        .resolves.toMatchObject({ persistenceStatus: 'complete' });
    });
  });
};
