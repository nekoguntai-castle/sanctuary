import { describe, it, expect, vi, beforeEach } from 'vitest';

const consumeTotpStep = vi.fn();
const verifyTokenStep = vi.fn();

vi.mock('../../../../src/services/twoFactorService', () => ({
  verifyTokenStep: (...args: unknown[]) => verifyTokenStep(...args),
  consumeTotpStep: (...args: unknown[]) => consumeTotpStep(...args),
}));

import { verifyAndConsumeTotp } from '../../../../src/api/auth/twoFactor/consumeVerifiedTotp';

describe('verifyAndConsumeTotp', () => {
  beforeEach(() => {
    consumeTotpStep.mockReset();
    verifyTokenStep.mockReset();
  });

  it('rejects an invalid code without consuming anything', async () => {
    verifyTokenStep.mockReturnValue({ valid: false });
    await expect(verifyAndConsumeTotp('user-1', 'secret', '000000')).resolves.toBe(false);
    expect(consumeTotpStep).not.toHaveBeenCalled();
  });

  it('fails closed when a valid verification reports no time step', async () => {
    verifyTokenStep.mockReturnValue({ valid: true });
    await expect(verifyAndConsumeTotp('user-1', 'secret', '123456')).resolves.toBe(false);
    expect(consumeTotpStep).not.toHaveBeenCalled();
  });

  it('consumes the matched step for the given user and returns the consume result', async () => {
    verifyTokenStep.mockReturnValue({ valid: true, timeStep: 41152264 });
    consumeTotpStep.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(verifyAndConsumeTotp('user-1', 'secret', '123456')).resolves.toBe(true);
    await expect(verifyAndConsumeTotp('user-1', 'secret', '123456')).resolves.toBe(false);
    expect(verifyTokenStep).toHaveBeenCalledWith('secret', '123456');
    expect(consumeTotpStep).toHaveBeenNthCalledWith(1, 'user-1', 41152264);
  });
});
