import { vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';

const ECPair = ECPairFactory(ecc);

const transactionServiceBroadcastMocks = vi.hoisted(() => ({
  mockParseDescriptor: vi.fn(),
  mockNotifyNewTransactions: vi.fn(),
  mockEmitTransactionSent: vi.fn(),
  mockEmitTransactionReceived: vi.fn(),
  mockMarkSigningIntentBroadcastAccepted: vi.fn(),
  mockClaimSigningIntentBroadcast: vi.fn(),
  mockMarkSigningIntentBroadcastComplete: vi.fn(),
  mockMarkSigningIntentBroadcastUnknown: vi.fn(),
  mockReleaseRejectedSigningIntentBroadcast: vi.fn(),
}));

export const mockParseDescriptor = transactionServiceBroadcastMocks.mockParseDescriptor;
export const mockNotifyNewTransactions = transactionServiceBroadcastMocks.mockNotifyNewTransactions;
export const mockEmitTransactionSent = transactionServiceBroadcastMocks.mockEmitTransactionSent;
export const mockEmitTransactionReceived = transactionServiceBroadcastMocks.mockEmitTransactionReceived;
export const mockMarkSigningIntentBroadcastAccepted =
  transactionServiceBroadcastMocks.mockMarkSigningIntentBroadcastAccepted;
export const mockClaimSigningIntentBroadcast = transactionServiceBroadcastMocks.mockClaimSigningIntentBroadcast;
export const mockMarkSigningIntentBroadcastComplete = transactionServiceBroadcastMocks.mockMarkSigningIntentBroadcastComplete;
export const mockMarkSigningIntentBroadcastUnknown = transactionServiceBroadcastMocks.mockMarkSigningIntentBroadcastUnknown;
export const mockReleaseRejectedSigningIntentBroadcast = transactionServiceBroadcastMocks.mockReleaseRejectedSigningIntentBroadcast;

vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
  withTransaction: (fn: (tx: any) => Promise<any>) => mockPrismaClient.$transaction(fn),
}));

vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue({
    getTransaction: vi.fn().mockResolvedValue('0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000'),
    broadcastTransaction: vi.fn().mockResolvedValue('mock-txid'),
    getBlockHeight: vi.fn().mockResolvedValue(800000),
  }),
}));

vi.mock('../../../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    getTransaction: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock('../../../../../src/services/bitcoin/blockchain', () => ({
  broadcastTransaction: vi.fn().mockResolvedValue({ txid: 'mock-txid', broadcasted: true }),
  DefiniteBroadcastRejectionError: class extends Error {},
  recalculateWalletBalances: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../../src/services/bitcoin/signingIntent/broadcastLifecycle', () => ({
  claimSigningIntentBroadcast: transactionServiceBroadcastMocks.mockClaimSigningIntentBroadcast,
  markSigningIntentBroadcastAccepted:
    transactionServiceBroadcastMocks.mockMarkSigningIntentBroadcastAccepted,
  markSigningIntentBroadcastComplete: transactionServiceBroadcastMocks.mockMarkSigningIntentBroadcastComplete,
  markSigningIntentBroadcastUnknown: transactionServiceBroadcastMocks.mockMarkSigningIntentBroadcastUnknown,
  releaseRejectedSigningIntentBroadcast:
    transactionServiceBroadcastMocks.mockReleaseRejectedSigningIntentBroadcast,
}));

vi.mock('../../../../../src/services/eventService', () => ({
  eventService: {
    emitTransactionSent: mockEmitTransactionSent,
    emitTransactionReceived: mockEmitTransactionReceived,
  },
}));

vi.mock('../../../../../src/services/notifications/notificationService', () => ({
  notifyNewTransactions: mockNotifyNewTransactions,
}));

vi.mock('../../../../../src/services/bitcoin/addressDerivation', () => ({
  parseDescriptor: mockParseDescriptor,
  convertToStandardXpub: vi.fn().mockImplementation((xpub: string) => xpub),
}));

export const flushPromises = async () => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};

export const createRawTxHex = (
  outputs: Array<{ address: string; value: number }>,
  network: bitcoin.Network = bitcoin.networks.testnet
) => {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.alloc(32, 0), 0, 0xffffffff, Buffer.alloc(0));
  outputs.forEach(({ address, value }) => {
    tx.addOutput(bitcoin.address.toOutputScript(address, network), BigInt(value));
  });
  return tx.toHex();
};

