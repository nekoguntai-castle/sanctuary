import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    error: mocks.logError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/models/prisma', () => ({
  default: {
    networkHeaderCheckpoint: { findUnique: mocks.findUnique },
  },
}));

import {
  classifyHeaderObservation,
  findNetworkHeaderCheckpoint,
  type NetworkHeaderCheckpointState,
} from '../../../src/repositories/networkHeaderCheckpointRepository';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

/** Default observations extend HASH_A so tests opt into a reorg explicitly. */
const observation = (height: number, hash: string, previousHash = HASH_A) => ({
  height,
  hash,
  previousHash,
});

const persisted = (
  overrides: Partial<NetworkHeaderCheckpointState> = {},
): NetworkHeaderCheckpointState => ({
  network: 'mainnet',
  lastProcessedHeight: 900_000,
  lastProcessedHash: HASH_A,
  observedAt: new Date('2026-08-23T00:00:00.000Z'),
  coverageGapStartedAt: null,
  ...overrides,
});

const row = (overrides: Record<string, unknown> = {}) => ({
  network: 'mainnet',
  lastProcessedHeight: 900_000,
  lastProcessedHash: HASH_A,
  observedAt: new Date('2026-08-23T00:00:00.000Z'),
  coverageGapStartedAt: null,
  createdAt: new Date('2026-08-23T00:00:00.000Z'),
  updatedAt: new Date('2026-08-23T00:00:00.000Z'),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('classifyHeaderObservation', () => {
  it('reports first_observation as uncovered when nothing is persisted', () => {
    expect(classifyHeaderObservation(null, observation(900_001, HASH_B))).toEqual({
      classification: 'first_observation',
      covered: false,
      missedHeights: null,
    });
  });

  it('treats an unchanged re-observation as covered without progress', () => {
    expect(classifyHeaderObservation(persisted(), observation(900_000, HASH_A))).toEqual({
      classification: 'duplicate',
      covered: true,
      missedHeights: null,
    });
  });

  it('treats the next height built on the persisted tip as gap-free', () => {
    expect(classifyHeaderObservation(persisted(), observation(900_001, HASH_B, HASH_A))).toEqual({
      classification: 'contiguous',
      covered: true,
      missedHeights: null,
    });
  });

  it('refuses to call a one-block reorg contiguous', () => {
    // Same height advance, different parent: the persisted tip was replaced,
    // not extended. Heights alone cannot tell these apart.
    expect(classifyHeaderObservation(persisted(), observation(900_001, HASH_B, HASH_C))).toEqual({
      classification: 'reorg_at_parent',
      covered: false,
      missedHeights: null,
    });
  });

  it('flags a replaced header at the persisted height as uncovered', () => {
    expect(classifyHeaderObservation(persisted(), observation(900_000, HASH_B))).toEqual({
      classification: 'same_height_different_hash',
      covered: false,
      missedHeights: null,
    });
  });

  it('flags a height that moves backwards as uncovered', () => {
    expect(classifyHeaderObservation(persisted(), observation(899_999, HASH_B))).toEqual({
      classification: 'height_decrease',
      covered: false,
      missedHeights: null,
    });
  });

  it('reports the inclusive span of heights that were never observed', () => {
    expect(classifyHeaderObservation(persisted(), observation(900_004, HASH_B))).toEqual({
      classification: 'missed_gap',
      covered: false,
      missedHeights: { from: 900_001, to: 900_003 },
    });
  });

  it('reports a single missed height as a one-block span', () => {
    expect(classifyHeaderObservation(persisted(), observation(900_002, HASH_B))).toEqual({
      classification: 'missed_gap',
      covered: false,
      missedHeights: { from: 900_001, to: 900_001 },
    });
  });

  it('accepts genesis as a valid observed height', () => {
    expect(classifyHeaderObservation(null, observation(0, HASH_A)).classification)
      .toBe('first_observation');
  });

  it.each([
    ['a negative height', observation(-1, HASH_A)],
    ['a fractional height', observation(1.5, HASH_A)],
    ['a height beyond the persisted range', observation(2_147_483_648, HASH_A)],
  ])('rejects %s rather than classifying it', (_label, observation) => {
    expect(() => classifyHeaderObservation(persisted(), observation))
      .toThrow('Invalid block height in header observation');
  });

  it.each([
    ['a short hash', 'abcd'],
    ['an uppercase hash', 'A'.repeat(64)],
    ['a non-hex hash', 'z'.repeat(64)],
  ])('rejects %s rather than classifying it', (_label, hash) => {
    expect(() => classifyHeaderObservation(persisted(), observation(900_001, hash)))
      .toThrow('Invalid block hash in header observation');
  });

  it('rejects a non-string hash rather than classifying it', () => {
    expect(() => classifyHeaderObservation(
      persisted(),
      observation(900_001, null as unknown as string),
    )).toThrow('Invalid block hash in header observation');
  });

  it('rejects a malformed parent hash rather than assuming contiguity', () => {
    expect(() => classifyHeaderObservation(persisted(), observation(900_001, HASH_B, 'abcd')))
      .toThrow('Invalid parent block hash in header observation');
  });
});

describe('findNetworkHeaderCheckpoint', () => {
  it('returns null for a network that has never been observed', async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(findNetworkHeaderCheckpoint('signet')).resolves.toBeNull();
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { network: 'signet' } });
  });

  it('reads the legacy testnet alias through the persisted vocabulary', async () => {
    mocks.findUnique.mockResolvedValue(row({ network: 'testnet' }));

    await expect(findNetworkHeaderCheckpoint('testnet')).resolves.toEqual({
      network: 'testnet3',
      lastProcessedHeight: 900_000,
      lastProcessedHash: HASH_A,
      observedAt: new Date('2026-08-23T00:00:00.000Z'),
      coverageGapStartedAt: null,
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { network: 'testnet3' } });
  });

  it('refuses to query for an unrecognised network', async () => {
    await expect(findNetworkHeaderCheckpoint('dogecoin'))
      .rejects.toThrow('Invalid persisted Bitcoin network');
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  // An untrustworthy row degrades to UNKNOWN rather than throwing: it must not
  // report coverage, but neither may it wedge sync for that network forever.
  it.each([
    ['an unrecognised network column', { network: 'litecoin' }, 'Invalid persisted Bitcoin network'],
    ['a negative height', { lastProcessedHeight: -1 }, 'out-of-range height'],
    ['a fractional height', { lastProcessedHeight: 12.5 }, 'out-of-range height'],
    ['a height beyond the column range', { lastProcessedHeight: 2_147_483_648 }, 'out-of-range height'],
    ['a malformed block hash', { lastProcessedHash: 'not-a-hash' }, 'malformed block hash'],
    ['an invalid observation time', { observedAt: new Date(Number.NaN) }, 'observation time'],
    ['an invalid gap start', { coverageGapStartedAt: new Date(Number.NaN) }, 'coverage gap start'],
  ])('discards a stored row with %s and logs why', async (_label, overrides, reason) => {
    mocks.findUnique.mockResolvedValue(row(overrides));

    await expect(findNetworkHeaderCheckpoint('mainnet')).resolves.toBeNull();
    expect(mocks.logError).toHaveBeenCalledWith(
      'Discarding untrustworthy persisted header checkpoint',
      expect.objectContaining({ network: 'mainnet', error: expect.stringContaining(reason) }),
    );
  });

  it('returns a well-formed checkpoint unchanged', async () => {
    mocks.findUnique.mockResolvedValue(row());

    await expect(findNetworkHeaderCheckpoint('mainnet')).resolves.toEqual({
      network: 'mainnet',
      lastProcessedHeight: 900_000,
      lastProcessedHash: HASH_A,
      observedAt: new Date('2026-08-23T00:00:00.000Z'),
      coverageGapStartedAt: null,
    });
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});
