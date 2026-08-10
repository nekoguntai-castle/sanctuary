import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { testnetAddresses } from '../../../fixtures/bitcoin';

const { mockElectrumClient, mockFromBase58 } = vi.hoisted(() => ({
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
  });

  it('skips bip32Derivation update when derived pubkey is missing', async () => {
    const walletId = 'wallet-branch-309';
    const originalTxid = 'f'.repeat(64);
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
      descriptor: null,
      fingerprint: 'aabbccdd',
      devices: [{ device: { id: 'device-1', fingerprint: 'aabbccdd', xpub: 'tpubD6NzVbkrYhZ4WcM8D9vLhM1fCPfQYV9xw4k3vQbH7EUmU5h7svP9m6Xz6q1k2Qxk4j3vWq6W9M2c7Q1t7x6V8z2bQ8h8J9M4P5n6R7a8B9C' } }],
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
          vout: [{ value: 0.001, scriptPubKey: { hex: spendScriptHex, address: spendAddress } }],
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

    const result = await createRBFTransaction(originalTxid, 50, walletId, 'testnet3');

    expect(result.psbt).toBeDefined();
    expect(result.inputPaths).toEqual(["m/84'/1'/0'/0/0"]);
    expect(mockFromBase58).toHaveBeenCalled();
    expect(fakeNode.derive).toHaveBeenCalled();
  });
});
