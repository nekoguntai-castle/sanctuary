import { describe, expect, it, vi } from 'vitest';
import {
  hashBlockHeader,
  verifyNodeClientNetwork,
} from '../../../../src/services/bitcoin/networkIdentity';

const TESTNET3_GENESIS_HEADER =
  '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4adae5494dffff001d1aa4ae18';

const TESTNET4_GENESIS_HEADER =
  '0100000000000000000000000000000000000000000000000000000000000000000000004e7b2b9128fe0291db0693af2ae418b767e657cd407e80cb1434221eaea7a07a046f3566ffff001dbb0c7817';

describe('network identity', () => {
  it('hashes genesis headers using Bitcoin double-SHA256 byte order', () => {
    expect(hashBlockHeader(TESTNET4_GENESIS_HEADER)).toBe(
      '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
    );
  });

  it('accepts a matching Testnet4 Electrum endpoint identity', async () => {
    await expect(
      verifyNodeClientNetwork(
        { getBlockHeader: vi.fn().mockResolvedValue(TESTNET4_GENESIS_HEADER) },
        'testnet4',
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects a Testnet3 endpoint configured as Testnet4', async () => {
    await expect(
      verifyNodeClientNetwork(
        { getBlockHeader: vi.fn().mockResolvedValue(TESTNET3_GENESIS_HEADER) },
        'testnet4',
      ),
    ).rejects.toThrow('Testnet4 chain identity mismatch');
  });

  it('bounds the genesis header identity probe', async () => {
    await expect(
      verifyNodeClientNetwork(
        { getBlockHeader: vi.fn(() => new Promise<string>(() => undefined)) },
        'testnet4',
        { timeoutMs: 1 },
      ),
    ).rejects.toThrow('Testnet4 chain identity check timed out');
  });
});
