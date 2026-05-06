import { describe,expect,it } from 'vitest';
import {
getAddressExplorerUrl,
getBlockExplorerUrl,
getExplorerUrl,
getTxExplorerUrl,
} from '../../utils/explorer';

describe('getExplorerUrl', () => {
  describe('Mainnet URLs', () => {
    it('should return unchanged URL for mainnet', () => {
      const url = 'https://mempool.space/tx/abc123';
      expect(getExplorerUrl(url, 'mainnet')).toBe(url);
    });

    it('should return unchanged URL when network is not specified', () => {
      const url = 'https://mempool.space/tx/abc123';
      expect(getExplorerUrl(url, '')).toBe(url);
    });

    it('should handle blockstream.info URLs for mainnet', () => {
      const url = 'https://blockstream.info/tx/abc123';
      expect(getExplorerUrl(url, 'mainnet')).toBe(url);
    });
  });

  describe('Testnet URLs', () => {
    it('should convert mempool.space transaction URLs to testnet', () => {
      const url = 'https://mempool.space/tx/abc123';
      const expected = 'https://mempool.space/testnet/tx/abc123';
      expect(getExplorerUrl(url, 'testnet')).toBe(expected);
    });

    it('should convert mempool.space address URLs to testnet', () => {
      const url = 'https://mempool.space/address/tb1qtest';
      const expected = 'https://mempool.space/testnet/address/tb1qtest';
      expect(getExplorerUrl(url, 'testnet')).toBe(expected);
    });

    it('should convert blockstream.info transaction URLs to testnet', () => {
      const url = 'https://blockstream.info/tx/abc123';
      const expected = 'https://blockstream.info/testnet/tx/abc123';
      expect(getExplorerUrl(url, 'testnet')).toBe(expected);
    });

    it('should convert blockstream.info address URLs to testnet', () => {
      const url = 'https://blockstream.info/address/tb1qtest';
      const expected = 'https://blockstream.info/testnet/address/tb1qtest';
      expect(getExplorerUrl(url, 'testnet')).toBe(expected);
    });

    it('should handle base mempool.space URL without path', () => {
      const url = 'https://mempool.space/';
      const expected = 'https://mempool.space/testnet/';
      expect(getExplorerUrl(url, 'testnet')).toBe(expected);
    });
  });

  describe('Signet URLs', () => {
    it('should convert mempool.space transaction URLs to signet', () => {
      const url = 'https://mempool.space/tx/abc123';
      const expected = 'https://mempool.space/signet/tx/abc123';
      expect(getExplorerUrl(url, 'signet')).toBe(expected);
    });

    it('should convert mempool.space address URLs to signet', () => {
      const url = 'https://mempool.space/address/tb1qtest';
      const expected = 'https://mempool.space/signet/address/tb1qtest';
      expect(getExplorerUrl(url, 'signet')).toBe(expected);
    });

    it('should handle base mempool.space URL for signet', () => {
      const url = 'https://mempool.space/';
      const expected = 'https://mempool.space/signet/';
      expect(getExplorerUrl(url, 'signet')).toBe(expected);
    });
  });

  describe('Testnet4 URLs', () => {
    it('should convert mempool.space transaction URLs to testnet4', () => {
      const url = 'https://mempool.space/tx/abc123';
      const expected = 'https://mempool.space/testnet4/tx/abc123';
      expect(getExplorerUrl(url, 'testnet4')).toBe(expected);
    });

    it('should convert mempool.space address URLs to testnet4', () => {
      const url = 'https://mempool.space/address/tb1qtest';
      const expected = 'https://mempool.space/testnet4/address/tb1qtest';
      expect(getExplorerUrl(url, 'testnet4')).toBe(expected);
    });

    it('should handle base mempool.space URL for testnet4', () => {
      const url = 'https://mempool.space/';
      const expected = 'https://mempool.space/testnet4/';
      expect(getExplorerUrl(url, 'testnet4')).toBe(expected);
    });
  });

  describe('Regtest and unknown networks', () => {
    it('should return unchanged URL for regtest', () => {
      const url = 'https://mempool.space/tx/abc123';
      expect(getExplorerUrl(url, 'regtest')).toBe(url);
    });

    it('should return unchanged URL for unknown network', () => {
      const url = 'https://mempool.space/tx/abc123';
      expect(getExplorerUrl(url, 'unknown')).toBe(url);
    });
  });
});

