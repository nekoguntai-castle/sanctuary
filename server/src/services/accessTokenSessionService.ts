import { userRepository } from '../repositories';
import { UnauthorizedError } from '../errors/ApiError';
import type { JWTPayload } from '../utils/jwt';
import { isVerificationRequired } from './email';

export type EmailVerificationAuthState = {
  email?: string | null;
  emailVerified?: boolean | null;
};

/**
 * Return true when the current email-verification policy should block a user
 * from authenticated routes. Users without an email preserve the legacy login
 * behavior; public registration requires email, so newly registered accounts
 * cannot use this bypass.
 */
export async function isEmailVerificationBlockingAuth(
  user: EmailVerificationAuthState,
): Promise<boolean> {
  if (!user.email || user.emailVerified === true) {
    return false;
  }

  return isVerificationRequired();
}

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
    email: true,
    emailVerified: true,
  });

  if (!currentUser) {
    throw new UnauthorizedError('User not found');
  }

  if (payload.sessionVersion !== currentUser.sessionVersion) {
    throw new UnauthorizedError('Token has been revoked');
  }

  if (await isEmailVerificationBlockingAuth(currentUser)) {
    throw new UnauthorizedError('Email verification required');
  }

  return {
    ...payload,
    username: currentUser.username,
    isAdmin: currentUser.isAdmin,
    sessionVersion: currentUser.sessionVersion,
  };
}
