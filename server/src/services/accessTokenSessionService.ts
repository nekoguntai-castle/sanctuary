import { userRepository } from '../repositories';
import { UnauthorizedError } from '../errors/ApiError';
import type { JWTPayload } from '../utils/jwt';

/**
 * Resolve the current user behind a verified access JWT.
 *
 * Access tokens are intentionally short-lived but still need immediate
 * invalidation after logout-all, password resets, admin role changes, and user
 * deletion. The signed `sessionVersion` claim lets us reject old tokens with a
 * single user lookup while also replacing stale username/admin claims with the
 * current database values.
 */
export async function resolveCurrentAccessTokenPayload(payload: JWTPayload): Promise<JWTPayload> {
  const currentUser = await userRepository.findByIdWithSelect(payload.userId, {
    id: true,
    username: true,
    isAdmin: true,
    sessionVersion: true,
  });

  if (!currentUser) {
    throw new UnauthorizedError('User not found');
  }

  if (payload.sessionVersion !== currentUser.sessionVersion) {
    throw new UnauthorizedError('Token has been revoked');
  }

  return {
    ...payload,
    username: currentUser.username,
    isAdmin: currentUser.isAdmin,
    sessionVersion: currentUser.sessionVersion,
  };
}
