import { describe, expect, it, vi } from 'vitest';
import {
  getExpectedGenesisHash,
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

  // `Buffer.from(hex, 'hex')` truncates silently at the first invalid pair, so
  // an unvalidated header produced a valid-looking 64-hex digest of the WRONG
  // bytes — no error, no signal. That digest becomes the block identity in the
  // confirmation job id, and durable reorg evidence once header state lands, so
  // the primitive must reject rather than hash whatever it can decode.
  it.each([
    ['empty', ''],
    ['non-hex', 'z'.repeat(160)],
    ['odd length', 'a'.repeat(159)],
    ['too short', 'a'.repeat(158)],
    ['too long', 'a'.repeat(162)],
    ['truncating garbage', 'abc'],
  ])('refuses to hash a %s block header', (_label, headerHex) => {
    expect(() => hashBlockHeader(headerHex)).toThrow(/block header/i);
  });

  it('accepts an upper-case 80-byte header, matching the lower-case digest', () => {
    expect(hashBlockHeader(TESTNET4_GENESIS_HEADER.toUpperCase())).toBe(
      hashBlockHeader(TESTNET4_GENESIS_HEADER),
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

  // The stricter primitive changes what a caller sees when an endpoint returns a
  // malformed genesis header: it now surfaces the header-shape error instead of
  // an identity mismatch. Either way the endpoint is refused, which is the
  // property that matters, but pin the behaviour so it is a decision, not drift.
  it('refuses an endpoint whose genesis header is malformed', async () => {
    await expect(
      verifyNodeClientNetwork(
        { getBlockHeader: vi.fn().mockResolvedValue('not-a-header') },
        'testnet4',
      ),
    ).rejects.toThrow(/block header/i);
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

  it('skips identity validation for networks without a fixed genesis anchor', async () => {
    const client = { getBlockHeader: vi.fn() };

    expect(getExpectedGenesisHash('regtest')).toBeNull();
    await expect(verifyNodeClientNetwork(client, 'regtest')).resolves.toBeUndefined();
    expect(client.getBlockHeader).not.toHaveBeenCalled();
  });
});
