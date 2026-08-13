import { vi, Mock } from 'vitest';
/**
 * Transaction Service Tests
 *
 * Tests for UTXO selection, fee calculation, and transaction creation.
 * These are CRITICAL tests for a Bitcoin wallet.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { sampleUtxos, sampleWallets, testnetAddresses, multisigKeyInfo } from '../../../fixtures/bitcoin';
import * as bitcoin from 'bitcoinjs-lib';

// Hoist mock variables for use in vi.mock() factories
const {
  mockParseDescriptor,
  mockNotifyNewTransactions,
  mockEmitTransactionSent,
  mockEmitTransactionReceived,
  mockSelectUtxosExact,
  mockPrepareChangeOutputs,
  mockResolveWalletSigningInfo,
} = vi.hoisted(() => ({
  mockParseDescriptor: vi.fn(),
  mockNotifyNewTransactions: vi.fn(),
  mockEmitTransactionSent: vi.fn(),
  mockEmitTransactionReceived: vi.fn(),
  mockSelectUtxosExact: vi.fn(),
  mockPrepareChangeOutputs: vi.fn(),
  mockResolveWalletSigningInfo: vi.fn(),
}));

// Mock the Prisma client before importing the service
vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
  withTransaction: (fn: (tx: any) => Promise<any>) => mockPrismaClient.$transaction(fn),
}));

// Mock the nodeClient - getTransaction returns raw hex string when verbose=false
vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue({
    getTransaction: vi.fn().mockResolvedValue('0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000'),
    broadcastTransaction: vi.fn().mockResolvedValue('mock-txid'),
    getBlockHeight: vi.fn().mockResolvedValue(800000),
  }),
}));

// Mock the electrum client
vi.mock('../../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    getTransaction: vi.fn().mockResolvedValue(null),
  }),
}));

// Mock blockchain service
vi.mock('../../../../src/services/bitcoin/blockchain', () => ({
  broadcastTransaction: vi.fn().mockResolvedValue({ txid: 'mock-txid', broadcasted: true }),
  recalculateWalletBalances: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/services/eventService', () => ({
  eventService: {
    emitTransactionSent: mockEmitTransactionSent,
    emitTransactionReceived: mockEmitTransactionReceived,
  },
}));

vi.mock('../../../../src/services/notifications/notificationService', () => ({
  notifyNewTransactions: mockNotifyNewTransactions,
}));

// Mock address derivation - supports both single-sig and multisig
vi.mock('../../../../src/services/bitcoin/addressDerivation', () => ({
  parseDescriptor: mockParseDescriptor,
  convertToStandardXpub: vi.fn().mockImplementation((xpub: string) => {
    // Convert tpub to standard format (they're already standard in our test fixtures)
    return xpub;
  }),
}));

vi.mock('../../../../src/services/bitcoin/utxoSelection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/services/bitcoin/utxoSelection')>()),
  selectUTXOsExact: mockSelectUtxosExact,
}));

vi.mock('../../../../src/services/bitcoin/transactions/outputBuilder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/services/bitcoin/transactions/outputBuilder')>()),
  prepareChangeOutputs: mockPrepareChangeOutputs,
}));

vi.mock('../../../../src/services/bitcoin/transactions/psbtConstruction', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/services/bitcoin/transactions/psbtConstruction')>()),
  resolveWalletSigningInfo: mockResolveWalletSigningInfo,
}));

// Now import the service after mocks are set up

import {
  selectUTXOs,
  estimateTransaction,
  UTXOSelectionStrategy,
} from '../../../../src/services/bitcoin/transactionService';
import { estimateTransactionSize, calculateFee } from '../../../../src/services/bitcoin/utils';

describe('Transaction Service — UTXO & Fees', () => {
  beforeEach(() => {
    resetPrismaMocks();
    mockNotifyNewTransactions.mockReset();
    mockNotifyNewTransactions.mockResolvedValue(undefined);
    mockEmitTransactionSent.mockReset();
    mockEmitTransactionReceived.mockReset();
    mockSelectUtxosExact.mockReset();
    mockPrepareChangeOutputs.mockReset();
    mockResolveWalletSigningInfo.mockReset();
    mockResolveWalletSigningInfo.mockReturnValue({
      isMultisig: false,
      scriptType: 'native_segwit',
    });
    mockPrepareChangeOutputs.mockResolvedValue([{
      address: testnetAddresses.nativeSegwit[1],
      scriptPubKey: Buffer.from(`0014${'44'.repeat(20)}`, 'hex'),
    }]);
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      ...sampleWallets.singleSigNativeSegwit,
      network: 'testnet3',
      devices: [],
    });
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
  });

  describe('selectUTXOs', () => {
    const walletId = 'test-wallet-id';
    const testUtxos = [
      { ...sampleUtxos[0], walletId },
      { ...sampleUtxos[1], walletId },
      { ...sampleUtxos[2], walletId },
    ];

    beforeEach(() => {
      // Mock UTXOs for selection
      mockPrismaClient.uTXO.findMany.mockResolvedValue(testUtxos);
    });

    it('should select UTXOs to cover target amount with largest-first strategy', async () => {
      const targetAmount = 50000; // 0.0005 BTC
      const feeRate = 10;

      const result = await selectUTXOs(
        walletId,
        targetAmount,
        feeRate,
        UTXOSelectionStrategy.LARGEST_FIRST
      );

      expect(result.utxos.length).toBeGreaterThan(0);
      expect(result.totalAmount).toBeGreaterThanOrEqual(targetAmount);
      expect(result.estimatedFee).toBeGreaterThan(0);
      expect(result.changeAmount).toEqual(
        result.totalAmount - targetAmount - result.estimatedFee
      );
    });

    it('should select UTXOs with smallest-first strategy', async () => {
      // Reorder for smallest-first
      mockPrismaClient.uTXO.findMany.mockResolvedValue([...testUtxos].reverse());

      const targetAmount = 30000;
      const feeRate = 5;

      const result = await selectUTXOs(
        walletId,
        targetAmount,
        feeRate,
        UTXOSelectionStrategy.SMALLEST_FIRST
      );

      expect(result.utxos.length).toBeGreaterThan(0);
      expect(result.totalAmount).toBeGreaterThanOrEqual(targetAmount + result.estimatedFee);
    });

    it('should throw error when insufficient funds', async () => {
      const targetAmount = 10000000000; // 100 BTC - way more than available
      const feeRate = 10;

      await expect(
        selectUTXOs(walletId, targetAmount, feeRate)
      ).rejects.toThrow('Insufficient funds');
    });

    it('should throw error when no spendable UTXOs available', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      await expect(
        selectUTXOs(walletId, 10000, 10)
      ).rejects.toThrow('No spendable UTXOs available');
    });

    it('should exclude frozen UTXOs from selection', async () => {
      // Mock returns only unfrozen UTXOs (frozen ones filtered by Prisma query)
      const unfrozenUtxos = [testUtxos[1], testUtxos[2]];
      mockPrismaClient.uTXO.findMany.mockResolvedValue(unfrozenUtxos);

      const result = await selectUTXOs(walletId, 30000, 5);

      // Should only get unfrozen UTXOs (2 in this case)
      expect(result.utxos.length).toBeLessThanOrEqual(2);
      expect(result.utxos.length).toBeGreaterThan(0);
    });

    it('should respect confirmation threshold', async () => {
      // All UTXOs have confirmations >= 1 (the threshold)
      const result = await selectUTXOs(walletId, 30000, 5);
      expect(result.utxos.length).toBeGreaterThan(0);
    });

    it('should filter by selected UTXO IDs when provided', async () => {
      const selectedId = `${testUtxos[1].txid}:${testUtxos[1].vout}`;

      // Mock findMany to return only the selected UTXO
      mockPrismaClient.uTXO.findMany.mockResolvedValue([testUtxos[1]]);

      const result = await selectUTXOs(walletId, 30000, 5, UTXOSelectionStrategy.LARGEST_FIRST, [
        selectedId,
      ]);

      expect(result.utxos.length).toBe(1);
      expect(`${result.utxos[0].txid}:${result.utxos[0].vout}`).toBe(selectedId);
    });
  });

  describe('Fee Calculation', () => {
    it('should calculate correct fee for native segwit transaction', () => {
      const inputCount = 2;
      const outputCount = 2;
      const feeRate = 10;

      const size = estimateTransactionSize(inputCount, outputCount, 'native_segwit');
      const fee = calculateFee(size, feeRate);

      // Native segwit: ~68 vBytes per input, ~34 vBytes per output, ~10 vBytes overhead
      // 2 inputs = 136, 2 outputs = 68, overhead = 10, total ~ 214 vBytes
      expect(size).toBeGreaterThan(100);
      expect(size).toBeLessThan(400);
      expect(fee).toBe(Math.ceil(size * feeRate));
    });

    it('should calculate higher fee for legacy transaction', () => {
      const inputCount = 2;
      const outputCount = 2;
      const feeRate = 10;

      const legacySize = estimateTransactionSize(inputCount, outputCount, 'legacy');
      const segwitSize = estimateTransactionSize(inputCount, outputCount, 'native_segwit');

      // Legacy should be larger than native segwit
      expect(legacySize).toBeGreaterThan(segwitSize);
    });

    it('should calculate smallest fee for taproot transaction', () => {
      const inputCount = 2;
      const outputCount = 2;

      const taprootSize = estimateTransactionSize(inputCount, outputCount, 'taproot');
      const segwitSize = estimateTransactionSize(inputCount, outputCount, 'native_segwit');

      // Taproot should be smaller than native segwit
      expect(taprootSize).toBeLessThanOrEqual(segwitSize);
    });

    it('should scale linearly with more inputs', () => {
      const feeRate = 10;

      const size1 = estimateTransactionSize(1, 2, 'native_segwit');
      const size2 = estimateTransactionSize(2, 2, 'native_segwit');
      const size3 = estimateTransactionSize(3, 2, 'native_segwit');

      // Each additional input adds approximately the same amount
      const diff1to2 = size2 - size1;
      const diff2to3 = size3 - size2;

      // Differences should be similar (within 10%)
      expect(Math.abs(diff1to2 - diff2to3)).toBeLessThan(diff1to2 * 0.1);
    });
  });

  describe('estimateTransaction', () => {
    const walletId = 'test-wallet-id';
    const recipient = testnetAddresses.nativeSegwit[0];

    beforeEach(() => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[2], walletId },
      ]);
    });

    it('should return fee estimate for valid transaction', async () => {
      mockSelectUtxosExact.mockResolvedValue({
        utxos: [{ ...sampleUtxos[2], walletId }],
        totalAmount: 200_000,
        estimatedFee: 1_410,
        changeAmount: 148_590,
      });
      const result = await estimateTransaction(walletId, recipient, 50000, 10);

      expect(result.sufficient).toBe(true);
      expect(result.fee).toBeGreaterThan(0);
      expect(result.totalCost).toBe(50000 + result.fee);
      expect(result.inputCount).toBeGreaterThan(0);
      expect(result.outputCount).toBeGreaterThan(0);
    });

    it('should return insufficient when not enough funds', async () => {
      mockSelectUtxosExact.mockRejectedValue(
        new Error('Insufficient funds. Need 10001410 sats, have 200000 sats'),
      );
      const result = await estimateTransaction(walletId, recipient, 10000000, 10);

      expect(result.sufficient).toBe(false);
      expect(result.error).toContain('Insufficient funds');
    });

    it('should show correct output count based on change', async () => {
      // Small amount = change output
      mockSelectUtxosExact.mockResolvedValueOnce({
        utxos: [{ ...sampleUtxos[2], walletId }],
        totalAmount: 200_000,
        estimatedFee: 705,
        changeAmount: 189_295,
      });
      const resultWithChange = await estimateTransaction(walletId, recipient, 10000, 5);
      expect(resultWithChange.outputCount).toBe(2);

      // Near-full amount = no change (would be dust)
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[0], walletId, amount: BigInt(10700) }, // Just enough for amount + fee
      ]);
      mockSelectUtxosExact.mockResolvedValueOnce({
        utxos: [{ ...sampleUtxos[0], walletId, amount: 10_700n }],
        totalAmount: 10_700,
        estimatedFee: 700,
        changeAmount: 0,
      });
      const resultNoChange = await estimateTransaction(walletId, recipient, 10000, 5);
      expect(resultNoChange.changeAmount).toBeLessThan(546);
    });
  });

  describe('UTXO Selection Edge Cases', () => {
    const walletId = 'utxo-edge-case-wallet';

    it('should handle UTXOs with exact amount + fee (no change)', async () => {
      const targetAmount = 50000;
      const feeRate = 10;
      // Estimated fee for 1-in-2-out ~ 141 vBytes * 10 = 1410 sats
      // So UTXO of 51410 would leave no change

      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(51500), // Slightly more than target + fee
        },
      ]);

      const result = await selectUTXOs(walletId, targetAmount, feeRate);

      // Change should be minimal (possibly below dust threshold)
      expect(result.totalAmount).toBe(51500);
    });

    it('should handle single UTXO that barely covers target', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        {
          ...sampleUtxos[0],
          walletId,
          amount: BigInt(60000), // Just enough
        },
      ]);

      const result = await selectUTXOs(walletId, 55000, 10);
      expect(result.utxos.length).toBe(1);
    });

    it('should select multiple small UTXOs when no single large one exists', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[0], walletId, amount: BigInt(10000) },
        { ...sampleUtxos[1], walletId, amount: BigInt(15000) },
        { ...sampleUtxos[2], walletId, amount: BigInt(20000) },
        {
          id: 'utxo-4',
          txid: 'txid4'.repeat(8),
          vout: 0,
          walletId,
          amount: BigInt(25000),
          spent: false,
          frozen: false,
          confirmations: 6,
          address: 'addr4',
          scriptPubKey: '0014' + 'd'.repeat(40),
        },
      ]);

      const result = await selectUTXOs(walletId, 50000, 5);

      expect(result.utxos.length).toBeGreaterThan(1);
      expect(result.totalAmount).toBeGreaterThanOrEqual(50000);
    });

    it('should prefer fewer inputs to minimize fees', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[0], walletId, amount: BigInt(100000) }, // Large - should prefer
        { ...sampleUtxos[1], walletId, amount: BigInt(30000) },
        { ...sampleUtxos[2], walletId, amount: BigInt(30000) },
      ]);

      const result = await selectUTXOs(
        walletId,
        50000,
        10,
        UTXOSelectionStrategy.LARGEST_FIRST
      );

      // Should use the single large UTXO instead of multiple small ones
      expect(result.utxos.length).toBe(1);
      expect(result.utxos[0].amount).toBe(BigInt(100000));
    });
  });

  describe('estimateTransaction Error Cases', () => {
    const walletId = 'estimate-error-wallet';

    it('should fail closed for an invalid recipient script', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        { ...sampleUtxos[2], walletId },
      ]);

      const result = await estimateTransaction(
        walletId,
        'invalid-address',
        50000,
        10
      );

      expect(result.sufficient).toBe(false);
      expect(result.fee).toBe(0);
      expect(result.error).toMatch(/no matching script|invalid/i);
    });

    it('should handle wallet with zero UTXOs', async () => {
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);
      mockSelectUtxosExact.mockRejectedValue(new Error('No spendable UTXOs available'));

      const result = await estimateTransaction(
        walletId,
        testnetAddresses.nativeSegwit[0],
        50000,
        10
      );

      expect(result.sufficient).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle transaction to own wallet address', async () => {
      const ownAddress = testnetAddresses.nativeSegwit[0];
      const ownUtxo = { ...sampleUtxos[2], walletId, address: ownAddress };
      mockPrismaClient.uTXO.findMany.mockResolvedValue([
        ownUtxo,
      ]);
      mockSelectUtxosExact.mockResolvedValue({
        utxos: [ownUtxo],
        totalAmount: 200_000,
        estimatedFee: 1_410,
        changeAmount: 148_590,
      });

      // Sending to own address (consolidation)
      const result = await estimateTransaction(
        walletId,
        ownAddress,
        50000,
        10
      );

      expect(result.sufficient).toBe(true);
    });
  });

  describe('selectUTXOs with Explicit Selection', () => {
    const walletId = 'explicit-selection-wallet';

    it('should throw insufficient funds error when explicitly selected UTXOs are not enough', async () => {
      const smallUtxo = { ...sampleUtxos[0], walletId, amount: BigInt(5000) };
      mockPrismaClient.uTXO.findMany.mockResolvedValue([smallUtxo]);

      const selectedId = `${smallUtxo.txid}:${smallUtxo.vout}`;

      // Target amount much larger than selected UTXO
      await expect(
        selectUTXOs(walletId, 50000, 10, UTXOSelectionStrategy.LARGEST_FIRST, [selectedId])
      ).rejects.toThrow('Insufficient funds');
    });

    it('should use all explicitly selected UTXOs even if one would suffice', async () => {
      const utxo1 = { ...sampleUtxos[0], walletId, amount: BigInt(50000) };
      const utxo2 = { ...sampleUtxos[1], walletId, amount: BigInt(30000) };
      mockPrismaClient.uTXO.findMany.mockResolvedValue([utxo1, utxo2]);

      const selectedIds = [
        `${utxo1.txid}:${utxo1.vout}`,
        `${utxo2.txid}:${utxo2.vout}`,
      ];

      const result = await selectUTXOs(
        walletId,
        20000, // Small amount, either UTXO would suffice
        10,
        UTXOSelectionStrategy.LARGEST_FIRST,
        selectedIds
      );

      // Should use both UTXOs since they were explicitly selected
      expect(result.utxos.length).toBe(2);
      expect(result.totalAmount).toBe(80000);
    });
  });

});
