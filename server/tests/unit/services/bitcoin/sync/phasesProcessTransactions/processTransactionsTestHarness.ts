import { vi } from 'vitest';
import { mockPrismaClient } from '../../../../../mocks/prisma';
import { mockElectrumClient } from '../../../../../mocks/electrum';

vi.mock('../../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../../../src/repositories/syncIntentRepository', () => ({
  withWalletSyncMutationFence: vi.fn(async (_fence, callback) => callback(mockPrismaClient)),
  withWalletSyncMutationLock: vi.fn(async (_walletId, assertAuthority, callback) => {
    assertAuthority();
    return callback(mockPrismaClient);
  }),
}));

vi.mock('../../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
  getNotificationService: vi.fn().mockReturnValue({
    broadcastTransactionNotification: vi.fn(),
  }),
}));

vi.mock('../../../../../../src/services/notifications/notificationService', () => ({
  notifyNewTransactions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../../../src/config', () => ({
  getConfig: () => ({
    sync: { transactionBatchSize: 100 },
  }),
}));

vi.mock('../../../../../../src/services/bitcoin/utils/balanceCalculation', () => ({
  recalculateWalletBalances: vi.fn().mockResolvedValue(undefined),
  correctMisclassifiedConsolidations: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../../../../../src/services/bitcoin/addressDerivation', () => ({
  deriveAddressFromDescriptor: vi.fn().mockImplementation((descriptor, index, options) => {
    const change = options?.change ? 1 : 0;
    return {
      address: `tb1q_test_${change}_${index}`,
      derivationPath: `m/84'/0'/0'/${change}/${index}`,
      publicKey: Buffer.from('02' + '00'.repeat(32), 'hex'),
    };
  }),
}));

vi.mock('../../../../../../src/services/bitcoin/utils/blockHeight', () => ({
  getBlockTimestamp: vi.fn().mockResolvedValue(new Date('2024-01-15T12:00:00Z')),
}));

// Classification contract suites isolate downstream behavior. Raw-byte
// authentication has dedicated real-transaction tests; preserve the structured
// fixtures here by making this boundary copy the mocked client response.
vi.mock('../../../../../../src/services/bitcoin/sync/evidenceAuthentication', () => {
  const fetchAuthenticatedTransactions = vi.fn(async (ctx, txids) => {
    const accepted = new Set();
    let results;
    try {
      results = await ctx.client.getTransactionsBatch(txids, false);
    } catch {
      results = new Map();
      for (const txid of txids) {
        try {
          results.set(txid, await ctx.client.getTransaction(txid, false));
        } catch { /* exercised by retry-rotation contracts */ }
      }
    }
    for (const [txid, details] of results) {
      if (!details) continue;
      ctx.txDetailsCache.set(txid, details);
      accepted.add(txid);
      // Legacy classification contracts use structured address fixtures. The
      // dedicated evidence suite covers canonical script ownership.
    }
    return accepted;
  });
  return {
    fetchAuthenticatedTransactions,
    fetchAuthenticatedOutpoints: vi.fn(async (ctx, requests) => {
      await fetchAuthenticatedTransactions(ctx, [...requests.keys()]);
      for (const [txid, vouts] of requests) {
        for (const vout of vouts) {
          const output = ctx.txDetailsCache.get(txid)?.vout?.[vout];
          const scriptHex = output?.scriptHex ?? output?.scriptPubKey?.hex;
          if (!output || !scriptHex || !/^(?:[0-9a-fA-F]{2})+$/.test(scriptHex)) continue;
          ctx.authenticatedOutpointEvidence.set(`${txid}:${vout}`, {
            txid,
            vout,
            valueSats: BigInt(Math.round(output.value * 100_000_000)),
            scriptHex: scriptHex.toLowerCase(),
          });
        }
      }
    }),
    releaseAuthenticatedTransactionDetails: vi.fn((ctx) => ctx.txDetailsCache.clear()),
  };
});
