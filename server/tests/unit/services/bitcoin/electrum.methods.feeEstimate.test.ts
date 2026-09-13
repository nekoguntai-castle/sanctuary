/**
 * Non-regression coverage for Phase 10 (P2 `electrum-estimatefee-sentinel-becomes-1-satvb`):
 * Electrum's `blockchain.estimatefee` returns `-1` to mean "no estimate
 * available" for the requested confirmation target. `estimateFee` used to
 * clamp any result with `Math.max(1, ...)`, silently turning that sentinel
 * (and other non-positive/non-numeric results) into a fabricated 1 sat/vB
 * fee rate instead of signalling "no estimate" to the caller.
 */
import { describe, expect, it, vi } from 'vitest';
import { estimateFee } from '../../../../src/services/bitcoin/electrum/methods';
import { ElectrumNoFeeEstimateError } from '../../../../src/services/bitcoin/electrum/types';

describe('electrum methods estimateFee', () => {
  it('throws ElectrumNoFeeEstimateError instead of clamping Electrum\'s -1 sentinel to 1', async () => {
    const request = vi.fn().mockResolvedValue(-1);

    await expect(estimateFee(request, 6)).rejects.toThrow(ElectrumNoFeeEstimateError);
    await expect(estimateFee(request, 6)).rejects.toThrow('no fee estimate');
  });

  it.each([
    ['zero', 0],
    ['NaN', NaN],
    ['a non-numeric string', '0.0001' as unknown as number],
    ['null', null as unknown as number],
    ['undefined', undefined as unknown as number],
  ])('throws ElectrumNoFeeEstimateError for %s', async (_label, value) => {
    const request = vi.fn().mockResolvedValue(value);

    await expect(estimateFee(request, 6)).rejects.toThrow(ElectrumNoFeeEstimateError);
  });

  it('still converts a positive BTC/kB result to sat/vB as before', async () => {
    const request = vi.fn().mockResolvedValue(0.00012);

    await expect(estimateFee(request, 6)).resolves.toBe(12);
    expect(request).toHaveBeenCalledWith('blockchain.estimatefee', [6]);
  });

  it('rounds and floors a converted rate at 1 sat/vB, never below', async () => {
    const request = vi.fn().mockResolvedValue(0.0000001);

    await expect(estimateFee(request, 6)).resolves.toBe(1);
  });
});
