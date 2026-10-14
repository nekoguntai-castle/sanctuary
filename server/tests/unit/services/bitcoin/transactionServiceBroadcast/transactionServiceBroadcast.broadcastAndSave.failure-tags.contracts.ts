import './transactionServiceBroadcastTestHarness';
import { describe, expect, it, type Mock } from 'vitest';
import { broadcastTransaction, DefiniteBroadcastRejectionError } from '../../../../../src/services/bitcoin/blockchain';
import { ConflictError, ForbiddenError } from '../../../../../src/errors/ApiError';
import {
  broadcastAndSave as broadcastValidatedArtifact,
  PreNetworkBroadcastRejectionError,
  readBroadcastFailureTag,
} from '../../../../../src/services/bitcoin/transactions/broadcasting';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { sampleUtxos } from '../../../../fixtures/bitcoin';
import { createValidatedBroadcastArtifactFixture } from '../../../../helpers/validatedBroadcastArtifact';
import {
  broadcastRecipient as recipient,
  broadcastWalletId as walletId,
  broadcastAndSave,
  withBroadcastNetwork,
} from './transactionServiceBroadcast.broadcastAndSave.shared';
import {
  createRawTxHex,
  mockAssertWalletHardwareCapabilityById,
  mockClaimSigningIntentBroadcast,
  mockMarkSigningIntentBroadcastStalled,
  mockMarkSigningIntentBroadcastUnknown,
  mockReleaseRejectedSigningIntentBroadcast,
} from './transactionServiceBroadcastTestHarness';

type PriorState = 'ready' | 'resumed' | 'stalled';

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
const failureOf = (error: unknown) => (error as { broadcastFailure?: unknown }).broadcastFailure;
const caught = (promise: Promise<unknown>) => promise.then(
  () => { throw new Error('expected broadcastAndSave to reject'); },
  (error: unknown) => error,
);

