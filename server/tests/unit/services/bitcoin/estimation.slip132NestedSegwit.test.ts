/**
 * Nested SegWit estimation with a SLIP-132 (ypub/upub) signer xpub.
 *
 * Runs the real fee-policy, signing-info, UTXO-selection and weight code. The
 * weight estimator checks that the derived redeem script commits to the UTXO's
 * scriptPubKey, so a matching estimate is a byte-exact check of the derived key.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

vi.mock('../../../../src/models/prisma', () => ({
  default: mockPrismaClient,
}));

import { estimateTransaction } from '../../../../src/services/bitcoin/estimation';
import { convertToStandardXpub } from '../../../../src/services/bitcoin/addressDerivation/xpubConversion';
import { getNetwork } from '../../../../src/services/bitcoin/addressDerivation/utils';
import {
  VERIFIED_SINGLESIG_VECTORS,
  type VerifiedSingleSigVector,
} from '../../../fixtures/verified-address-vectors';

function vectorById(caseId: string): VerifiedSingleSigVector {
  const vector = VERIFIED_SINGLESIG_VECTORS.find(v => v.caseId === caseId);
  if (!vector) throw new Error(`missing verified vector ${caseId}`);
  return vector;
}

const VECTORS = [
  { prefix: 'ypub', vector: vectorById('ss:single-sig-nested-segwit-bip49-v1:mainnet:a0:b0:i0') },
  { prefix: 'upub', vector: vectorById('ss:single-sig-nested-segwit-bip49-v1:testnet3:a0:b0:i0') },
];

function mockWallet(v: VerifiedSingleSigVector, signerXpub: string): void {
  mockPrismaClient.wallet.findUnique.mockResolvedValue({
    id: 'w1',
    type: 'single_sig',
    scriptType: 'nested_segwit',
    network: v.network,
    devices: [{
      signerBindingVersion: 1,
      signerIndex: 0,
      deviceAccountId: 'acct-1',
      signerFingerprint: '73c5da0a',
      signerXpub,
      signerDerivationPath: v.path,
      deviceId: 'dev-1',
      device: { id: 'dev-1', fingerprint: '73c5da0a', xpub: signerXpub },
    }],
  });
}

async function estimateWith(v: VerifiedSingleSigVector, signerXpub: string, recipient: string) {
  mockWallet(v, signerXpub);
  return estimateTransaction('w1', recipient, 50_000, 5);
}

describe('nested SegWit estimation with a SLIP-132 signer xpub', () => {
  beforeEach(() => {
    resetPrismaMocks();
  });

  it.each(VECTORS)(
    'estimates a nested SegWit spend from a SLIP-132 $prefix signer exactly like its standard-version twin',
    async ({ vector: v }) => {
      expect(v.scriptType).toBe('nested_segwit');
      const network = getNetwork(v.network);
      const recipient = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 1), network }).address!;
      mockPrismaClient.uTXO.findMany.mockResolvedValue([{
        id: 'u1',
        txid: '11'.repeat(32),
        vout: 0,
        amount: 100_000n,
        scriptPubKey: v.expectedScriptPubKey,
        address: v.expectedAddress,
      }]);
      mockPrismaClient.address.findMany.mockResolvedValue([
        { address: v.expectedAddress, derivationPath: `${v.path}/0/0` },
      ]);

      const control = await estimateWith(v, convertToStandardXpub(v.xpub), recipient);
      expect(control.error).toBeUndefined();
      expect(control.sufficient).toBe(true);
      expect(control.inputCount).toBe(1);

      const actual = await estimateWith(v, v.xpub, recipient);
      expect(actual).toEqual(control);
    },
  );
});
