import { describe, expect, it, vi } from 'vitest';
import { faker } from '@faker-js/faker';

import prisma from '../../../src/models/prisma';
import { ForbiddenError, NotFoundError } from '../../../src/errors';

type ResourceAccessContractContext = {
  userId: string;
  walletId: string;
};

export function registerResourceAccessContracts({
  userId,
  walletId,
}: ResourceAccessContractContext) {
  describe('Address Access', () => {
    const addressId = faker.string.uuid();

    describe('checkAddressAccess', () => {
      it('should return access when user has wallet access', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'owner',
          addedAt: new Date(),
        });

        const { checkAddressAccess } = await import('../../../src/services/accessControl');
        const access = await checkAddressAccess(addressId, userId);

        expect(access.hasAccess).toBe(true);
        expect(access.walletId).toBe(walletId);
        expect(access.canEdit).toBe(true);
      });

      it('should return no access when address not found', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue(null);

        const { checkAddressAccess } = await import('../../../src/services/accessControl');
        const access = await checkAddressAccess(addressId, userId);

        expect(access.hasAccess).toBe(false);
        expect(access.walletId).toBeNull();
      });

      it('should return view-only access for viewer', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'viewer',
          addedAt: new Date(),
        });

        const { checkAddressAccess } = await import('../../../src/services/accessControl');
        const access = await checkAddressAccess(addressId, userId);

        expect(access.hasAccess).toBe(true);
        expect(access.canEdit).toBe(false);
      });
    });

    describe('requireAddressAccess', () => {
      it('should return context when user has access', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'signer',
          addedAt: new Date(),
        });

        const { requireAddressAccess } = await import('../../../src/services/accessControl');
        const result = await requireAddressAccess(addressId, userId);

        expect(result.walletId).toBe(walletId);
        expect(result.canEdit).toBe(true);
      });

      it('should throw NotFoundError when no access', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue(null);

        const { requireAddressAccess } = await import('../../../src/services/accessControl');
        await expect(requireAddressAccess(addressId, userId)).rejects.toThrow(NotFoundError);
      });
    });

    describe('requireAddressEditAccess', () => {
      it('should return context when user can edit', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'owner',
          addedAt: new Date(),
        });

        const { requireAddressEditAccess } = await import('../../../src/services/accessControl');
        const result = await requireAddressEditAccess(addressId, userId);

        expect(result.walletId).toBe(walletId);
      });

      it('should throw ForbiddenError when user cannot edit', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'viewer',
          addedAt: new Date(),
        });

        const { requireAddressEditAccess } = await import('../../../src/services/accessControl');
        await expect(requireAddressEditAccess(addressId, userId)).rejects.toThrow(ForbiddenError);
      });

      it('should throw NotFoundError when address not found', async () => {
        vi.mocked(prisma.address.findFirst).mockResolvedValue(null);

        const { requireAddressEditAccess } = await import('../../../src/services/accessControl');
        await expect(requireAddressEditAccess(addressId, userId)).rejects.toThrow(NotFoundError);
      });
    });
  });

  describe('Transaction Edit Access', () => {
    const transactionId = faker.string.uuid();

    describe('requireTransactionEditAccess', () => {
      it('should return context when user can edit', async () => {
        vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'signer',
          addedAt: new Date(),
        });

        const { requireTransactionEditAccess } = await import('../../../src/services/accessControl');
        const result = await requireTransactionEditAccess(transactionId, userId);

        expect(result.walletId).toBe(walletId);
      });

      it('should throw ForbiddenError when user cannot edit', async () => {
        vi.mocked(prisma.transaction.findFirst).mockResolvedValue({
          walletId,
        } as never);
        vi.mocked(prisma.walletUser.findFirst).mockResolvedValue({
          id: faker.string.uuid(),
          walletId,
          userId,
          role: 'viewer',
          addedAt: new Date(),
        });

        const { requireTransactionEditAccess } = await import('../../../src/services/accessControl');
        await expect(requireTransactionEditAccess(transactionId, userId)).rejects.toThrow(ForbiddenError);
      });

      it('should throw NotFoundError when transaction not found', async () => {
        vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);

        const { requireTransactionEditAccess } = await import('../../../src/services/accessControl');
        await expect(requireTransactionEditAccess(transactionId, userId)).rejects.toThrow(NotFoundError);
      });
    });
  });
}
