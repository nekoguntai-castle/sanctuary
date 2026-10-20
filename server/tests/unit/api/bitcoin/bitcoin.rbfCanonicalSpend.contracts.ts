import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { mockPrismaClient } from '../../../mocks/prisma';
import {
  app,
  mockAdvancedTx,
  mockSigningIntent,
  request,
} from './bitcoinTestHarness';

const p2wpkh = (byte: string) => '0014' + byte.repeat(20);
const addressOf = (script: string) => bitcoin.address.fromOutputScript(Buffer.from(script, 'hex'), bitcoin.networks.testnet);

const EXTERNAL_A = p2wpkh('a1');
const EXTERNAL_B = p2wpkh('b2');
const OWN_RECEIVE = p2wpkh('c3');
const OWN_CHANGE = p2wpkh('d4');

const snapshotWith = (outputs: Array<[string, number]>) => ({
  network: 'testnet4',
  transaction: {
    inputs: [{
      txid: '1'.repeat(64),
      vout: 0,
      prevout: { amountSats: '200000', scriptPubKeyHex: OWN_CHANGE, role: 'wallet' },
    }],
    outputs: outputs.map(([scriptPubKeyHex, amount]) => ({ scriptPubKeyHex, amountSats: String(amount) })),
  },
});

/**
 * The RBF route reports the canonical spend of the replacement intent it mints
 * (rbf-draft--multi-recipient-amount-recipient-mismatch): the broadcast route
 * checks the client's amount against the sum of all external outputs and its
 * recipient against the first external output, so the draft must carry those.
 */
export const registerBitcoinRbfCanonicalSpendRouteTests = () => {
  describe('POST /bitcoin/transaction/:txid/rbf canonical spend', () => {
    const bump = async (outputs: Array<[string, number]>) => {
      mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1', name: 'Test Wallet', network: 'testnet4' });
      mockPrismaClient.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
      mockPrismaClient.address.findMany.mockResolvedValue(
        [OWN_RECEIVE, OWN_CHANGE].map(script => ({ address: addressOf(script) })),
      );
      mockAdvancedTx.createRBFTransaction.mockResolvedValue({
        psbt: { toBase64: () => 'base64psbt' },
        fee: 6000,
        feeRate: 24,
        feeDelta: 1000,
        inputs: [],
        outputs: [],
        inputPaths: [],
      });
      const snapshot = snapshotWith(outputs);
      mockSigningIntent.prepareSigningIntent.mockImplementation(async (input: unknown) => ({ input, snapshot }));
      return request(app)
        .post(`/bitcoin/transaction/${'b'.repeat(64)}/rbf`)
        .send({ newFeeRate: 24, walletId: 'wallet-1' });
    };

    it('returns the summed amount and first external recipient of a multi-recipient replacement', async () => {
      const response = await bump([[EXTERNAL_A, 40000], [EXTERNAL_B, 30000], [OWN_CHANGE, 20000]]);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        recipient: addressOf(EXTERNAL_A),
        amount: 70000,
        intentId: 'intent-bitcoin-api',
        intentDigest: 'digest-bitcoin-api',
      });
      expect(mockSigningIntent.prepareSigningIntent).toHaveBeenCalledWith(expect.objectContaining({
        source: 'rbf',
        unsignedPsbtBase64: 'base64psbt',
        replacementTxid: 'b'.repeat(64),
      }));
      expect(mockSigningIntent.persistSigningIntent).toHaveBeenCalledTimes(1);
    });

    it('returns the external recipient when the wallet\'s own receive output comes first', async () => {
      const response = await bump([[OWN_RECEIVE, 10000], [EXTERNAL_A, 40000], [OWN_CHANGE, 20000]]);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ recipient: addressOf(EXTERNAL_A), amount: 40000 });
    });

    it('returns null canonical fields for a consolidation (nothing leaves the wallet)', async () => {
      const response = await bump([[OWN_RECEIVE, 150000], [OWN_CHANGE, 40000]]);

      expect(response.status).toBe(200);
      expect(response.body.recipient).toBeNull();
      expect(response.body.amount).toBeNull();
    });

    it('mints no intent when the replacement spend cannot be derived', async () => {
      const response = await bump([['6a', 1000], [EXTERNAL_A, 40000]]);

      expect(response.status).toBe(400);
      expect(mockSigningIntent.persistSigningIntent).not.toHaveBeenCalled();
    });
  });
};
