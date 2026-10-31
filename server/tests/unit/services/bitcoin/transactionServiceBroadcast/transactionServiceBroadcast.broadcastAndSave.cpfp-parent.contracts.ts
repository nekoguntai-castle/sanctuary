import './transactionServiceBroadcastTestHarness';
import { describe, expect, it, vi, type Mock } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { broadcastTransaction } from '../../../../../src/services/bitcoin/blockchain';
import { getNodeClient } from '../../../../../src/services/bitcoin/nodeClient';
import { CPFP_PARENT_LOOKUP_DEADLINE_MS } from '../../../../../src/services/bitcoin/parentConfirmation';
import {
  broadcastAndSave,
  PreNetworkBroadcastRejectionError,
  readBroadcastFailureTag,
} from '../../../../../src/services/bitcoin/transactions/broadcasting';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { createValidatedBroadcastArtifactFixture } from '../../../../helpers/validatedBroadcastArtifact';
import {
  broadcastNetwork as network,
  broadcastRecipient as recipient,
  broadcastWalletId as walletId,
} from './transactionServiceBroadcast.broadcastAndSave.shared';
import {
  createRawTxHex,
  mockClaimSigningIntentBroadcast,
  mockMarkSigningIntentBroadcastAccepted,
  mockReleaseRejectedSigningIntentBroadcast,
} from './transactionServiceBroadcastTestHarness';

const parent = new bitcoin.Transaction();
parent.version = 2;
parent.addInput(Buffer.alloc(32, 7), 0);
parent.addOutput(bitcoin.address.toOutputScript(recipient, bitcoin.networks.testnet), 60_000n);
const parentTxid = parent.getId();

const rawTx = createRawTxHex([{ address: recipient, value: 50_000 }]);
const artifact = () => createValidatedBroadcastArtifactFixture({
  walletId,
  network,
  rawTx,
  txid: 'new-txid-from-broadcast',
  intentId: 'intent-cpfp-child',
  snapshot: {
    version: 1,
    walletId,
    network,
    transaction: {
      version: 2,
      locktime: 0,
      inputs: [{
        txid: parentTxid,
        vout: 0,
        sequence: 0xffffffff,
        prevout: { amountSats: '60000', scriptPubKeyHex: Buffer.from(parent.outs[0].script).toString('hex'), role: 'wallet' },
      }],
      outputs: [{ amountSats: '50000', scriptPubKeyHex: '00' }],
    },
  },
});
const metadata = { recipient, amount: 50_000, fee: 10_000, utxos: [{ txid: parentTxid, vout: 0 }] };

const serveParent = (history: Array<{ tx_hash: string; height: number }> | Error) => {
  const client = {
    getTransaction: vi.fn().mockResolvedValue({ hex: parent.toHex() }),
    getAddressHistory: history instanceof Error
      ? vi.fn().mockRejectedValue(history)
      : vi.fn().mockResolvedValue(history),
  };
  (getNodeClient as Mock).mockResolvedValueOnce(client);
  return client;
};

const claimAs = (source: string) => mockClaimSigningIntentBroadcast.mockResolvedValueOnce({
  status: 'claimed', leaseToken: 'lease-1', priorState: 'ready', source,
});