export const registerBroadcastAndSaveFailureTagContracts = () => {
  describe('failure tags for the route release rule', () => {
    it('tags an unknown outcome on a first claim as not returned to ready', async () => {
      claimAs('ready');
      const error = new Error('Broadcast outcome is unknown: connection lost');
      (broadcastTransaction as Mock).mockRejectedValueOnce(error);

      await expect(broadcastAndSave(walletId, undefined, metadata())).rejects.toBe(error);
      expect(failureOf(error)).toEqual({ claimed: true, priorState: 'ready', releasedToReady: false });
    });

    it('tags a definite rejection of a first claim as returned to ready when the release succeeded', async () => {
      claimAs('ready');
      const error = new DefiniteBroadcastRejectionError('rejected');
      (broadcastTransaction as Mock).mockRejectedValueOnce(error);

      await expect(broadcastAndSave(walletId, undefined, metadata())).rejects.toBe(error);
      expect(failureOf(error)).toEqual({ claimed: true, priorState: 'ready', releasedToReady: true });
    });

    it.each([
      ['returned false', () => mockReleaseRejectedSigningIntentBroadcast.mockResolvedValueOnce(false)],
      ['threw', () => mockReleaseRejectedSigningIntentBroadcast.mockRejectedValueOnce(new Error('db down'))],
    ])('tags a definite rejection as not returned to ready when the release %s', async (_label, arrange) => {
      claimAs('ready');
      arrange();
      const error = new DefiniteBroadcastRejectionError('rejected');
      (broadcastTransaction as Mock).mockRejectedValueOnce(error);

      await expect(broadcastAndSave(walletId, undefined, metadata())).rejects.toBe(error);
      expect(failureOf(error)).toEqual({ claimed: true, priorState: 'ready', releasedToReady: false });
    });

    it('tags a definite rejection on a resumed claim as not returned to ready', async () => {
      claimAs('resumed');
      const error = new DefiniteBroadcastRejectionError('rejected');
      (broadcastTransaction as Mock).mockRejectedValueOnce(error);

      await expect(broadcastAndSave(walletId, undefined, metadata())).rejects.toBe(error);
      expect(mockMarkSigningIntentBroadcastUnknown).toHaveBeenCalled();
      expect(failureOf(error)).toEqual({ claimed: true, priorState: 'resumed', releasedToReady: false });
    });

    it('tags the stalled conflict it throws instead of the node error', async () => {
      claimAs('stalled');
      (broadcastTransaction as Mock).mockRejectedValueOnce(new Error('Broadcast outcome is unknown'));

      const error = await caught(broadcastAndSave(walletId, undefined, metadata()));
      expect(error).toBeInstanceOf(ConflictError);
      expect(mockMarkSigningIntentBroadcastStalled).toHaveBeenCalled();
      expect(failureOf(error)).toEqual({ claimed: true, priorState: 'stalled', releasedToReady: false });
    });

    it.each([
      ['ready', true, true],
      ['ready', false, false],
      ['resumed', true, false],
      ['stalled', true, false],
    ] as const)(
      'tags a replacesTxid mismatch on a %s claim (transition %s) with releasedToReady %s',
      async (priorState, transitioned, releasedToReady) => {
        mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
        claimAs(priorState);
        mockReleaseRejectedSigningIntentBroadcast.mockResolvedValueOnce(transitioned);

        const error = await caught(broadcastAndSave(walletId, undefined, replacementMetadata()));
        expect(error).toBeInstanceOf(PreNetworkBroadcastRejectionError);
        expect(failureOf(error)).toEqual({ claimed: true, priorState, releasedToReady });
        expect(broadcastTransaction).not.toHaveBeenCalled();
      },
    );

    it('tags a replacesTxid mismatch as not returned to ready when the release throws', async () => {
      mockPrismaClient.transaction.findFirst.mockResolvedValue(null);
      claimAs('ready');
      mockReleaseRejectedSigningIntentBroadcast.mockRejectedValueOnce(new Error('db down'));

      const error = await caught(broadcastAndSave(walletId, undefined, replacementMetadata()));
      expect(failureOf(error)).toEqual({ claimed: true, priorState: 'ready', releasedToReady: false });
    });

    it.each([
      ['a busy claim', () => mockClaimSigningIntentBroadcast.mockRejectedValueOnce(new ConflictError('busy'))],
      ['a hardware-capability refusal', () => mockAssertWalletHardwareCapabilityById.mockRejectedValueOnce(
        new ForbiddenError('blocked'),
      )],
    ])('tags %s as unclaimed', async (_label, arrange) => {
      arrange();

      const error = await caught(broadcastAndSave(walletId, undefined, metadata()));
      expect(error).toBeInstanceOf(PreNetworkBroadcastRejectionError);
      expect(failureOf(error)).toEqual({ claimed: false, releasedToReady: false });
    });

    it('leaves a non-ApiError claim failure untagged: the claim may have committed', async () => {
      const error = new Error('connection reset after commit');
      mockClaimSigningIntentBroadcast.mockRejectedValueOnce(error);

      await expect(broadcastAndSave(walletId, undefined, metadata())).rejects.toBe(error);
      expect(failureOf(error)).toBeUndefined();
    });

    it('cannot tag a thrown primitive and rethrows it unchanged', async () => {
      claimAs('ready');
      (broadcastTransaction as Mock).mockRejectedValueOnce('socket closed');

      await expect(broadcastAndSave(walletId, undefined, metadata())).rejects.toBe('socket closed');
    });

    it('forwards a resume-only request to the claim', async () => {
      const artifact = createValidatedBroadcastArtifactFixture({
        walletId, network: 'testnet4', rawTx: '00', txid: 'new-txid-from-broadcast', intentId: 'intent-resume',
      });
      mockClaimSigningIntentBroadcast.mockResolvedValueOnce({ status: 'complete' });
      const persisted = { recipient, amount: 1, fee: 1, utxos: metadata().utxos };

      await broadcastValidatedArtifact(artifact, persisted, { resumeOnly: true });
      expect(mockClaimSigningIntentBroadcast).toHaveBeenLastCalledWith(
        artifact, persisted, expect.any(Date), { resumeOnly: true },
      );

      await broadcastValidatedArtifact(artifact, persisted);
      expect(mockClaimSigningIntentBroadcast).toHaveBeenLastCalledWith(
        artifact, persisted, expect.any(Date), { resumeOnly: false },
      );
    });

    it.each([
      ['a primitive', 'boom', null],
      ['null', null, null],
      ['an untagged error', new Error('x'), null],
      ['a non-object tag', Object.assign(new Error('x'), { broadcastFailure: 'ready' }), null],
      ['an unclaimed tag', Object.assign(new Error('x'), { broadcastFailure: { claimed: false, releasedToReady: true } }),
        { claimed: false, releasedToReady: false }],
      ['a claimed tag', Object.assign(new Error('x'), {
        broadcastFailure: { claimed: true, priorState: 'resumed', releasedToReady: false },
      }), { claimed: true, priorState: 'resumed', releasedToReady: false }],
      ['an unknown prior state', Object.assign(new Error('x'), {
        broadcastFailure: { claimed: true, priorState: 'ready-ish', releasedToReady: true },
      }), null],
      ['a non-boolean release flag', Object.assign(new Error('x'), {
        broadcastFailure: { claimed: true, priorState: 'ready', releasedToReady: 'yes' },
      }), null],
      ['a non-boolean claim flag', Object.assign(new Error('x'), {
        broadcastFailure: { claimed: 'yes', priorState: 'ready', releasedToReady: true },
      }), null],
    ])('reads %s', (_label, error, expected) => {
      expect(readBroadcastFailureTag(error)).toEqual(expected);
    });
  });
};
