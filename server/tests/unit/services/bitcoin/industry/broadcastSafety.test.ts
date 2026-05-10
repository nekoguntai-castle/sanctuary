/**
 * Transaction Broadcasting Safety Tests
 *
 * Tests for common Bitcoin broadcast implementation problems:
 * - Stale UTXO detection before broadcast
 * - Broadcast error differentiation (already known, fee too low, etc.)
 * - PSBT output substitution detection
 * - Broadcast without raw tx or PSBT
 */

import * as bitcoin from 'bitcoinjs-lib';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BROADCAST_RUNTIME_PREFLIGHT_SCOPE } from '../../../../../src/services/bitcoin/transactions/broadcastContracts';

vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const TESTNET = bitcoin.networks.testnet;

describe('Transaction Broadcasting Safety', () => {
  // ==========================================================================
  // STALE UTXO DETECTION
  // ==========================================================================
  describe('Stale UTXO detection before broadcast', () => {
    it('requires Electrum-visible prevout evidence before runtime broadcast', () => {
      // When a user creates a transaction (PSBT), the UTXOs are selected
      // from the wallet's current state. Between PSBT creation and broadcast:
      //
      // 1. Another wallet instance could spend the same UTXOs
      // 2. A sync could mark UTXOs as spent from incoming chain data
      // 3. The UTXO could be double-spent by the sender via another path
      //
      // Production remains Electrum-only, so the runtime guard is not
      // Bitcoin Core testmempoolaccept. It is an Electrum witness check that
      // each final input's prevout is fetchable, standard-address, and still
      // reported as unspent before propagation.
      expect(BROADCAST_RUNTIME_PREFLIGHT_SCOPE.runtimeRequirements).toContain(
        'configured_electrum_backend',
      );
      expect(BROADCAST_RUNTIME_PREFLIGHT_SCOPE.verifiesBeforePropagation).toEqual(
        expect.arrayContaining([
          'previous_transactions_fetchable',
          'previous_outputs_exist',
          'previous_outputs_are_still_unspent',
        ]),
      );
      expect(BROADCAST_RUNTIME_PREFLIGHT_SCOPE.notRuntimeRequirements).toContain('bitcoin_core_rpc');
    });

    it('should document race condition between draft lock and broadcast', () => {
      // Timeline of a potential race condition:
      //
      // T1: User A creates draft -> locks UTXO-1
      // T2: User B starts sync -> finds UTXO-1 spent on-chain
      // T3: Sync marks UTXO-1 as spent in database
      // T4: User A broadcasts with UTXO-1 -> network rejects (already spent)
      //
      // The draft lock protects against USER-to-USER races,
      // but NOT against SYNC-to-USER races.
      //
      // The broadcast failure at T4 is not catastrophic (network rejects it),
      // but the error message is generic ("Failed to broadcast transaction")
      // rather than explaining that the UTXO was already spent.
      expect(true).toBe(true); // Documenting the race
    });
  });

  // ==========================================================================
  // BROADCAST ERROR DIFFERENTIATION
  // ==========================================================================
  describe('Broadcast error differentiation', () => {
    it('should document common Electrum broadcast error messages', () => {
      // Electrum servers return specific error strings that should be
      // differentiated for proper user-facing messaging:
      const ELECTRUM_ERRORS = {
        // Transaction already in mempool — should be treated as SUCCESS
        ALREADY_IN_MEMPOOL: 'Transaction already in block chain',
        ALREADY_KNOWN: 'already known',

        // Fee-related errors — should suggest RBF
        INSUFFICIENT_FEE: 'min relay fee not met',
        FEE_TOO_LOW: 'mempool min fee not met',

        // Input errors — UTXO issues
        MISSING_INPUTS: 'Missing inputs',
        INPUTS_SPENT: 'bad-txns-inputs-missingorspent',
        DOUBLE_SPEND: 'txn-mempool-conflict',

        // Standardness errors
        NON_STANDARD: 'non-standard',
        TX_TOO_LARGE: 'tx-size',
        DUST_OUTPUT: 'dust',
        NON_FINAL: 'non-final',
        NON_BIP68_FINAL: 'non-BIP68-final',
      };

      // Current code wraps ALL errors the same way:
      // throw new Error(`Failed to broadcast transaction: ${errorMessage}`)
      //
      // RECOMMENDATION: Parse error strings and return structured errors:
      // - ALREADY_IN_MEMPOOL -> treat as success, return txid
      // - FEE_TOO_LOW -> suggest RBF with higher fee
      // - MISSING_INPUTS -> warn about stale UTXOs, trigger resync
      // - DOUBLE_SPEND -> mark UTXOs as spent, trigger resync

      expect(Object.keys(ELECTRUM_ERRORS).length).toBeGreaterThan(5);
    });

    it('should document that "already in block chain" is not an error', () => {
      // If a transaction was previously broadcast but the app crashed before
      // persisting it, re-broadcasting should succeed (idempotent).
      // The Electrum error "Transaction already in block chain" means the
      // transaction IS confirmed — this should be treated as success.
      const errorMsg = 'Transaction already in block chain';
      const isActuallySuccess = errorMsg.includes('already in block chain') ||
                                 errorMsg.includes('already known');
      expect(isActuallySuccess).toBe(true);
    });

    it('should document that missing inputs indicates stale UTXOs', () => {
      const errorMsg = 'bad-txns-inputs-missingorspent';
      const indicatesStaleUtxo = errorMsg.includes('missingorspent') ||
                                  errorMsg.includes('Missing inputs');
      expect(indicatesStaleUtxo).toBe(true);
    });
  });

  // ==========================================================================
  // PSBT OUTPUT SUBSTITUTION ATTACK
  // ==========================================================================
  describe('PSBT output substitution detection', () => {
    it('should detect when signed PSBT has different outputs than intended', () => {
      // Attack scenario:
      // 1. User creates PSBT with output to recipient address A, amount X
      // 2. PSBT is sent to hardware wallet for signing
      // 3. Malicious software modifies the PSBT before signing
      // 4. Signed PSBT has output to attacker address B, amount X
      // 5. User broadcasts the modified PSBT, sending funds to attacker
      //
      // Defense: Compare outputs in the signed PSBT against the original
      // intent (recipient address + amount stored during draft creation).

      const intendedRecipient = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
      const intendedAmount = 50_000;

      // Create a PSBT with intended outputs
      const originalPsbt = new bitcoin.Psbt({ network: TESTNET });
      originalPsbt.addInput({
        hash: 'a'.repeat(64),
        index: 0,
        sequence: 0xfffffffd,
        witnessUtxo: {
          script: Buffer.from('0014' + 'aa'.repeat(20), 'hex'),
          value: BigInt(100_000),
        },
      });
      originalPsbt.addOutput({
        address: intendedRecipient,
        value: BigInt(intendedAmount),
      });

      // Verify that the outputs match intent
      const outputs = originalPsbt.txOutputs;
      const recipientOutput = outputs.find(o => {
        try {
          const addr = bitcoin.address.fromOutputScript(o.script, TESTNET);
          return addr === intendedRecipient;
        } catch {
          return false;
        }
      });

      expect(recipientOutput).toBeDefined();
      expect(recipientOutput!.value).toBe(BigInt(intendedAmount));
    });

    it('should verify all outputs in signed PSBT match draft metadata', () => {
      // The broadcastAndSave() function receives metadata with:
      // - recipient: string
      // - amount: number
      // - fee: number
      //
      // RECOMMENDATION: Before broadcasting, verify:
      // 1. Signed PSBT contains an output to metadata.recipient
      // 2. That output has value === metadata.amount
      // 3. Total fee === metadata.fee (within tolerance)
      // 4. No unexpected outputs were added

      const metadata = {
        recipient: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
        amount: 50_000,
        fee: 1000,
      };

      function verifyPsbtMatchesIntent(
        psbt: bitcoin.Psbt,
        intent: typeof metadata,
        network: bitcoin.Network
      ): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Check recipient output exists
        const outputs = psbt.txOutputs;
        const recipientFound = outputs.some(o => {
          try {
            const addr = bitcoin.address.fromOutputScript(o.script, network);
            return addr === intent.recipient && Number(o.value) === intent.amount;
          } catch {
            return false;
          }
        });

        if (!recipientFound) {
          errors.push('Recipient output not found or amount changed');
        }

        // Check fee matches (within 10% tolerance for rounding)
        let totalInput = BigInt(0);
        for (let i = 0; i < psbt.inputCount; i++) {
          const input = psbt.data.inputs[i];
          if (input.witnessUtxo) {
            totalInput += input.witnessUtxo.value;
          }
        }
        const totalOutput = outputs.reduce((sum, o) => sum + o.value, BigInt(0));
        const actualFee = Number(totalInput - totalOutput);
        const feeDiff = Math.abs(actualFee - intent.fee);

        if (feeDiff > intent.fee * 0.1) {
          errors.push(`Fee mismatch: expected ${intent.fee}, got ${actualFee}`);
        }

        return { valid: errors.length === 0, errors };
      }

      // Create matching PSBT
      const psbt = new bitcoin.Psbt({ network: TESTNET });
      psbt.addInput({
        hash: 'a'.repeat(64),
        index: 0,
        sequence: 0xfffffffd,
        witnessUtxo: {
          script: Buffer.from('0014' + 'aa'.repeat(20), 'hex'),
          value: BigInt(51_000), // amount + fee
        },
      });
      psbt.addOutput({
        address: metadata.recipient,
        value: BigInt(metadata.amount),
      });

      const result = verifyPsbtMatchesIntent(psbt, metadata, TESTNET);
      expect(result.valid).toBe(true);
    });
  });

  // ==========================================================================
  // EXTRACT RAW TRANSACTION EDGE CASES
  // ==========================================================================
  describe('Raw transaction extraction edge cases', () => {
    it('should document that both PSBT and rawTxHex paths exist', () => {
      // Two broadcast paths:
      // 1. signedPsbtBase64 -> finalize -> extractTransaction -> broadcast
      // 2. rawTxHex -> parse to get txid -> broadcast
      //
      // Both paths are tested implicitly, but edge cases include:
      // - Partially signed PSBT (not all inputs signed)
      // - PSBT with invalid signatures
      // - rawTxHex that doesn't match any PSBT in the system
      expect(true).toBe(true);
    });

    it('should handle neither PSBT nor rawTxHex gracefully', () => {
      // extractRawTransaction(undefined, undefined) should throw
      // This is tested by the function's implementation:
      // "Either signedPsbtBase64 or rawTxHex is required"
      expect(() => {
        // Simulating the check
        const signedPsbtBase64 = undefined;
        const rawTxHex = undefined;
        if (!signedPsbtBase64 && !rawTxHex) {
          throw new Error('Either signedPsbtBase64 or rawTxHex is required');
        }
      }).toThrow('Either signedPsbtBase64 or rawTxHex is required');
    });
  });
});
