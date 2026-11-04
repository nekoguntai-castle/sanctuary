/**
 * Email Verification Repository
 *
 * Abstracts database operations for email verification tokens.
 */

import prisma, { type PrismaTxClient } from '../models/prisma';
import type { EmailVerificationToken, User } from '../generated/prisma/client';
import { normalizeEmail } from '../utils/email';
import { isUniqueConstraintError } from '../utils/errors';

export type EmailVerificationConsumeError =
  | 'INVALID_TOKEN'
  | 'EXPIRED_TOKEN'
  | 'ALREADY_USED'
  | 'USER_NOT_FOUND'
  | 'EMAIL_MISMATCH'
  | 'EMAIL_TAKEN';

export type EmailVerificationConsumeResult =
  | { success: true; userId: string; email: string }
  | { success: false; error: EmailVerificationConsumeError; userId?: string };

// Throwing this private sentinel forces Prisma to roll back token consumption
// when the user row cannot be verified, while still returning a typed public
// consume result to callers.
class EmailVerificationRollback extends Error {
  constructor(readonly result: Extract<EmailVerificationConsumeResult, { success: false }>) {
    super(result.error);
  }
}

/**
 * Create a new email verification token
 */
export async function create(data: {
  userId: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<EmailVerificationToken> {
  return prisma.emailVerificationToken.create({
    data: {
      ...data,
      email: normalizeEmail(data.email),
    },
  });
}

/**
 * Replace all unused verification intents for a user and create one normalized
 * email token in the same transaction.
 */
export async function replaceUnusedAndCreate(data: {
  userId: string;
  email: string;
  tokenHash: string;
  expiresAt: Date;
}): Promise<{ token: EmailVerificationToken }> {
  const email = normalizeEmail(data.email);

  return prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.deleteMany({
      where: {
        userId: data.userId,
        usedAt: null,
      },
    });

    const token = await tx.emailVerificationToken.create({
      data: {
        userId: data.userId,
        email,
        tokenHash: data.tokenHash,
        expiresAt: data.expiresAt,
      },
    });

    return { token };
  });
}

/**
 * Invalidate old unused intents and optionally create the new intent, in one
 * transaction. A verified address stays active until the new one is verified:
 * the user row is left alone and the new address lives only on the token
 * (`pendingEmail`), so a mistyped address can't lock the account out. A user
 * with no verified address is switched to the new, unverified one at once.
 */
export async function replaceUnusedForEmailUpdate(data: {
  userId: string;
  email: string;
  tokenHash?: string;
  expiresAt?: Date;
}): Promise<{ token?: EmailVerificationToken; user: User; pendingEmail?: string }> {
  const email = normalizeEmail(data.email);

  return prisma.$transaction(async (tx) => {
    await deleteUnusedByUserId(data.userId, tx);
    const token = data.tokenHash && data.expiresAt
      ? await tx.emailVerificationToken.create({
        data: { userId: data.userId, email, tokenHash: data.tokenHash, expiresAt: data.expiresAt },
      })
      : undefined;

    const current = await tx.user.findUniqueOrThrow({ where: { id: data.userId } });
    if (current.email && current.emailVerified) {
      return { token, user: current, pendingEmail: email };
    }

    const user = await tx.user.update({
      where: { id: data.userId },
      data: {
        email,
        emailVerified: false,
        emailVerifiedAt: null,
      },
    });

    return { token, user };
  });
}

/**
 * Find verification token by hash
 */
export async function findByTokenHash(
  tokenHash: string
): Promise<EmailVerificationToken | null> {
  return prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
  });
}

/**
 * Find pending (unused, not expired) verification token for a user
 */
