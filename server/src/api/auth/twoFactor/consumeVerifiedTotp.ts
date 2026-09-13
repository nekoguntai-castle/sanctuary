import * as twoFactorService from '../../../services/twoFactorService';

/**
 * Verify a TOTP code and make it single-use in one step.
 *
 * A code whose time step was already consumed is rejected even if it is
 * cryptographically valid, so the same code cannot be replayed within its
 * clock-drift tolerance window. `twoFactorService.consumeTotpStep` is the atomic one-time
 * boundary: two concurrent submissions of the same code race to insert the
 * same marker row and exactly one wins. A valid verification that reports no
 * time step fails closed, because there is nothing to consume.
 */
export async function verifyAndConsumeTotp(
  userId: string,
  secret: string,
  token: string,
): Promise<boolean> {
  const verification = twoFactorService.verifyTokenStep(secret, token);
  if (!verification.valid || verification.timeStep === undefined) {
    return false;
  }
  return twoFactorService.consumeTotpStep(userId, verification.timeStep);
}