describe('getTxExplorerUrl', () => {
  it('should generate mainnet transaction URL with default explorer', () => {
    const txid = 'abc123def456';
    const expected = 'https://mempool.space/tx/abc123def456';
    expect(getTxExplorerUrl(txid, 'mainnet')).toBe(expected);
  });

  it('should generate testnet transaction URL', () => {
    const txid = 'abc123def456';
    const expected = 'https://mempool.space/testnet/tx/abc123def456';
    expect(getTxExplorerUrl(txid, 'testnet')).toBe(expected);
  });

  it('should generate signet transaction URL', () => {
    const txid = 'abc123def456';
    const expected = 'https://mempool.space/signet/tx/abc123def456';
    expect(getTxExplorerUrl(txid, 'signet')).toBe(expected);
  });

  it('should generate testnet4 transaction URL', () => {
    const txid = 'abc123def456';
    const expected = 'https://mempool.space/testnet4/tx/abc123def456';
    expect(getTxExplorerUrl(txid, 'testnet4')).toBe(expected);
  });

  it('should use custom explorer base URL', () => {
    const txid = 'abc123def456';
    const expected = 'https://blockstream.info/testnet/tx/abc123def456';
    expect(getTxExplorerUrl(txid, 'testnet', 'https://blockstream.info')).toBe(expected);
  });

  it('should default to mainnet when network not specified', () => {
    const txid = 'abc123def456';
    const expected = 'https://mempool.space/tx/abc123def456';
    expect(getTxExplorerUrl(txid)).toBe(expected);
  });
});

describe('getAddressExplorerUrl', () => {
  it('should generate mainnet address URL with default explorer', () => {
    const address = 'bc1qtest123';
    const expected = 'https://mempool.space/address/bc1qtest123';
    expect(getAddressExplorerUrl(address, 'mainnet')).toBe(expected);
  });

  it('should generate testnet address URL', () => {
    const address = 'tb1qtest123';
    const expected = 'https://mempool.space/testnet/address/tb1qtest123';
    expect(getAddressExplorerUrl(address, 'testnet')).toBe(expected);
  });

  it('should generate signet address URL', () => {
    const address = 'tb1qtest123';
    const expected = 'https://mempool.space/signet/address/tb1qtest123';
    expect(getAddressExplorerUrl(address, 'signet')).toBe(expected);
  });

  it('should generate testnet4 address URL', () => {
    const address = 'tb1qtest123';
    const expected = 'https://mempool.space/testnet4/address/tb1qtest123';
    expect(getAddressExplorerUrl(address, 'testnet4')).toBe(expected);
  });

  it('should use custom explorer base URL', () => {
    const address = 'tb1qtest123';
    const expected = 'https://blockstream.info/testnet/address/tb1qtest123';
    expect(getAddressExplorerUrl(address, 'testnet', 'https://blockstream.info')).toBe(expected);
  });

  it('should default to mainnet when network not specified', () => {
    const address = 'bc1qtest123';
    const expected = 'https://mempool.space/address/bc1qtest123';
    expect(getAddressExplorerUrl(address)).toBe(expected);
  });
});

describe('getBlockExplorerUrl', () => {
  it('should generate mainnet block URL with default explorer', () => {
    const blockHash = '00000000000000000001';
    const expected = 'https://mempool.space/block/00000000000000000001';
    expect(getBlockExplorerUrl(blockHash, 'mainnet')).toBe(expected);
  });

  it('should generate testnet block URL', () => {
    const blockHash = '00000000000000000001';
    const expected = 'https://mempool.space/testnet/block/00000000000000000001';
    expect(getBlockExplorerUrl(blockHash, 'testnet')).toBe(expected);
  });

  it('should generate signet block URL', () => {
    const blockHash = '00000000000000000001';
    const expected = 'https://mempool.space/signet/block/00000000000000000001';
    expect(getBlockExplorerUrl(blockHash, 'signet')).toBe(expected);
  });

  it('should use custom explorer base URL', () => {
    const blockHash = '00000000000000000001';
    const expected = 'https://blockstream.info/testnet/block/00000000000000000001';
    expect(getBlockExplorerUrl(blockHash, 'testnet', 'https://blockstream.info')).toBe(expected);
  });

  it('should default to mainnet when network not specified', () => {
    const blockHash = '00000000000000000001';
    const expected = 'https://mempool.space/block/00000000000000000001';
    expect(getBlockExplorerUrl(blockHash)).toBe(expected);
  });
});
