import { Prisma } from '../../../../src/generated/prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { confirmTransfer } from '../../../../src/services/transferService';
import { mockPrismaClient } from '../../../mocks/prisma';
import {
  mockLoggerDebug,
  ownerId,
  recipientId,
  transferId,
  walletId,
} from './transferServiceTestHarness';

const acceptedTransfer = {
  id: transferId,
  resourceType: 'wallet',
  resourceId: walletId,
  fromUserId: ownerId,
  toUserId: recipientId,
  status: 'accepted',
  keepExistingUsers: true,
  expiresAt: new Date(Date.now() + 60_000),
};

const confirmedTransfer = {
  ...acceptedTransfer,
  status: 'confirmed',
  confirmedAt: new Date(),
  fromUser: { id: ownerId, username: 'owner' },
  toUser: { id: recipientId, username: 'recipient' },
};

function createTransactionClient(current = acceptedTransfer) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(0),
    ownershipTransfer: {
      findUnique: vi.fn().mockResolvedValue(current),
      update: vi.fn().mockResolvedValue(confirmedTransfer),
    },
    walletUser: {
      findFirst: vi.fn()
        .mockResolvedValueOnce({
          id: 'wallet-owner',
          walletId,
          userId: ownerId,
          role: 'owner',
        })
        .mockResolvedValueOnce(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
}

function adapterWriteConflict() {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2010',
    clientVersion: 'test',
    meta: {
      driverAdapterError: {
        cause: { kind: 'TransactionWriteConflict' },
      },
    },
  });
}

function p2034WriteConflict() {
  return new Prisma.PrismaClientKnownRequestError('write conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

export function registerTransferConfirmRetryContracts() {
  describe('confirmTransfer serializable retry', () => {
    it.each([
      ['P2034', p2034WriteConflict()],
      ['adapter P2010', adapterWriteConflict()],
    ])('retries the whole confirmation after one %s conflict', async (_label, conflict) => {
      mockPrismaClient.ownershipTransfer.findUnique
        .mockResolvedValueOnce(acceptedTransfer)
        .mockResolvedValueOnce(confirmedTransfer);
      let attempts = 0;
      mockPrismaClient.$transaction.mockImplementation(async callback => {
        const result = await callback(createTransactionClient(acceptedTransfer) as never);
        attempts += 1;
        if (attempts === 1) throw conflict;
        return result;
      });

      await expect(confirmTransfer(ownerId, transferId)).resolves.toMatchObject({
        status: 'confirmed',
      });

      expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(2);
      expect(mockLoggerDebug).toHaveBeenCalledWith(
        'Retrying serializable transfer transaction',
        { operation: 'confirmation', attempt: 1 },
      );
    });

    it('maps retry exhaustion to the existing conflict envelope', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValueOnce(acceptedTransfer);
      mockPrismaClient.$transaction.mockRejectedValue(p2034WriteConflict());

      await expect(confirmTransfer(ownerId, transferId)).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
        message: 'Transfer confirmation conflicted with another update. Please retry.',
      });
      expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(3);
    });

    it('re-reads confirmed state in the new snapshot after an adapter conflict', async () => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValueOnce(acceptedTransfer);
      let attempts = 0;
      mockPrismaClient.$transaction.mockImplementation(async callback => {
        attempts += 1;
        const current = attempts === 1 ? acceptedTransfer : confirmedTransfer;
        const result = await callback(createTransactionClient(current) as never);
        if (attempts === 1) throw adapterWriteConflict();
        return result;
      });

      await expect(confirmTransfer(ownerId, transferId)).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
        message: 'Transfer has already been completed',
      });
      expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['ordinary failure', new Error('database unavailable')],
      ['unrelated Prisma code', new Prisma.PrismaClientKnownRequestError('unique conflict', {
        code: 'P2002',
        clientVersion: 'test',
      })],
      ['unclassified P2010', new Prisma.PrismaClientKnownRequestError('raw query failed', {
        code: 'P2010',
        clientVersion: 'test',
      })],
      ['unrelated adapter cause', new Prisma.PrismaClientKnownRequestError('raw query failed', {
        code: 'P2010',
        clientVersion: 'test',
        meta: {
          driverAdapterError: {
            cause: { kind: 'DriverError' },
          },
        },
      })],
    ])('does not retry %s', async (_label, failure) => {
      mockPrismaClient.ownershipTransfer.findUnique.mockResolvedValueOnce(acceptedTransfer);
      mockPrismaClient.$transaction.mockRejectedValue(failure);

      await expect(confirmTransfer(ownerId, transferId)).rejects.toBe(failure);
      expect(mockPrismaClient.$transaction).toHaveBeenCalledTimes(1);
    });
  });
}
