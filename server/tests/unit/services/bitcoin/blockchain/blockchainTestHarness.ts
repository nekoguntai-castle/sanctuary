import { beforeAll, beforeEach, vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import {
  mockElectrumClient,
  resetElectrumMocks,
} from '../../../../mocks/electrum';

const { mockAssertWalletHardwareCapabilityById } = vi.hoisted(() => ({
  mockAssertWalletHardwareCapabilityById: vi.fn(),
}));
const legacyReceiveEvidence = vi.hoisted(() => ({
  transactions: new Map<string, any>(),
}));
export { mockAssertWalletHardwareCapabilityById };

vi.mock('../../../../../src/services/hardwareWalletCapabilities', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../../src/services/hardwareWalletCapabilities')>(),
  assertWalletHardwareCapabilityById: mockAssertWalletHardwareCapabilityById,
}));

vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../../../src/services/wallet/canonicalAddressValidation', () => ({
  assertCanonicalAddressesMatchWallet: vi.fn((_wallet, addresses) => {
    const bitcoin = require('bitcoinjs-lib');
    for (const address of addresses) {
      if (address.scriptPubKey) continue;
      try {
        address.scriptPubKey = Buffer.from(bitcoin.address.toOutputScript(
          address.address,
          bitcoin.networks.testnet,
        )).toString('hex');
      } catch {
        address.scriptPubKey = `0014${'00'.repeat(20)}`;
      }
    }
  }),
}));

vi.mock('../../../../../src/services/bitcoin/blockchain/receiveEvidenceAuthentication', () => ({
  authenticateTransactionDetails: vi.fn((expectedTxid, candidate) => {
    if (!candidate) throw new Error('missing transaction');
    const bitcoin = require('bitcoinjs-lib');
    const normalizeScript = (scriptPubKey: any) => {
      const address = scriptPubKey?.address || scriptPubKey?.addresses?.[0];
      if (!address) return scriptPubKey;
      try {
        return {
          ...scriptPubKey,
          hex: Buffer.from(
            bitcoin.address.toOutputScript(address, bitcoin.networks.testnet),
          ).toString('hex'),
        };
      } catch {
        return scriptPubKey;
      }
    };
    const normalized = {
      ...candidate,
      txid: expectedTxid,
      hex: expectedTxid,
      vin: (candidate.vin || []).map((input: any) => ({
        ...input,
        ...(input.prevout ? {
          prevout: {
            ...input.prevout,
            scriptPubKey: normalizeScript(input.prevout.scriptPubKey),
          },
        } : {}),
      })),
      vout: (candidate.vout || []).map((output: any, n: number) => ({
        ...output,
        n,
        scriptPubKey: normalizeScript(output.scriptPubKey),
      })),
    };
    legacyReceiveEvidence.transactions.set(expectedTxid, normalized);
    return normalized;
  }),
}));

vi.mock('../../../../../src/services/bitcoin/sync/evidenceAuthentication', () => ({
  authenticateHistoryResults: vi.fn(),
  fetchAuthenticatedTransactions: vi.fn(async (ctx, txids) => {
    const accepted = new Set<string>();
    let results: Map<string, any>;
    try {
      results = await ctx.client.getTransactionsBatch(txids, false);
    } catch {
      results = new Map();
      for (const txid of txids) {
        try {
          const details = await ctx.client.getTransaction(txid, false);
          if (details) results.set(txid, details);
        } catch { /* legacy fallback-error contracts */ }
      }
    }
    for (const txid of txids) {
      const details = results.get(txid)
        ?? await ctx.client.getTransaction(txid, false).catch(() => undefined);
      if (!details) continue;
      ctx.txDetailsCache.set(txid, details);
      legacyReceiveEvidence.transactions.set(txid, details);
      accepted.add(txid);
    }
    return accepted;
  }),
}));

vi.mock('../../../../../src/services/bitcoin/rawTransactionEvidence', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../../src/services/bitcoin/rawTransactionEvidence')>();
  return {
    ...actual,
    authenticateRawTransactionOutput: vi.fn((input: any) => {
      const output = legacyReceiveEvidence.transactions.get(input.expectedTxid)?.vout?.[input.vout];
      if (!output) throw new actual.RawTransactionEvidenceError('missing_output');
      const valueSats = BigInt(Math.round(output.value * 100_000_000));
      if (valueSats !== input.expectedValueSats) {
        throw new actual.RawTransactionEvidenceError('amount_mismatch');
      }
      return { valueSats, scriptPubKeyHex: input.expectedScriptPubKeyHex };
    }),
  };
});

