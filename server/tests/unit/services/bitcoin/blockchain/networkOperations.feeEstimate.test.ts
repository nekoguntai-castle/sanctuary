/**
 * Non-regression coverage for Phase 10 (P2 `electrum-estimatefee-sentinel-becomes-1-satvb`):
 * Electrum's `blockchain.estimatefee` returns `-1` to mean "no estimate
 * available". `estimateFee` in `services/bitcoin/electrum/methods.ts` used to
 * clamp that sentinel with `Math.max(1, ...)`, turning it into a fabricated
 * 1 sat/vB fee rate and starving the `{20,15,10,5}` fallback in
 * `getFeeEstimates` (services/bitcoin/blockchain/networkOperations.ts) of the
 * error it needs to engage.
 *
 * This test exercises the real `estimateFee` implementation (not a client
 * mock that bypasses it) by giving `getFeeEstimates`/`getAdvancedFeeEstimates`
 * a stub node client whose `estimateFee` delegates to the genuine Electrum
 * method with a fake low-level `requestFn`, so the fix in methods.ts is what
 * makes this test pass.
 *
 * A second pass (same phase, still Phase 10) closed a follow-on gap: the
 * first fix made `estimateFee()` throw for a missing target, but both
 * callers resolved all targets with `Promise.all`, so one missing target
 * (routine on thin-mempool/regtest servers, especially for a far target)
 * discarded every other target's live estimate in favor of the *entire*
 * fallback schedule. `getFeeEstimates`/`getAdvancedFeeEstimates` now resolve
 * each target independently and substitute only that tier's fallback.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: {},
}));

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

const mockGetNodeClient = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: mockGetNodeClient,
}));

import * as methods from '../../../../../src/services/bitcoin/electrum/methods';
import type { RequestFn } from '../../../../../src/services/bitcoin/electrum/methods';
import { getFeeEstimates } from '../../../../../src/services/bitcoin/blockchain/networkOperations';
import { getAdvancedFeeEstimates } from '../../../../../src/services/bitcoin/advancedTx';

/** A fake low-level Electrum `requestFn` that answers `blockchain.estimatefee`
 * per confirmation target, so each call exercises the real `estimateFee()`. */
function makeEstimatefeeRequestFn(ratesByBlocks: Record<number, number>): RequestFn {
  return vi.fn(async (_method: string, params?: unknown[]) => {
    const blocks = (params as number[] | undefined)?.[0] as number;
    return ratesByBlocks[blocks];
  });
}

function stubClient(requestFn: RequestFn) {
  return { estimateFee: (blocks: number) => methods.estimateFee(requestFn, blocks) };
}

function resetMocks(): void {
  mockLogger.debug.mockClear();
  mockLogger.info.mockClear();
  mockLogger.warn.mockClear();
  mockLogger.error.mockClear();
  mockGetNodeClient.mockReset();
}

