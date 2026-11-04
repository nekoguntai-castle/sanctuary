/**
 * Email Verification Repository Tests
 *
 * Tests for email verification token data access operations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import type { Mock } from 'vitest';

// Mock Prisma before importing repository
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    emailVerificationToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    user: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import prisma from '../../../src/models/prisma';
import { emailVerificationRepository } from '../../../src/repositories/emailVerificationRepository';

describe('Email Verification Repository', () => {
  const testUserId = faker.string.uuid();
  const testTokenId = faker.string.uuid();
  const testEmail = faker.internet.email().toLowerCase();
  const testTokenHash = faker.string.alphanumeric(64);
  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const mockToken = {
    id: testTokenId,
    userId: testUserId,
    email: testEmail,
    tokenHash: testTokenHash,
    expiresAt: futureDate,
    createdAt: new Date(),
    usedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as Mock).mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
  });

  describe('create', () => {
    it('should create a new verification token', async () => {
      (prisma.emailVerificationToken.create as Mock).mockResolvedValue(mockToken);

      const result = await emailVerificationRepository.create({
        userId: testUserId,
        email: testEmail,
        tokenHash: testTokenHash,
        expiresAt: futureDate,
      });

      expect(result).toEqual(mockToken);
      expect(prisma.emailVerificationToken.create).toHaveBeenCalledWith({
        data: {
          userId: testUserId,
          email: testEmail,
          tokenHash: testTokenHash,
          expiresAt: futureDate,
        },
      });
    });

    it('should propagate database errors', async () => {
      (prisma.emailVerificationToken.create as Mock).mockRejectedValue(
        new Error('Unique constraint violation')
      );

      await expect(
        emailVerificationRepository.create({
          userId: testUserId,
          email: testEmail,
          tokenHash: testTokenHash,
          expiresAt: futureDate,
        })
      ).rejects.toThrow('Unique constraint violation');
    });
  });

  describe('replaceUnusedAndCreate', () => {
    it('should delete old unused intents and create the replacement in one transaction', async () => {
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 2 });
      (prisma.emailVerificationToken.create as Mock).mockResolvedValue(mockToken);

      const result = await emailVerificationRepository.replaceUnusedAndCreate({
        userId: testUserId,
        email: testEmail.toUpperCase(),
        tokenHash: testTokenHash,
        expiresAt: futureDate,
      });

      expect(result).toEqual({ token: mockToken });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          usedAt: null,
        },
      });
      expect(prisma.emailVerificationToken.create).toHaveBeenCalledWith({
        data: {
          userId: testUserId,
          email: testEmail,
          tokenHash: testTokenHash,
          expiresAt: futureDate,
        },
      });
    });
  });

  describe('replaceUnusedForEmailUpdate', () => {
    it('should create the new intent before resetting the user email in the same transaction', async () => {
      const updatedUser = {
        id: testUserId,
        email: testEmail,
        emailVerified: false,
        emailVerifiedAt: null,
      };
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.emailVerificationToken.create as Mock).mockResolvedValue(mockToken);
      (prisma.user.findUniqueOrThrow as Mock).mockResolvedValue({ id: testUserId, email: 'old@example.com', emailVerified: false });
      (prisma.user.update as Mock).mockResolvedValue(updatedUser);

      const result = await emailVerificationRepository.replaceUnusedForEmailUpdate({
        userId: testUserId,
        email: testEmail.toUpperCase(),
        tokenHash: testTokenHash,
        expiresAt: futureDate,
      });

      expect(result).toEqual({ token: mockToken, user: updatedUser });
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          usedAt: null,
        },
      });
      expect(prisma.emailVerificationToken.create).toHaveBeenCalledWith({
        data: {
          userId: testUserId,
          email: testEmail,
          tokenHash: testTokenHash,
          expiresAt: futureDate,
        },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: testUserId },
        data: {
          email: testEmail,
          emailVerified: false,
          emailVerifiedAt: null,
        },
      });
      expect(prisma.emailVerificationToken.create).toHaveBeenCalledBefore(prisma.user.update as Mock);
    });

    it('should update the email without creating an unsent token when token data is omitted', async () => {
      const updatedUser = {
        id: testUserId,
        email: testEmail,
        emailVerified: false,
        emailVerifiedAt: null,
      };
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.user.findUniqueOrThrow as Mock).mockResolvedValue({ id: testUserId, email: null, emailVerified: false });
      (prisma.user.update as Mock).mockResolvedValue(updatedUser);

      const result = await emailVerificationRepository.replaceUnusedForEmailUpdate({
        userId: testUserId,
        email: testEmail.toUpperCase(),
      });

      expect(result).toEqual({ token: undefined, user: updatedUser });
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          usedAt: null,
        },
      });
      expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: testUserId },
        data: {
          email: testEmail,
          emailVerified: false,
          emailVerifiedAt: null,
        },
      });
    });
  });

  describe('replaceUnusedForEmailUpdate on a verified account', () => {
    it('keeps the verified address active and records the new one as pending', async () => {
      const verifiedUser = { id: testUserId, email: 'old@example.com', emailVerified: true };
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 0 });
      (prisma.emailVerificationToken.create as Mock).mockResolvedValue(mockToken);
      (prisma.user.findUniqueOrThrow as Mock).mockResolvedValue(verifiedUser);

      const result = await emailVerificationRepository.replaceUnusedForEmailUpdate({
        userId: testUserId,
        email: testEmail.toUpperCase(),
        tokenHash: testTokenHash,
        expiresAt: futureDate,
      });

      // A mistyped address must not flip the account to unverified (lockout).
      expect(result).toEqual({ token: mockToken, user: verifiedUser, pendingEmail: testEmail });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.emailVerificationToken.create).toHaveBeenCalledWith({
        data: { userId: testUserId, email: testEmail, tokenHash: testTokenHash, expiresAt: futureDate },
      });
    });

    it('records no token when token data is omitted', async () => {
      const verifiedUser = { id: testUserId, email: 'old@example.com', emailVerified: true };
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 0 });
      (prisma.user.findUniqueOrThrow as Mock).mockResolvedValue(verifiedUser);

      await expect(emailVerificationRepository.replaceUnusedForEmailUpdate({
        userId: testUserId,
        email: testEmail,
      })).resolves.toEqual({ token: undefined, user: verifiedUser, pendingEmail: testEmail });
      expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    });
  });

  describe('findByTokenHash', () => {
    it('should find token by hash', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue(mockToken);

      const result = await emailVerificationRepository.findByTokenHash(testTokenHash);

      expect(result).toEqual(mockToken);
      expect(prisma.emailVerificationToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: testTokenHash },
      });
    });

    it('should return null when token not found', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue(null);

      const result = await emailVerificationRepository.findByTokenHash('non-existent-hash');

      expect(result).toBeNull();
    });
  });

  describe('findPendingByUserId', () => {
    it('should find unused, non-expired token for user', async () => {
      (prisma.emailVerificationToken.findFirst as Mock).mockResolvedValue(mockToken);

      const result = await emailVerificationRepository.findPendingByUserId(testUserId);

      expect(result).toEqual(mockToken);
      expect(prisma.emailVerificationToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return null when no pending token exists', async () => {
      (prisma.emailVerificationToken.findFirst as Mock).mockResolvedValue(null);

      const result = await emailVerificationRepository.findPendingByUserId(testUserId);

      expect(result).toBeNull();
    });
  });

  describe('findAllPendingByUserId', () => {
    it('should find all unused tokens for user', async () => {
      const tokens = [mockToken, { ...mockToken, id: faker.string.uuid() }];
      (prisma.emailVerificationToken.findMany as Mock).mockResolvedValue(tokens);

      const result = await emailVerificationRepository.findAllPendingByUserId(testUserId);

      expect(result).toEqual(tokens);
      expect(prisma.emailVerificationToken.findMany).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          usedAt: null,
        },
      });
    });

    it('should return empty array when no tokens exist', async () => {
      (prisma.emailVerificationToken.findMany as Mock).mockResolvedValue([]);

      const result = await emailVerificationRepository.findAllPendingByUserId(testUserId);

      expect(result).toEqual([]);
    });
  });

  describe('markUsed', () => {
    it('should mark token as used with timestamp', async () => {
      const usedToken = { ...mockToken, usedAt: new Date() };
      (prisma.emailVerificationToken.update as Mock).mockResolvedValue(usedToken);

      const result = await emailVerificationRepository.markUsed(testTokenId);

      expect(result.usedAt).toBeDefined();
      expect(prisma.emailVerificationToken.update).toHaveBeenCalledWith({
        where: { id: testTokenId },
        data: { usedAt: expect.any(Date) },
      });
    });

    it('should throw when token not found', async () => {
      (prisma.emailVerificationToken.update as Mock).mockRejectedValue(
        new Error('Record not found')
      );

      await expect(emailVerificationRepository.markUsed('non-existent-id')).rejects.toThrow(
        'Record not found'
      );
    });
  });

  describe('consumeForCurrentEmail', () => {
    it('should reject a missing token', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue(null);

      await expect(
        emailVerificationRepository.consumeForCurrentEmail(testTokenHash)
      ).resolves.toEqual({
        success: false,
        error: 'INVALID_TOKEN',
      });
      expect(prisma.emailVerificationToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('should reject an already-used token', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue({
        ...mockToken,
        usedAt: new Date(),
      });

      await expect(
        emailVerificationRepository.consumeForCurrentEmail(testTokenHash)
      ).resolves.toEqual({
        success: false,
        error: 'ALREADY_USED',
        userId: testUserId,
      });
      expect(prisma.emailVerificationToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('should reject an expired token', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue({
        ...mockToken,
        expiresAt: pastDate,
      });

      await expect(
        emailVerificationRepository.consumeForCurrentEmail(testTokenHash)
      ).resolves.toEqual({
        success: false,
        error: 'EXPIRED_TOKEN',
        userId: testUserId,
      });
      expect(prisma.emailVerificationToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('should reject when another transaction already claimed the token', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue(mockToken);
      (prisma.emailVerificationToken.updateMany as Mock).mockResolvedValue({ count: 0 });

      await expect(
        emailVerificationRepository.consumeForCurrentEmail(testTokenHash)
      ).resolves.toEqual({
        success: false,
        error: 'ALREADY_USED',
        userId: testUserId,
      });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('should claim an unused token and verify only the current matching user email', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue(mockToken);
      (prisma.emailVerificationToken.updateMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.user.findUnique as Mock).mockResolvedValue({ id: testUserId, email: testEmail, emailVerified: false });
      (prisma.user.updateMany as Mock).mockResolvedValue({ count: 1 });

      const result = await emailVerificationRepository.consumeForCurrentEmail(testTokenHash);

      expect(result).toEqual({
        success: true,
        userId: testUserId,
        email: testEmail,
      });
      expect(prisma.emailVerificationToken.updateMany).toHaveBeenCalledWith({
        where: {
          id: testTokenId,
          tokenHash: testTokenHash,
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          id: testUserId,
          email: testEmail,
        },
        data: {
          emailVerified: true,
          emailVerifiedAt: expect.any(Date),
        },
      });
    });

    it('should report stale email intent on an unverified account without writing user.email', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue({
        ...mockToken,
        email: 'old@example.com',
      });
      (prisma.emailVerificationToken.updateMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.user.findUnique as Mock).mockResolvedValue({ id: testUserId, email: testEmail, emailVerified: false });

      const result = await emailVerificationRepository.consumeForCurrentEmail(testTokenHash);

      expect(result).toEqual({
        success: false,
        error: 'EMAIL_MISMATCH',
        userId: testUserId,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('treats a token for an account whose email was removed as stale', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue(mockToken);
      (prisma.emailVerificationToken.updateMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.user.findUnique as Mock).mockResolvedValue({ id: testUserId, email: null, emailVerified: false });

      await expect(emailVerificationRepository.consumeForCurrentEmail(testTokenHash)).resolves.toMatchObject({
        success: false,
        error: 'EMAIL_MISMATCH',
      });
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('applies a verified account\'s pending email change', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue(mockToken);
      (prisma.emailVerificationToken.updateMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.user.findUnique as Mock).mockResolvedValue({ id: testUserId, email: 'old@example.com', emailVerified: true });
      (prisma.user.updateMany as Mock).mockResolvedValue({ count: 1 });

      await expect(emailVerificationRepository.consumeForCurrentEmail(testTokenHash)).resolves.toEqual({
        success: true,
        userId: testUserId,
        email: testEmail,
      });
      // CAS on the address the account still has, so a concurrent change wins.
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: testUserId, email: 'old@example.com' },
        data: { email: testEmail, emailVerified: true, emailVerifiedAt: expect.any(Date) },
      });
      // A concurrent second change request's token is superseded and dies here.
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: testUserId, usedAt: null },
      });
    });

    it('rolls back a pending change whose address another account took meanwhile', async () => {
      const { Prisma } = await import('../../../src/generated/prisma/client');
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue(mockToken);
      (prisma.emailVerificationToken.updateMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.user.findUnique as Mock).mockResolvedValue({ id: testUserId, email: 'old@example.com', emailVerified: true });
      (prisma.user.updateMany as Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
      );

      await expect(emailVerificationRepository.consumeForCurrentEmail(testTokenHash)).resolves.toEqual({
        success: false,
        error: 'EMAIL_TAKEN',
        userId: testUserId,
      });
    });

    it('reports a concurrent address change as a mismatch', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue(mockToken);
      (prisma.emailVerificationToken.updateMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.user.findUnique as Mock).mockResolvedValue({ id: testUserId, email: testEmail, emailVerified: false });
      (prisma.user.updateMany as Mock).mockResolvedValue({ count: 0 });

      await expect(emailVerificationRepository.consumeForCurrentEmail(testTokenHash)).resolves.toMatchObject({
        success: false,
        error: 'EMAIL_MISMATCH',
      });
    });

    it('rethrows unexpected failures while applying the change', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue(mockToken);
      (prisma.emailVerificationToken.updateMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.user.findUnique as Mock).mockResolvedValue({ id: testUserId, email: testEmail, emailVerified: false });
      (prisma.user.updateMany as Mock).mockRejectedValue(new Error('db down'));

      await expect(emailVerificationRepository.consumeForCurrentEmail(testTokenHash)).rejects.toThrow('db down');
    });

    it('should report missing users distinctly from stale email mismatch', async () => {
      (prisma.emailVerificationToken.findUnique as Mock).mockResolvedValue(mockToken);
      (prisma.emailVerificationToken.updateMany as Mock).mockResolvedValue({ count: 1 });
      (prisma.user.findUnique as Mock).mockResolvedValue(null);

      await expect(
        emailVerificationRepository.consumeForCurrentEmail(testTokenHash)
      ).resolves.toEqual({
        success: false,
        error: 'USER_NOT_FOUND',
        userId: testUserId,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should propagate unexpected transaction failures', async () => {
      (prisma.$transaction as Mock).mockRejectedValueOnce(new Error('transaction failed'));

      await expect(
        emailVerificationRepository.consumeForCurrentEmail(testTokenHash)
      ).rejects.toThrow('transaction failed');
    });
  });

  describe('deleteByUserId', () => {
    it('should delete all tokens for user and return count', async () => {
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 3 });

      const result = await emailVerificationRepository.deleteByUserId(testUserId);

      expect(result).toBe(3);
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: testUserId },
      });
    });

    it('should return 0 when no tokens exist', async () => {
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 0 });

      const result = await emailVerificationRepository.deleteByUserId(testUserId);

      expect(result).toBe(0);
    });
  });

  describe('deleteExpired', () => {
    it('should delete expired tokens and return count', async () => {
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 5 });

      const result = await emailVerificationRepository.deleteExpired();

      expect(result).toBe(5);
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: { lt: expect.any(Date) },
        },
      });
    });

    it('should return 0 when no expired tokens', async () => {
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 0 });

      const result = await emailVerificationRepository.deleteExpired();

      expect(result).toBe(0);
    });
  });

  describe('deleteUnusedByUserId', () => {
    it('should delete only unused tokens for user', async () => {
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 2 });

      const result = await emailVerificationRepository.deleteUnusedByUserId(testUserId);

      expect(result).toBe(2);
      expect(prisma.emailVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          usedAt: null,
        },
      });
    });

    it('should not delete used tokens', async () => {
      (prisma.emailVerificationToken.deleteMany as Mock).mockResolvedValue({ count: 0 });

      const result = await emailVerificationRepository.deleteUnusedByUserId(testUserId);

      expect(result).toBe(0);
    });
  });

  describe('countPendingByUserId', () => {
    it('should count pending tokens for user', async () => {
      (prisma.emailVerificationToken.count as Mock).mockResolvedValue(3);

      const result = await emailVerificationRepository.countPendingByUserId(testUserId);

      expect(result).toBe(3);
      expect(prisma.emailVerificationToken.count).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });

    it('should return 0 when no pending tokens', async () => {
      (prisma.emailVerificationToken.count as Mock).mockResolvedValue(0);

      const result = await emailVerificationRepository.countPendingByUserId(testUserId);

      expect(result).toBe(0);
    });
  });

  describe('countCreatedSince', () => {
    it('should count tokens created since timestamp', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      (prisma.emailVerificationToken.count as Mock).mockResolvedValue(4);

      const result = await emailVerificationRepository.countCreatedSince(testUserId, oneHourAgo);

      expect(result).toBe(4);
      expect(prisma.emailVerificationToken.count).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          createdAt: { gt: oneHourAgo },
        },
      });
    });

    it('should return 0 when no tokens created in timeframe', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      (prisma.emailVerificationToken.count as Mock).mockResolvedValue(0);

      const result = await emailVerificationRepository.countCreatedSince(testUserId, oneHourAgo);

      expect(result).toBe(0);
    });
  });
});
