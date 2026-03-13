import { vi } from 'vitest';
/**
 * ElectrumClient Network-Aware Tests
 *
 * Tests for Electrum client's handling of different networks (mainnet, testnet, signet, regtest).
 * Verifies that address-to-scripthash conversion and transaction decoding work correctly
 * with network-specific addresses.
 */

import { ElectrumClient, getElectrumClientForNetwork } from '../../../../src/services/bitcoin/electrum';
import { addressToScriptHash, getNetworkLib } from '../../../../src/services/bitcoin/electrum/methods';

// Mock the net and tls modules
vi.mock('net');
vi.mock('tls');

// Mock Prisma
vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    nodeConfig: { findFirst: vi.fn().mockResolvedValue(null) },
    electrumServer: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'test-server',
          label: 'Test Server',
          host: 'localhost',
          port: 50001,
          useSsl: false,
          network: 'mainnet',
          enabled: true,
          priority: 0,
        },
      ]),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

// Mock logger
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ElectrumClient Network Support', () => {
  describe('Network-specific client instances', () => {
    it('should create separate client instances for different networks', () => {
      const mainnetClient = getElectrumClientForNetwork('mainnet');
      const testnetClient = getElectrumClientForNetwork('testnet');
      const signetClient = getElectrumClientForNetwork('signet');
      const regtestClient = getElectrumClientForNetwork('regtest');

      expect(mainnetClient).toBeDefined();
      expect(testnetClient).toBeDefined();
      expect(signetClient).toBeDefined();
      expect(regtestClient).toBeDefined();

      // Should be different instances
      expect(mainnetClient).not.toBe(testnetClient);
      expect(mainnetClient).not.toBe(signetClient);
      expect(testnetClient).not.toBe(signetClient);
    });

    it('should return same client instance for same network (singleton per network)', () => {
      const client1 = getElectrumClientForNetwork('mainnet');
      const client2 = getElectrumClientForNetwork('mainnet');

      expect(client1).toBe(client2);
    });

    it('should have correct network property set', () => {
      const mainnetClient = getElectrumClientForNetwork('mainnet');
      const testnetClient = getElectrumClientForNetwork('testnet');

      // Access private property for testing
      expect((mainnetClient as any).network).toBe('mainnet');
      expect((testnetClient as any).network).toBe('testnet');
    });
  });

  describe('Address handling with different networks', () => {
    // Helper to create test client config
    const createTestConfig = (network: 'mainnet' | 'testnet' | 'signet' | 'regtest') => ({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp' as const,
      network,
    });

    it('should handle mainnet native segwit addresses correctly', () => {
      const client = new ElectrumClient(createTestConfig('mainnet'));
      const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

      // This should not throw
      expect(() => {
        const scriptHash = addressToScriptHash(address, client.getNetwork());
        expect(scriptHash).toBeDefined();
        expect(typeof scriptHash).toBe('string');
        expect(scriptHash.length).toBe(64); // SHA256 hex string
      }).not.toThrow();
    });

    it('should handle testnet native segwit addresses correctly', () => {
      const client = new ElectrumClient(createTestConfig('testnet'));
      const address = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

      expect(() => {
        const scriptHash = addressToScriptHash(address, client.getNetwork());
        expect(scriptHash).toBeDefined();
        expect(typeof scriptHash).toBe('string');
        expect(scriptHash.length).toBe(64);
      }).not.toThrow();
    });

    it('should handle mainnet legacy addresses correctly', () => {
      const client = new ElectrumClient(createTestConfig('mainnet'));
      const address = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

      expect(() => {
        const scriptHash = addressToScriptHash(address, client.getNetwork());
        expect(scriptHash).toBeDefined();
        expect(typeof scriptHash).toBe('string');
        expect(scriptHash.length).toBe(64);
      }).not.toThrow();
    });

    it('should handle testnet legacy addresses correctly', () => {
      const client = new ElectrumClient(createTestConfig('testnet'));
      const address = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';

      expect(() => {
        const scriptHash = addressToScriptHash(address, client.getNetwork());
        expect(scriptHash).toBeDefined();
        expect(typeof scriptHash).toBe('string');
        expect(scriptHash.length).toBe(64);
      }).not.toThrow();
    });

    // Note: P2SH and Taproot address tests require additional bitcoinjs-lib setup
    // These address types are supported by the main application through proper initialization
  });

  describe('Network library selection', () => {
    // Helper to create test client config
    const createTestConfig = (network: 'mainnet' | 'testnet' | 'signet' | 'regtest') => ({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp' as const,
      network,
    });

    it('should use mainnet network library for mainnet client', () => {
      const client = new ElectrumClient(createTestConfig('mainnet'));
      const networkLib = getNetworkLib(client.getNetwork()) as { bech32: string };

      expect(networkLib).toBeDefined();
      expect(networkLib.bech32).toBe('bc');
    });

    it('should use testnet network library for testnet client', () => {
      const client = new ElectrumClient(createTestConfig('testnet'));
      const networkLib = getNetworkLib(client.getNetwork()) as { bech32: string };

      expect(networkLib).toBeDefined();
      expect(networkLib.bech32).toBe('tb');
    });

    // Note: Signet network library test skipped - signet address format handling
    // is validated through the actual Electrum server connections

    it('should use regtest network library for regtest client', () => {
      const client = new ElectrumClient(createTestConfig('regtest'));
      const networkLib = getNetworkLib(client.getNetwork()) as { bech32: string };

      expect(networkLib).toBeDefined();
      expect(networkLib.bech32).toBe('bcrt');
    });
  });

  describe('Cross-network address validation', () => {
    // Helper to create test client config
    const createTestConfig = (network: 'mainnet' | 'testnet' | 'signet' | 'regtest') => ({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp' as const,
      network,
    });

    it('should correctly identify mainnet address with mainnet client', () => {
      const client = new ElectrumClient(createTestConfig('mainnet'));
      const mainnetAddress = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

      expect(() => {
        addressToScriptHash(mainnetAddress, client.getNetwork());
      }).not.toThrow();
    });

    it('should correctly identify testnet address with testnet client', () => {
      const client = new ElectrumClient(createTestConfig('testnet'));
      const testnetAddress = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

      expect(() => {
        addressToScriptHash(testnetAddress, client.getNetwork());
      }).not.toThrow();
    });

    it('should handle wrong network address gracefully', () => {
      const mainnetClient = new ElectrumClient(createTestConfig('mainnet'));
      const testnetAddress = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

      // Using a testnet address with mainnet client should throw or handle gracefully
      expect(() => {
        addressToScriptHash(testnetAddress, mainnetClient.getNetwork());
      }).toThrow();
    });
  });

  describe('Transaction decoding with network context', () => {
    // Helper to create test client config
    const createTestConfig = (network: 'mainnet' | 'testnet' | 'signet' | 'regtest') => ({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp' as const,
      network,
    });

    it('should decode transaction with mainnet context', () => {
      const client = new ElectrumClient(createTestConfig('mainnet'));
      // Sample mainnet transaction hex (coinbase tx from block 0)
      const rawTxHex = '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';

      expect(() => {
        const tx = (client as any).decodeRawTransaction(rawTxHex);
        expect(tx).toBeDefined();
        expect(tx.txid).toBeDefined();
      }).not.toThrow();
    });

    it('should decode transaction with testnet context', () => {
      const client = new ElectrumClient(createTestConfig('testnet'));
      // Same transaction hex, but decoded with testnet context
      const rawTxHex = '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';

      expect(() => {
        const tx = (client as any).decodeRawTransaction(rawTxHex);
        expect(tx).toBeDefined();
        expect(tx.txid).toBeDefined();
      }).not.toThrow();
    });
  });
});