describe('getFeeEstimates against the real Electrum estimateFee', () => {
  beforeEach(resetMocks);

  it('falls back to {20,15,10,5} when Electrum reports -1 (no estimate) for every target', async () => {
    const requestFn = vi.fn().mockResolvedValue(-1);
    mockGetNodeClient.mockResolvedValue(stubClient(requestFn));

    const estimates = await getFeeEstimates('testnet4');

    expect(estimates).toEqual({
      fastest: 20,
      halfHour: 15,
      hour: 10,
      economy: 5,
    });
  });

  it('still returns the real converted rate when Electrum has a positive estimate', async () => {
    // 0.00012 BTC/kB -> 12 sat/vB, matching the pre-existing conversion contract.
    const requestFn = vi.fn().mockResolvedValue(0.00012);
    mockGetNodeClient.mockResolvedValue(stubClient(requestFn));

    const estimates = await getFeeEstimates('testnet4');

    expect(estimates).toEqual({
      fastest: 12,
      halfHour: 12,
      hour: 12,
      economy: 12,
    });
  });

  it('keeps the live near-target estimates and substitutes only the missing farthest tier\'s fallback', async () => {
    // fastest(1) -> 7 sat/vB, halfHour(3) -> 4 sat/vB, hour(6) -> 2 sat/vB,
    // economy(12) -> no estimate (-1), so only economy falls back to 5.
    const requestFn = makeEstimatefeeRequestFn({
      1: 0.00007,
      3: 0.00004,
      6: 0.00002,
      12: -1,
    });
    mockGetNodeClient.mockResolvedValue(stubClient(requestFn));

    const estimates = await getFeeEstimates('testnet4');

    expect(estimates).toEqual({
      fastest: 7,
      halfHour: 4,
      hour: 2,
      economy: 5, // documented economy fallback, not the whole schedule's
    });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[BLOCKCHAIN] No Electrum fee estimate for target; using its fallback',
      expect.objectContaining({ network: 'testnet4', blocks: 12, tier: 'economy', fallback: 5 }),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('keeps full-fallback + error-level logging for a genuine (non-no-estimate) failure', async () => {
    // hour(6) throws a plain transport error, not ElectrumNoFeeEstimateError;
    // the other targets have live estimates that must NOT leak through.
    const requestFn = vi.fn(async (_method: string, params?: unknown[]) => {
      const blocks = (params as number[] | undefined)?.[0];
      if (blocks === 6) throw new Error('connection reset');
      return 0.00007;
    });
    mockGetNodeClient.mockResolvedValue(stubClient(requestFn));

    const estimates = await getFeeEstimates('testnet4');

    expect(estimates).toEqual({
      fastest: 20,
      halfHour: 15,
      hour: 10,
      economy: 5,
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      '[BLOCKCHAIN] Failed to get fee estimates',
      expect.objectContaining({ error: expect.stringContaining('connection reset') }),
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

describe('getAdvancedFeeEstimates against the real Electrum estimateFee', () => {
  beforeEach(resetMocks);

  it('keeps the live near-target estimates and substitutes only the missing tier\'s fallback', async () => {
    // fastest(1) -> no estimate (-1), so only fastest falls back to 50.
    // fast/medium/slow/minimum all have live estimates distinct from their
    // own fallback values, so a coincidental match can't hide an all-or-
    // nothing regression.
    const requestFn = makeEstimatefeeRequestFn({
      1: -1,
      3: 0.00025, // -> 25 sat/vB (fallback is 30)
      6: 0.00012, // -> 12 sat/vB (fallback is 15)
      12: 0.00006, // -> 6 sat/vB (fallback is 8)
      144: 0.00002, // -> 2 sat/vB (fallback is 1)
    });
    mockGetNodeClient.mockResolvedValue(stubClient(requestFn));

    const estimates = await getAdvancedFeeEstimates('testnet4');

    expect(estimates.fastest).toEqual({ feeRate: 50, blocks: 1, minutes: 10 });
    expect(estimates.fast).toEqual({ feeRate: 25, blocks: 3, minutes: 30 });
    expect(estimates.medium).toEqual({ feeRate: 12, blocks: 6, minutes: 60 });
    expect(estimates.slow).toEqual({ feeRate: 6, blocks: 12, minutes: 120 });
    expect(estimates.minimum).toEqual({ feeRate: 2, blocks: 144, minutes: 1440 });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'No Electrum fee estimate for target; using its fallback',
      expect.objectContaining({ network: 'testnet4', blocks: 1, tier: 'fastest', fallback: 50 }),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('keeps full-fallback + error-level logging for a genuine (non-no-estimate) failure', async () => {
    const requestFn = vi.fn(async (_method: string, params?: unknown[]) => {
      const blocks = (params as number[] | undefined)?.[0];
      if (blocks === 144) throw new Error('connection reset');
      return 0.00025;
    });
    mockGetNodeClient.mockResolvedValue(stubClient(requestFn));

    const estimates = await getAdvancedFeeEstimates('testnet4');

    expect(estimates).toEqual({
      fastest: { feeRate: 50, blocks: 1, minutes: 10 },
      fast: { feeRate: 30, blocks: 3, minutes: 30 },
      medium: { feeRate: 15, blocks: 6, minutes: 60 },
      slow: { feeRate: 8, blocks: 12, minutes: 120 },
      minimum: { feeRate: 1, blocks: 144, minutes: 1440 },
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to get fee estimates',
      expect.objectContaining({ error: expect.stringContaining('connection reset') }),
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