export async function findPendingByUserId(
  userId: string
): Promise<EmailVerificationToken | null> {
  return prisma.emailVerificationToken.findFirst({
    where: {
      userId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find all pending tokens for a user (for cleanup when new token is created)
 */
export async function findAllPendingByUserId(
  userId: string
): Promise<EmailVerificationToken[]> {
  return prisma.emailVerificationToken.findMany({
    where: {
      userId,
      usedAt: null,
    },
  });
}

/**
 * Mark a token as used (verified)
 */
export async function markUsed(id: string): Promise<EmailVerificationToken> {
  return prisma.emailVerificationToken.update({
    where: { id },
    data: { usedAt: new Date() },
  });
}

/**
 * Consume an unused, unexpired verification token. It verifies the user's
 * current address, or applies a verified account's pending email change
 * (replaceUnusedForEmailUpdate). Every path that changes `user.email` deletes
 * the user's unused tokens, so a surviving token for another address is the
 * latest change request. Anything else is stale: the transaction rolls back
 * so the token is not marked used and `user.email` is not overwritten.
 */
export async function consumeForCurrentEmail(
  tokenHash: string
): Promise<EmailVerificationConsumeResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const token = await tx.emailVerificationToken.findUnique({ where: { tokenHash } });
      if (!token) {
        return { success: false, error: 'INVALID_TOKEN' };
      }
      if (token.usedAt) {
        return { success: false, error: 'ALREADY_USED', userId: token.userId };
      }

      const now = new Date();
      if (now > token.expiresAt) {
        return { success: false, error: 'EXPIRED_TOKEN', userId: token.userId };
      }

      const claimed = await tx.emailVerificationToken.updateMany({
        where: {
          id: token.id,
          tokenHash,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) {
        return { success: false, error: 'ALREADY_USED', userId: token.userId };
      }

      const tokenEmail = normalizeEmail(token.email);
      const user = await tx.user.findUnique({
        where: { id: token.userId },
        select: { email: true, emailVerified: true },
      });
      if (!user) {
        throw new EmailVerificationRollback({ success: false, error: 'USER_NOT_FOUND', userId: token.userId });
      }

      const currentEmail = user.email ? normalizeEmail(user.email) : null;
      if (currentEmail !== tokenEmail && !(currentEmail && user.emailVerified)) {
        // Not the current address and not a pending change on a verified
        // account: a stale intent from before the address changed.
        throw new EmailVerificationRollback({ success: false, error: 'EMAIL_MISMATCH', userId: token.userId });
      }

      // Verify the current address, or apply a verified account's pending
      // change. CAS on the address read above so a concurrent change wins.
      let applied: { count: number };
      try {
        applied = await tx.user.updateMany({
          where: { id: token.userId, email: user.email },
          data: {
            ...(currentEmail !== tokenEmail && { email: tokenEmail }),
            emailVerified: true,
            emailVerifiedAt: now,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        throw new EmailVerificationRollback({ success: false, error: 'EMAIL_TAKEN', userId: token.userId });
      }
      if (applied.count !== 1) {
        throw new EmailVerificationRollback({ success: false, error: 'EMAIL_MISMATCH', userId: token.userId });
      }

      // Any other unused token is superseded now (two concurrent change
      // requests can both leave one); it must not apply a later change.
      await deleteUnusedByUserId(token.userId, tx);

      return { success: true, userId: token.userId, email: tokenEmail };
    });
  } catch (error) {
    if (error instanceof EmailVerificationRollback) {
      return error.result;
    }
    throw error;
  }
}

/**
 * Delete all tokens for a user (cleanup after verification or user deletion)
 */
export async function deleteByUserId(userId: string): Promise<number> {
  const result = await prisma.emailVerificationToken.deleteMany({
    where: { userId },
  });
  return result.count;
}

/**
 * Delete expired tokens (maintenance job)
 */
export async function deleteExpired(): Promise<number> {
  const result = await prisma.emailVerificationToken.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}

/**
 * Delete unused tokens for a user (when creating a new token)
 */
export async function deleteUnusedByUserId(
  userId: string,
  client: PrismaTxClient = prisma,
): Promise<number> {
  const result = await client.emailVerificationToken.deleteMany({
    where: {
      userId,
      usedAt: null,
    },
  });
  return result.count;
}

/**
 * Count pending tokens for a user (for rate limiting)
 */
export async function countPendingByUserId(userId: string): Promise<number> {
  return prisma.emailVerificationToken.count({
    where: {
      userId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

/**
 * Count tokens created in timeframe for a user (for rate limiting)
 */
export async function countCreatedSince(
  userId: string,
  since: Date
): Promise<number> {
  return prisma.emailVerificationToken.count({
    where: {
      userId,
      createdAt: { gt: since },
    },
  });
}

// Export as namespace
export const emailVerificationRepository = {
  create,
  replaceUnusedAndCreate,
  replaceUnusedForEmailUpdate,
  findByTokenHash,
  findPendingByUserId,
  findAllPendingByUserId,
  markUsed,
  consumeForCurrentEmail,
  deleteByUserId,
  deleteExpired,
  deleteUnusedByUserId,
  countPendingByUserId,
  countCreatedSince,
};

export default emailVerificationRepository;
