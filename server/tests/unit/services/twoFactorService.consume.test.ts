import { describe, it, expect, vi, beforeEach } from 'vitest';

const consumeTotpStep = vi.fn();
vi.mock('../../../src/repositories', () => ({
  sessionRepository: { consumeTotpStep: (...args: unknown[]) => consumeTotpStep(...args) },
}));

import * as twoFactorService from '../../../src/services/twoFactorService';

describe('twoFactorService.consumeTotpStep', () => {
  beforeEach(() => consumeTotpStep.mockReset());

  it('delegates to the session repository and returns its verdict', async () => {
    consumeTotpStep.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(twoFactorService.consumeTotpStep('user-1', 41152264)).resolves.toBe(true);
    await expect(twoFactorService.consumeTotpStep('user-1', 41152264)).resolves.toBe(false);
    expect(consumeTotpStep).toHaveBeenNthCalledWith(1, 'user-1', 41152264);
  });

  it('propagates repository failures', async () => {
    consumeTotpStep.mockRejectedValueOnce(new Error('db down'));
    await expect(twoFactorService.consumeTotpStep('user-1', 1)).rejects.toThrow('db down');
  });
});
