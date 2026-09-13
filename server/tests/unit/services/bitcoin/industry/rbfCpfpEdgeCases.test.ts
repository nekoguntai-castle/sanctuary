/**
 * RBF & CPFP Industry Edge Case Tests
 *
 * Tests for common Bitcoin fee-bumping implementation problems:
 * - BIP125 replacement fee rules (total fee must increase)
 * - CPFP effective fee rate accuracy
 * - RBF with inherited signaling
 * - Fee pinning attack resistance
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import * as bitcoin from 'bitcoinjs-lib';
import {
  advancedSignableWallet,
  registerAdvancedTxTestSetup,
} from '../advancedTx/advancedTxTestHarness';
import { calculateCPFPFee } from '../../../../../src/services/bitcoin/advancedTx/cpfp';
import { RBF_SEQUENCE, MIN_RBF_FEE_BUMP } from '../../../../../src/services/bitcoin/advancedTx/shared';
import { createRBFTransaction } from '../../../../../src/services/bitcoin/advancedTx';
import * as transactionWeight from '../../../../../src/services/bitcoin/transactionWeight';
import { mockPrismaClient } from '../../../../mocks/prisma';
import { mockElectrumClient } from '../../../../mocks/electrum';
import { testnetAddresses } from '../../../../fixtures/bitcoin';

describe('RBF & CPFP Industry Edge Cases', () => {
  registerAdvancedTxTestSetup();

  // ==========================================================================
  // BIP125 REPLACEMENT FEE RULES
  // ==========================================================================
  describe('BIP125 replacement fee rules', () => {
    it('should document BIP125 Rule 3: total fee must increase', () => {
      // BIP125 Rule 3: The replacement transaction must pay an absolute
      // fee of at least the sum paid by the original transactions.
      //
      // This means if the original tx pays 1000 sats fee, the replacement
      // must pay AT LEAST 1000 sats fee, regardless of fee rate.
      //
      // Example violation:
      // Original: 200 vB, 1000 sats fee (5 sat/vB)
      // Replacement: 150 vB, 900 sats fee (6 sat/vB)
      // ^ Higher fee RATE but LOWER total fee — BIP125 rejects this!
      //
      // Current code only checks fee RATE:
      //   if (newFeeRate <= currentFeeRate) throw error
      //
      // It does NOT verify that the total fee increases.
      const originalFee = 1000;
      const originalSize = 200;
      const originalRate = originalFee / originalSize; // 5 sat/vB

      const replacementSize = 150; // Smaller replacement
      const replacementRate = 6;   // Higher rate
      const replacementFee = Math.ceil(replacementSize * replacementRate); // 900 sats

      // This replacement has higher rate but lower total fee
      expect(replacementRate).toBeGreaterThan(originalRate);
      expect(replacementFee).toBeLessThan(originalFee);
      // BIP125 would REJECT this, but current code would ACCEPT it
    });

    it('enforces BIP125 Rule 3 in createRBFTransaction: refuses a replacement whose fee falls 50 sats short of the original fee', async () => {
      // Non-regression for rbf-negative-fee-delta-desyncs-returned-fee-from-outputs:
      // createRBFTransaction must not silently accept a re-estimated fee that
      // fails to exceed the original fee, even when the requested feeRate
      // clears the "must be higher than current rate" gate.
      const walletId = 'rbf-rule3-wallet';
      const originalTxid = 'f'.repeat(64);
      const spendAddress = testnetAddresses.nativeSegwit[0];
      const changeAddress = testnetAddresses.nativeSegwit[1];
      const spendScriptHex = Buffer.from(
        bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet),
      ).toString('hex');
      const inputHash = Buffer.from('28'.repeat(32), 'hex');
      const inputTxid = Buffer.from(inputHash).reverse().toString('hex');

      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(inputHash, 0, RBF_SEQUENCE);
      tx.addOutput(bitcoin.address.toOutputScript(spendAddress, bitcoin.networks.testnet), BigInt(40_000));
      // totalInput (100_000) - 40_000 - 54_950 = oldFee 5_050
      tx.addOutput(bitcoin.address.toOutputScript(changeAddress, bitcoin.networks.testnet), BigInt(54_950));
      const txHex = tx.toHex();

      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce(advancedSignableWallet(walletId));
      mockPrismaClient.address.findMany
        .mockResolvedValueOnce([
          { address: spendAddress, derivationPath: "m/84'/1'/0'/0/0" },
          { address: changeAddress, derivationPath: "m/84'/1'/0'/1/0" },
        ])
        .mockResolvedValueOnce([{ address: changeAddress, branch: 1 }]);

      mockElectrumClient.getTransaction.mockImplementation(async (txid: string) => {
        if (txid === originalTxid) {
          return { txid: originalTxid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
        }
        if (txid === inputTxid) {
          return {
            txid: inputTxid,
            confirmations: 1,
            hex: txHex,
            vin: [],
            vout: [{
              value: 100_000 / 100_000_000,
              n: 0,
              scriptPubKey: { hex: spendScriptHex, address: spendAddress },
            }],
          } as any;
        }
        return { txid, confirmations: 0, hex: txHex, vin: [], vout: [] } as any;
      });

      // Pin the realistically re-estimated fee to 5_000 sats: exactly 50 sats
      // below oldFee (5_050), so feeDelta is exactly -50, deterministically.
      const feeForRateSpy = vi.spyOn(transactionWeight, 'feeForRate').mockReturnValue(5_000);
      try {
        await expect(
          createRBFTransaction(originalTxid, 55, walletId, 'testnet3'),
        ).rejects.toThrow('New fee must exceed the original fee by at least');
      } finally {
        feeForRateSpy.mockRestore();
      }
    });

    it('should document BIP125 Rule 4: replacement must pay for relay bandwidth', () => {
      // BIP125 Rule 4: The replacement transaction must also pay for
      // its own bandwidth at or above the rate set by the node's minimum
      // relay fee setting. Typically 1 sat/vB × replacement_size.
      //
      // This means the replacement must pay:
      //   original_fee + (replacement_size * min_relay_fee_rate)
      //
      // Current code uses MIN_RBF_FEE_BUMP = 1 (sat/vB increase),
      // which approximates this but doesn't strictly enforce the rule.
      expect(MIN_RBF_FEE_BUMP).toBe(1);

      const originalFee = 1000;
      const replacementSize = 200;
      const minRelayFeeRate = 1; // sat/vB

      const minReplacementFee = originalFee + (replacementSize * minRelayFeeRate);
      // = 1000 + 200 = 1200 sats minimum
      expect(minReplacementFee).toBe(1200);
    });

    it('should document inherited RBF signaling', () => {
      // BIP125 Rule 1: An unconfirmed transaction is replaceable if:
      // - It signals BIP125 itself (any input sequence < 0xfffffffe), OR
      // - Any of its unconfirmed ancestors signal BIP125
      //
      // This means a child of an RBF-signaled parent is ALSO replaceable,
      // even if the child itself has final sequence numbers.
      //
      // Current code (isRBFSignaled) only checks the transaction's own
      // sequence numbers, NOT its ancestors' signals.
      //
      // Impact: CPFP child transactions of RBF parents are actually
      // replaceable but won't be detected as such.
      expect(RBF_SEQUENCE).toBe(0xfffffffd);
    });
  });

  // ==========================================================================
  // CPFP FEE CALCULATION ACCURACY
  // ==========================================================================
  describe('CPFP fee calculation accuracy', () => {
    it('should calculate correct effective fee rate for package', () => {
      // Parent: 200 vB, 2 sat/vB = 400 sats fee
      // Target: 10 sat/vB effective for the package
      // Total needed: (200 + child_size) * 10 sats
      const result = calculateCPFPFee(200, 2, 113, 10);

      // Total size: 200 + 113 = 313 vB
      expect(result.totalSize).toBe(313);

      // Total fee needed: 313 * 10 = 3130 sats
      expect(result.totalFee).toBe(3130);

      // Parent fee: 200 * 2 = 400 sats
      // Child fee: 3130 - 400 = 2730 sats
      expect(result.childFee).toBe(2730);

      // Effective rate: 3130 / 313 = 10 sat/vB
      expect(result.effectiveFeeRate).toBeCloseTo(10, 1);
    });

    it('should handle parent with zero fee (stuck tx)', () => {
      // Edge case: parent has 0 fee rate (shouldn't happen but could if
      // mempool cleared and tx was somehow included at 0 fee)
      const result = calculateCPFPFee(200, 0, 113, 10);

      expect(result.totalSize).toBe(313);
      expect(result.totalFee).toBe(3130);
      // Child pays entire package fee
      expect(result.childFee).toBe(3130);
    });

    it('should handle child needing very high fee to compensate parent', () => {
      // Parent: 500 vB at 1 sat/vB = 500 sats
      // Target: 50 sat/vB effective
      // Total needed: (500 + 113) * 50 = 30,650 sats
      // Child fee: 30,650 - 500 = 30,150 sats
      // Child fee rate: 30,150 / 113 = ~266.8 sat/vB
      const result = calculateCPFPFee(500, 1, 113, 50);

      expect(result.childFee).toBe(30150);
      expect(result.childFeeRate).toBe(Math.ceil(30150 / 113)); // 267
      expect(result.effectiveFeeRate).toBeCloseTo(50, 1);
    });

    it('should handle case where parent already exceeds target rate', () => {
      // Parent: 200 vB at 20 sat/vB = 4000 sats
      // Target: 10 sat/vB (lower than parent!)
      // Total needed: 313 * 10 = 3130 sats
      // But parent already paid 4000, so child fee would be negative
      const result = calculateCPFPFee(200, 20, 113, 10);

      // childFee = 3130 - 4000 = -870 (negative!)
      expect(result.childFee).toBeLessThan(0);
      // This is a valid calculation — the parent is already overpaying
      // Caller should handle negative childFee by using minimum fee instead
    });

    it('should produce accurate effective rate for typical scenarios', () => {
      const scenarios = [
        { parentSize: 200, parentRate: 1, childSize: 113, targetRate: 5 },
        { parentSize: 250, parentRate: 2, childSize: 113, targetRate: 10 },
        { parentSize: 300, parentRate: 3, childSize: 150, targetRate: 20 },
        { parentSize: 500, parentRate: 1, childSize: 113, targetRate: 50 },
      ];

      for (const s of scenarios) {
        const result = calculateCPFPFee(s.parentSize, s.parentRate, s.childSize, s.targetRate);

        // Effective fee rate should be at or very close to target
        // (may differ slightly due to ceiling operations)
        expect(result.effectiveFeeRate).toBeCloseTo(s.targetRate, 0);

        // Total size should be sum of parent and child
        expect(result.totalSize).toBe(s.parentSize + s.childSize);

        // Child fee should be non-negative for reasonable targets
        if (s.targetRate > s.parentRate) {
          expect(result.childFee).toBeGreaterThan(0);
        }
      }
    });
  });

  // ==========================================================================
  // FEE PINNING ATTACK RESISTANCE
  // ==========================================================================
  describe('Fee pinning attack resistance', () => {
    it('should document the fee pinning attack vector', () => {
      // Fee pinning is an attack where an adversary prevents a transaction
      // from being replaced by crafting a low-fee-rate descendant that is
      // large enough to make replacement expensive.
      //
      // Attack scenario:
      // 1. Alice sends Bob 1 BTC with RBF enabled (500 sats fee)
      // 2. Bob creates a large child transaction spending Alice's output
      //    (e.g., 50,000 vB at 1 sat/vB = 50,000 sats fee)
      // 3. Alice tries to RBF her original transaction
      // 4. BIP125 Rule 3: Replacement must pay > 500 + 50,000 sats total
      // 5. Alice must overpay significantly to replace
      //
      // Mitigation: Bitcoin Core's "CPFP carve-out" (BIP-0431) allows
      // one extra descendant beyond the normal limit, specifically for
      // two-party protocols like Lightning channels.
      //
      // This is primarily a concern for multi-party protocols,
      // not single-user wallets.
      const originalFee = 500;
      const attackerDescendantFee = 50_000;
      const minReplacementFee = originalFee + attackerDescendantFee;

      expect(minReplacementFee).toBe(50_500);
      // Alice would need to pay 50,500+ sats instead of ~600
    });
  });

  // ==========================================================================
  // RBF EDGE CASES
  // ==========================================================================
  describe('RBF implementation edge cases', () => {
    it('should use correct minimum fee bump calculation', () => {
      // Current code in rbf.ts:
      // const minBump = Math.max(MIN_RBF_FEE_BUMP, currentFeeRate * 0.1);
      // const minNewFeeRate = currentFeeRate + minBump;

      const currentFeeRate = 5; // 5 sat/vB
      const minBump = Math.max(MIN_RBF_FEE_BUMP, currentFeeRate * 0.1);
      const minNewFeeRate = currentFeeRate + minBump;

      // At 5 sat/vB: minBump = max(1, 0.5) = 1, so min new rate = 6
      expect(minBump).toBe(1);
      expect(minNewFeeRate).toBe(6);
    });

    it('should handle very low fee rates correctly', () => {
      const currentFeeRate = 0.5; // 0.5 sat/vB
      const minBump = Math.max(MIN_RBF_FEE_BUMP, currentFeeRate * 0.1);
      const minNewFeeRate = currentFeeRate + minBump;

      // At 0.5 sat/vB: minBump = max(1, 0.05) = 1, so min new rate = 1.5
      expect(minBump).toBe(1);
      expect(minNewFeeRate).toBe(1.5);
    });

    it('should handle very high fee rates correctly', () => {
      const currentFeeRate = 500; // 500 sat/vB
      const minBump = Math.max(MIN_RBF_FEE_BUMP, currentFeeRate * 0.1);
      const minNewFeeRate = currentFeeRate + minBump;

      // At 500 sat/vB: minBump = max(1, 50) = 50, so min new rate = 550
      expect(minBump).toBe(50);
      expect(minNewFeeRate).toBe(550);
    });

    it('should document that RBF only works for unconfirmed transactions', () => {
      // canReplaceTransaction checks:
      // if (txDetails.confirmations && txDetails.confirmations > 0)
      //   return { replaceable: false, reason: 'Transaction is already confirmed' }
      //
      // Once a transaction has 1+ confirmation, it cannot be replaced.
      // This is a consensus rule, not a policy choice.
      const confirmedTx = { confirmations: 1 };
      const unconfirmedTx = { confirmations: 0 };

      expect(confirmedTx.confirmations).toBeGreaterThan(0);
      expect(unconfirmedTx.confirmations).toBe(0);
    });
  });
});