// Spread the real module: the sync context derives ownership scripts with
// addressToOutputScript, and a hand-listed partial mock silently returns
// undefined for anything it forgot, which surfaces as unrelated evidence
// rejections rather than an import error.
vi.mock('../../../../../src/services/bitcoin/utils', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../../../src/services/bitcoin/utils')>();
  return {
    ...actual,
    validateAddress: vi.fn().mockReturnValue({ valid: true }),
    parseTransaction: vi.fn(),
    getNetwork: vi.fn().mockReturnValue(require('bitcoinjs-lib').networks.testnet),
    // The sync context derives each address's ownership script here. Several
    // long-standing fixtures below use placeholder addresses ('tb1test',
    // 'tb1qtest') that no network can decode, and production correctly refuses
    // to invent an anchor for those. Give them one stable synthetic script so
    // suites whose subject is RBF and UTXO reconciliation keep testing that,
    // rather than address decoding.
    addressToOutputScript: vi.fn((address: string, network?: Parameters<typeof actual.addressToOutputScript>[1]) => {
      try {
        return actual.addressToOutputScript(address, network);
      } catch {
        return Buffer.from(`0014${'00'.repeat(20)}`, 'hex');
      }
    }),
  };
});

vi.mock('../../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
  getNotificationService: vi.fn().mockReturnValue({
    broadcastTransactionNotification: vi.fn(),
  }),
}));

vi.mock('../../../../../src/services/notifications/notificationService', () => ({
  notifyNewTransactions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../../src/services/bitcoin/addressDerivation', () => ({
  deriveCanonicalAddress: vi.fn().mockImplementation((_descriptors, coordinate) => ({
    address: `tb1q_test_${coordinate.branch}_${coordinate.index}`,
    derivationPath: `m/84'/0'/0'/${coordinate.branch}/${coordinate.index}`,
    scriptPubKey: `0014${'00'.repeat(20)}`,
    branch: coordinate.branch,
    index: coordinate.index,
    signerOrigins: [],
  })),
  deriveAddressFromDescriptor: vi.fn().mockImplementation((descriptor, index, options) => {
    const change = options?.change ? 1 : 0;
    return {
      address: `tb1q_test_${change}_${index}`,
      derivationPath: `m/84'/0'/0'/${change}/${index}`,
      publicKey: Buffer.from('02' + '00'.repeat(32), 'hex'),
    };
  }),
}));

type BlockchainServiceModule = typeof import('../../../../../src/services/bitcoin/blockchain');

let blockchainService: BlockchainServiceModule;

export function setupBlockchainServiceTestHooks(): void {
  beforeAll(async () => {
    blockchainService = await import('../../../../../src/services/bitcoin/blockchain');
  });

  beforeEach(() => {
    legacyReceiveEvidence.transactions.clear();
    resetPrismaMocks();
    resetElectrumMocks();
    mockAssertWalletHardwareCapabilityById.mockResolvedValue(undefined);
  });
}

export function getBlockchainService(): BlockchainServiceModule {
  return blockchainService;
}

interface LockedBranchSummary {
  maxIndex: number | null;
  unusedTail: number;
}

/**
 * Model the two SQL reads performed by canonical batch allocation: the wallet
 * row lock (including its subscription network) and compact branch summary.
 */
export function mockLockedCanonicalBranchSummary(options: {
  walletId: string;
  receive: LockedBranchSummary;
  change: LockedBranchSummary;
}): void {
  mockPrismaClient.$queryRaw.mockReset();
  mockPrismaClient.$queryRaw
    .mockResolvedValueOnce([{ id: options.walletId, network: 'mainnet' }])
    .mockResolvedValueOnce([
      {
        branch: 0,
        maxIndex: options.receive.maxIndex,
        unusedTail: BigInt(options.receive.unusedTail),
      },
      {
        branch: 1,
        maxIndex: options.change.maxIndex,
        unusedTail: BigInt(options.change.unusedTail),
      },
    ]);
}
