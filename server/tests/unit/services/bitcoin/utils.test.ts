/**
 * Bitcoin Utilities Tests
 *
 * Tests for basic Bitcoin utility functions.
 */

import {
  satsToBTC,
  btcToSats,
  validateAddress,
  getAddressType,
  estimateTransactionSize,
  calculateFee,
  getNetwork,
  formatBTC,
  parseTransaction,
  createTransaction as createTransactionFromUtils,
} from '../../../../src/services/bitcoin/utils';
import { testnetAddresses, mainnetAddresses } from '../../../fixtures/bitcoin';
import * as bitcoin from 'bitcoinjs-lib';

describe('Bitcoin Utilities', () => {
  describe('satsToBTC', () => {
    it('should convert satoshis to BTC', () => {
      expect(satsToBTC(100000000)).toBe(1);
      expect(satsToBTC(50000000)).toBe(0.5);
      expect(satsToBTC(1)).toBe(0.00000001);
      expect(satsToBTC(0)).toBe(0);
    });
  });

  describe('btcToSats', () => {
    it('should convert BTC to satoshis', () => {
      expect(btcToSats(1)).toBe(100000000);
      expect(btcToSats(0.5)).toBe(50000000);
      expect(btcToSats(0.00000001)).toBe(1);
      expect(btcToSats(0)).toBe(0);
    });

    it('should round to nearest satoshi', () => {
      // Math.round rounds 0.5 to nearest even (banker's rounding)
      // 0.000000015 BTC = 1.5 sats -> rounds to 2 based on Math.round
      // Note: floating point precision can cause issues at small values
      expect(btcToSats(0.000000016)).toBe(2);
      expect(btcToSats(0.000000014)).toBe(1);
    });
  });

  describe('validateAddress', () => {
    it('should validate mainnet native segwit addresses', () => {
      expect(validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'mainnet').valid).toBe(true);
    });

    it('should validate testnet native segwit addresses', () => {
      expect(validateAddress(testnetAddresses.nativeSegwit[0], 'testnet').valid).toBe(true);
    });

    it('should validate signet native segwit addresses with testnet parameters', () => {
      expect(validateAddress(testnetAddresses.nativeSegwit[0], 'signet').valid).toBe(true);
    });

    it('should reject invalid addresses', () => {
      expect(validateAddress('invalid-address', 'mainnet').valid).toBe(false);
      expect(validateAddress('', 'mainnet').valid).toBe(false);
    });

    it('should reject wrong network addresses', () => {
      // Testnet address on mainnet
      expect(validateAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'mainnet').valid).toBe(false);
    });
  });

  describe('getAddressType', () => {
    it('should identify P2WPKH (native segwit) addresses', () => {
      expect(getAddressType('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe('P2WPKH');
      expect(getAddressType('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe('P2WPKH');
    });

    it('should identify P2TR (taproot) addresses', () => {
      expect(getAddressType('bc1pxwww0ct9ue7e8tdnlmug5m2tamfn7q06sahstg39ys4c9f3340qqxrdu9k')).toBe('P2TR');
      expect(getAddressType('tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c')).toBe('P2TR');
    });

    it('should identify P2SH addresses', () => {
      expect(getAddressType('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe('P2SH');
      expect(getAddressType('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe('P2SH');
    });

    it('should identify P2PKH (legacy) addresses', () => {
      expect(getAddressType('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe('P2PKH');
      expect(getAddressType('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe('P2PKH');
    });

    it('should return Unknown for non-Bitcoin prefixes', () => {
      expect(getAddressType('xyz-not-address')).toBe('Unknown');
    });

    it('should return Invalid when called with a non-string value', () => {
      expect(getAddressType(null as unknown as string)).toBe('Invalid');
    });
  });

  describe('estimateTransactionSize', () => {
    it('should estimate native segwit transaction size', () => {
      const size = estimateTransactionSize(1, 2, 'native_segwit');
      expect(size).toBeGreaterThan(100);
      expect(size).toBeLessThan(200);
    });

    it('should estimate legacy transaction size', () => {
      const legacySize = estimateTransactionSize(1, 2, 'legacy');
      const segwitSize = estimateTransactionSize(1, 2, 'native_segwit');
      expect(legacySize).toBeGreaterThan(segwitSize);
    });

    it('should scale with input count', () => {
      const size1 = estimateTransactionSize(1, 2, 'native_segwit');
      const size2 = estimateTransactionSize(2, 2, 'native_segwit');
      expect(size2).toBeGreaterThan(size1);
    });

    it('should fall back to native segwit size for unknown script types', () => {
      const fallbackSize = estimateTransactionSize(1, 2, 'unknown_type' as any);
      const nativeSize = estimateTransactionSize(1, 2, 'native_segwit');

      expect(fallbackSize).toBe(nativeSize);
    });
  });

  describe('calculateFee', () => {
    it('should calculate correct fee', () => {
      expect(calculateFee(100, 10)).toBe(1000);
      expect(calculateFee(200, 5)).toBe(1000);
    });

    it('should round up to nearest satoshi', () => {
      expect(calculateFee(100, 1.5)).toBe(150);
      expect(calculateFee(101, 1)).toBe(101);
    });
  });

  describe('getNetwork', () => {
    it('should return correct network objects', () => {
      const mainnet = getNetwork('mainnet');
      expect(mainnet.bech32).toBe('bc');

      const testnet = getNetwork('testnet');
      expect(testnet.bech32).toBe('tb');

      const signet = getNetwork('signet');
      expect(signet.bech32).toBe('tb');

      const regtest = getNetwork('regtest');
      expect(regtest.bech32).toBe('bcrt');
    });
  });

  describe('formatBTC', () => {
    it('should keep trailing zeros for backward-compatible display', () => {
      expect(formatBTC(1.2, 4)).toBe('1.2000');
    });
  });

  describe('parseTransaction', () => {
    it('should parse a standard transaction and decode output address', () => {
      const tx = new bitcoin.Transaction();
      tx.version = 2;
      tx.addInput(Buffer.from('11'.repeat(32), 'hex'), 1, 0xfffffffe);
      tx.addOutput(
        bitcoin.address.toOutputScript(testnetAddresses.nativeSegwit[0], bitcoin.networks.testnet),
        BigInt(12_345)
      );

      const parsed = parseTransaction(tx.toHex(), 'testnet');

      expect(parsed.version).toBe(2);
      expect(parsed.inputs).toHaveLength(1);
      expect(parsed.inputs[0].vout).toBe(1);
      expect(parsed.outputs[0].value).toBe(12_345);
      expect(parsed.outputs[0].address).toBe(testnetAddresses.nativeSegwit[0]);
      expect(parsed.outputs[0].scriptPubKey.length).toBeGreaterThan(0);
    });

    it('should keep address undefined for scripts without address encoding', () => {
      const tx = new bitcoin.Transaction();
      tx.addInput(Buffer.from('22'.repeat(32), 'hex'), 0, 0xffffffff);
      tx.addOutput(
        bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from('hi')]),
        BigInt(0)
      );

      const parsed = parseTransaction(tx.toHex(), 'testnet');
      expect(parsed.outputs[0].address).toBeUndefined();
    });
  });

  describe('createTransaction (utils)', () => {
    const input = {
      txid: '33'.repeat(32),
      vout: 0,
      value: 80_000,
      scriptPubKey: '0014' + 'aa'.repeat(20),
    };
    const output = {
      address: testnetAddresses.nativeSegwit[0],
      value: 50_000,
    };

    it('should build a PSBT with RBF enabled by default', () => {
      const result = createTransactionFromUtils([input], [output], 5, { network: 'testnet' });

      expect(result.totalInput).toBe(80_000);
      expect(result.totalOutput).toBe(50_000);
      expect(result.fee).toBeGreaterThan(0);
      expect(result.psbt.txInputs[0].sequence).toBe(0xfffffffd);
    });

    it('should allow disabling RBF for final-sequence inputs', () => {
      const result = createTransactionFromUtils(
        [input],
        [output],
        5,
        { network: 'testnet', enableRBF: false }
      );

      expect(result.psbt.txInputs[0].sequence).toBe(0xffffffff);
    });

    it('should default to mainnet when network option is omitted', () => {
      const mainnetOutput = {
        address: mainnetAddresses.nativeSegwit[0],
        value: 50_000,
      };

      const result = createTransactionFromUtils([input], [mainnetOutput], 5);

      expect(result.psbt.txOutputs[0].address).toBe(mainnetOutput.address);
    });
  });
});