export const registerBroadcastAndSaveCpfpParentContracts = () => {
  describe('CPFP parent confirmation at broadcast', () => {
    it('refuses a CPFP child whose parent is already mined, before the network, and releases the claim', async () => {
      claimAs('cpfp');
      serveParent([{ tx_hash: parentTxid, height: 850_000 }]);

      const error: unknown = await broadcastAndSave(artifact(), metadata).then(() => 'resolved', (caught: unknown) => caught);

      expect(error).toBeInstanceOf(PreNetworkBroadcastRejectionError);
      expect(error).toMatchObject({
        statusCode: 409,
        message: 'Parent transaction is already confirmed; CPFP is not needed',
        details: { reason: 'cpfp_parent_confirmed', parentTxid },
      });
      expect(readBroadcastFailureTag(error)).toEqual({ claimed: true, priorState: 'ready', releasedToReady: true });
      expect(mockReleaseRejectedSigningIntentBroadcast).toHaveBeenCalledWith('intent-cpfp-child', 'lease-1', expect.any(String));
      expect(broadcastTransaction).not.toHaveBeenCalled();
    });

    it('refuses from the wallet row alone when it already records the parent as confirmed', async () => {
      claimAs('cpfp');
      mockPrismaClient.transaction.findUnique.mockResolvedValueOnce({ txid: parentTxid, confirmations: 3, blockHeight: 850_000 });

      await expect(broadcastAndSave(artifact(), metadata)).rejects.toMatchObject({ statusCode: 409 });
      // The wallet row settles it before any node call.
      expect(getNodeClient).not.toHaveBeenCalled();
      expect(broadcastTransaction).not.toHaveBeenCalled();
    });

    it('fails closed with a retryable 503 when the parent lookup outlives its deadline', async () => {
      vi.useFakeTimers();
      try {
        claimAs('cpfp');
        (getNodeClient as Mock).mockResolvedValueOnce({
          getTransaction: vi.fn(() => new Promise<never>(() => {})),
          getAddressHistory: vi.fn(),
        });

        let outcome: unknown = 'pending';
        void broadcastAndSave(artifact(), metadata).then(() => { outcome = 'resolved'; }, (caught: unknown) => { outcome = caught; });
        await vi.advanceTimersByTimeAsync(CPFP_PARENT_LOOKUP_DEADLINE_MS);

        expect(outcome).toBeInstanceOf(PreNetworkBroadcastRejectionError);
        expect(outcome).toMatchObject({ statusCode: 503, details: { reason: 'cpfp_parent_status_unavailable', parentTxid } });
        expect(readBroadcastFailureTag(outcome)).toEqual({ claimed: true, priorState: 'ready', releasedToReady: true });
        expect(mockReleaseRejectedSigningIntentBroadcast).toHaveBeenCalledWith('intent-cpfp-child', 'lease-1', expect.any(String));
        expect(broadcastTransaction).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('fails closed with a retryable 503 when the parent lookup fails', async () => {
      claimAs('cpfp');
      serveParent(new Error('electrum unavailable'));

      const error: unknown = await broadcastAndSave(artifact(), metadata).then(() => 'resolved', (caught: unknown) => caught);

      expect(error).toBeInstanceOf(PreNetworkBroadcastRejectionError);
      expect(error).toMatchObject({ statusCode: 503, details: { reason: 'cpfp_parent_status_unavailable', parentTxid } });
      expect(readBroadcastFailureTag(error)).toEqual({ claimed: true, priorState: 'ready', releasedToReady: true });
      expect(broadcastTransaction).not.toHaveBeenCalled();
    });

    it('broadcasts a CPFP child whose parent is still in the mempool', async () => {
      claimAs('cpfp');
      serveParent([{ tx_hash: parentTxid, height: 0 }]);

      await expect(broadcastAndSave(artifact(), metadata)).resolves.toMatchObject({ broadcasted: true });
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);
    });

    it('accepts a retried CPFP child already mined beside its parent instead of refusing it', async () => {
      // The first attempt reached the node but its response was lost; child and parent then confirmed together.
      const childTxid = bitcoin.Transaction.fromHex(rawTx).getId();
      mockClaimSigningIntentBroadcast.mockResolvedValueOnce({
        status: 'claimed', leaseToken: 'lease-1', priorState: 'resumed', source: 'cpfp',
      });
      const served = new Map([[childTxid, { hex: rawTx }], [parentTxid, { hex: parent.toHex() }]]);
      (getNodeClient as Mock).mockResolvedValueOnce({
        getTransaction: vi.fn(async (txid: string) => served.get(txid) ?? null),
        getAddressHistory: vi.fn().mockResolvedValue([
          { tx_hash: parentTxid, height: 850_000 }, { tx_hash: childTxid, height: 850_000 },
        ]),
      });

      const result = await broadcastAndSave({ ...artifact(), txid: childTxid }, metadata);

      expect(result).toMatchObject({ txid: childTxid, broadcasted: true });
      expect(broadcastTransaction).not.toHaveBeenCalled();
      expect(mockReleaseRejectedSigningIntentBroadcast).not.toHaveBeenCalled();
      expect(mockMarkSigningIntentBroadcastAccepted).toHaveBeenCalledWith('intent-cpfp-child', 'lease-1');
    });

    it('still refuses a retried CPFP child the node does not know once its parent is mined', async () => {
      mockClaimSigningIntentBroadcast.mockResolvedValueOnce({
        status: 'claimed', leaseToken: 'lease-1', priorState: 'stalled', source: 'cpfp',
      });
      const client = {
        getTransaction: vi.fn(async (txid: string) => (txid === parentTxid ? { hex: parent.toHex() } : null)),
        getAddressHistory: vi.fn().mockResolvedValue([{ tx_hash: parentTxid, height: 850_000 }]),
      };
      // One client for the child lookup, one for the parent lookup.
      (getNodeClient as Mock).mockResolvedValueOnce(client).mockResolvedValueOnce(client);

      await expect(broadcastAndSave(artifact(), metadata)).rejects.toMatchObject({
        statusCode: 409, details: { reason: 'cpfp_parent_confirmed', parentTxid },
      });
      expect(broadcastTransaction).not.toHaveBeenCalled();
      expect(mockMarkSigningIntentBroadcastAccepted).not.toHaveBeenCalled();
    });

    it('does not look the parent up for a non-CPFP intent or an idempotent replay', async () => {
      claimAs('standard');
      await expect(broadcastAndSave(artifact(), metadata)).resolves.toMatchObject({ broadcasted: true });
      mockClaimSigningIntentBroadcast.mockResolvedValueOnce({ status: 'complete' });
      await expect(broadcastAndSave(artifact(), metadata)).resolves.toMatchObject({ persistenceStatus: 'complete' });

      expect(getNodeClient).not.toHaveBeenCalled();
    });
  });
};
