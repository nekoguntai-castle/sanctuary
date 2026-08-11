import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { testnetAddresses } from '../../../fixtures/bitcoin';

const rawPrevoutHex = (scriptPubKey: string): string => {
  const transaction = new bitcoin.Transaction();
  transaction.version = 2;
  transaction.addInput(Buffer.alloc(32), 0xffffffff);
  transaction.addOutput(Buffer.from(scriptPubKey, 'hex'), 100_000n);
  return transaction.toHex();
};

const { mockBindPsbtAccount, mockElectrumClient, mockFromBase58 } = vi.hoisted(() => ({
  mockBindPsbtAccount: vi.fn(),
  mockElectrumClient: {
    getTransaction: vi.fn(),
  },
  mockFromBase58: vi.fn(),
}));

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../../src/services/bitcoin/psbtAccountBinding', () => ({
  bindPsbtAccount: mockBindPsbtAccount,
}));

vi.mock('../../../../src/services/wallet/canonicalAddressValidation', () => ({
  assertCanonicalAddressesMatchWallet: vi.fn(),
}));

vi.mock('bip32', async () => {
  const actual = await vi.importActual<typeof import('bip32')>('bip32');

  return {
    ...actual,
    BIP32Factory: vi.fn(() => ({
      fromBase58: mockFromBase58,
    })),
  };
});

import { createRBFTransaction, RBF_SEQUENCE } from '../../../../src/services/bitcoin/advancedTx';

describe('advancedTx bip32 derivation branch coverage', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();

    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
      key: 'dustThreshold',
      value: '546',
    });
    mockBindPsbtAccount.mockRejectedValue(
      new Error('PSBT account binding failed: input signer origin is missing'),
    );
  });

  it('rejects the PSBT when a derived input pubkey is missing', async () => {
    const walletId = 'wallet-branch-309';
    const originalTxid = 'f'.repeat(64);
    const testnetTpub =
      'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M';
    const spendAddress = testnetAddresses.nativeSegwit[0];
    const changeAddress = testnetAddresses.nativeSegwit[1];

    const spendScriptHex = Buffer.from(bitcoin.address
      .toOutputScript(spendAddress, bitcoin.networks.testnet))
      .toString('hex');

    const inputHash = Buffer.from('33'.repeat(32), 'hex');
    const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

    const tx = new bitcoin.Transaction();
    tx.version = 2;
    tx.addInput(inputHash, 0, RBF_SEQUENCE);
    tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(42_000));
    tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(53_000));

    const txHex = tx.toHex();

    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      name: 'Branch Wallet',
      type: 'single_sig',
      network: 'testnet3',
      scriptType: 'native_segwit',
      descriptor: `wpkh([aabbccdd/84h/1h/0h]${testnetTpub}/0/*)`,
      changeDescriptor: `wpkh([aabbccdd/84h/1h/0h]${testnetTpub}/1/*)`,
      canonicalPolicyId: 'bip84-single-sig',
      canonicalPolicyVersion: 1,
      fingerprint: 'aabbccdd',
      devices: [{
        signerBindingVersion: 1,
        signerIndex: 0,
        signerFingerprint: 'aabbccdd',
        signerXpub: testnetTpub,
        signerDerivationPath: "m/84'/1'/0'",
        deviceAccountId: 'account-1',
        deviceId: 'device-1',
        device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: testnetTpub },
      }],
    });

    mockPrismaClient.address.findMany
      .mockResolvedValueOnce([
        { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
        { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
      ])
      .mockResolvedValueOnce([{ address: changeAddress }]);

    mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
      if (txid === originalTxid) {
        return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      }

      if (txid === inputTxid) {
        return {
          txid: inputTxid,
          hex: rawPrevoutHex(spendScriptHex),
          vin: [],
          vout: [{
            value: 0.001,
            n: 0,
            scriptPubKey: { hex: spendScriptHex, address: spendAddress },
          }],
        } as any;
      }

      return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
    });

    const fakeNode: { derive: ReturnType<typeof vi.fn>; publicKey?: Buffer } = {
      derive: vi.fn(),
      publicKey: undefined,
    };
    fakeNode.derive.mockReturnValue(fakeNode);

    mockFromBase58.mockReturnValue(fakeNode as any);

    await expect(
      createRBFTransaction(originalTxid, 50, walletId, 'testnet3')
    ).rejects.toThrow('single-sig BIP32 derivation failed');
    expect(mockFromBase58).toHaveBeenCalled();
    expect(fakeNode.derive).toHaveBeenCalled();
    expect(mockBindPsbtAccount).not.toHaveBeenCalled();
  });
});