export const createSignedMultisigPayment = (
  destinationType: 'p2wsh' | 'p2sh-p2wsh',
  network: bitcoin.Network = bitcoin.networks.testnet
): { signedPsbtBase64: string; recipient: string; inputTxid: string } => {
  const signerA = ECPair.fromPrivateKey(Buffer.alloc(32, 1), { network });
  const signerB = ECPair.fromPrivateKey(Buffer.alloc(32, 2), { network });
  const multisig = bitcoin.payments.p2ms({
    m: 2,
    pubkeys: [Buffer.from(signerA.publicKey), Buffer.from(signerB.publicKey)],
    network,
  });
  const inputPayment = bitcoin.payments.p2wsh({ redeem: multisig, network });
  const destinationWitness = bitcoin.payments.p2wsh({ redeem: multisig, network });
  const destination = destinationType === 'p2wsh'
    ? destinationWitness
    : bitcoin.payments.p2sh({ redeem: destinationWitness, network });
  const inputHash = Buffer.alloc(32, 3);
  const psbt = new bitcoin.Psbt({ network });

  psbt.addInput({
    hash: inputHash,
    index: 0,
    witnessUtxo: { script: inputPayment.output!, value: 100_000n },
    witnessScript: multisig.output!,
    bip32Derivation: [
      {
        masterFingerprint: Buffer.alloc(4, 1),
        path: "m/48'/1'/0'/2'/0/0",
        pubkey: Buffer.from(signerA.publicKey),
      },
      {
        masterFingerprint: Buffer.alloc(4, 2),
        path: "m/48'/1'/0'/2'/0/0",
        pubkey: Buffer.from(signerB.publicKey),
      },
    ],
  });
  psbt.addOutput({ address: destination.address!, value: 90_000n });
  psbt.signInput(0, signerA);
  psbt.signInput(0, signerB);

  return {
    signedPsbtBase64: psbt.toBase64(),
    recipient: destination.address!,
    inputTxid: Buffer.from(inputHash).reverse().toString('hex'),
  };
};

export const setupTransactionServiceBroadcastMocks = () => {
  resetPrismaMocks();
  mockNotifyNewTransactions.mockReset();
  mockNotifyNewTransactions.mockResolvedValue(undefined);
  mockEmitTransactionSent.mockReset();
  mockEmitTransactionReceived.mockReset();
  transactionServiceBroadcastMocks.mockMarkSigningIntentBroadcastAccepted.mockReset();
  transactionServiceBroadcastMocks.mockMarkSigningIntentBroadcastAccepted.mockResolvedValue(true);
  transactionServiceBroadcastMocks.mockClaimSigningIntentBroadcast.mockReset();
  transactionServiceBroadcastMocks.mockClaimSigningIntentBroadcast.mockResolvedValue({
    status: 'claimed', leaseToken: 'lease-1',
  });
  transactionServiceBroadcastMocks.mockMarkSigningIntentBroadcastComplete.mockReset();
  transactionServiceBroadcastMocks.mockMarkSigningIntentBroadcastComplete.mockResolvedValue(true);
  transactionServiceBroadcastMocks.mockMarkSigningIntentBroadcastUnknown.mockReset();
  transactionServiceBroadcastMocks.mockMarkSigningIntentBroadcastUnknown.mockResolvedValue(true);
  transactionServiceBroadcastMocks.mockReleaseRejectedSigningIntentBroadcast.mockReset();
  transactionServiceBroadcastMocks.mockReleaseRejectedSigningIntentBroadcast.mockResolvedValue(true);
  // Set up default system settings
  mockPrismaClient.systemSetting.findUnique.mockImplementation((query: any) => {
    if (query.where.key === 'confirmationThreshold') {
      return Promise.resolve({ key: 'confirmationThreshold', value: '1' });
    }
    if (query.where.key === 'dustThreshold') {
      return Promise.resolve({ key: 'dustThreshold', value: '546' });
    }
    return Promise.resolve(null);
  });
  // Set up mockParseDescriptor implementation - supports both single-sig and multisig
  // Using only 2 keys for 2-of-2 multisig (both keys are valid testnet tpubs)
  mockParseDescriptor.mockImplementation((descriptor: string) => {
    // Check if it's a multisig descriptor
    if (descriptor.startsWith('wsh(sortedmulti(') || descriptor.startsWith('wsh(multi(')) {
      return {
        type: 'wsh-sortedmulti',
        quorum: 2,
        keys: [
          {
            fingerprint: 'aabbccdd',
            accountPath: "48'/1'/0'/2'",
            xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
            derivationPath: '0/*',
          },
          {
            fingerprint: 'eeff0011',
            accountPath: "48'/1'/0'/2'",
            xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
            derivationPath: '0/*',
          },
        ],
      };
    }
    if (descriptor.startsWith('sh(wsh(sortedmulti(') || descriptor.startsWith('sh(wsh(multi(')) {
      return {
        type: 'sh-wsh-sortedmulti',
        quorum: 2,
        keys: [
          {
            fingerprint: 'aabbccdd',
            accountPath: "48'/1'/0'/1'",
            xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
            derivationPath: '0/*',
          },
          {
            fingerprint: 'eeff0011',
            accountPath: "48'/1'/0'/1'",
            xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
            derivationPath: '0/*',
          },
        ],
      };
    }
    // Single-sig descriptor
    return {
      type: 'wpkh',
      xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
      fingerprint: 'aabbccdd',
      accountPath: "84'/1'/0'",
    };
  });
};
