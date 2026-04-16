import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Prisma } from '../../../src/generated/prisma/client';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    draftTransaction: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import {
  create,
  countByStatus,
  countByWalletId,
  deleteExpired,
  draftRepository,
  findById,
  findByIdInWallet,
  findByUserId,
  findByWalletId,
  findExpired,
  remove,
  update,
  updateApprovalStatus,
} from '../../../src/repositories/draftRepository';

describe('draftRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findByWalletId queries wallet drafts ordered by createdAt desc', async () => {
    (prisma.draftTransaction.findMany as Mock).mockResolvedValue([{ id: 'd1' }]);

    const result = await findByWalletId('wallet-1');

    expect(result).toEqual([{ id: 'd1' }]);
    expect(prisma.draftTransaction.findMany).toHaveBeenCalledWith({
      where: { walletId: 'wallet-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('findById and findByIdInWallet call Prisma lookups', async () => {
    (prisma.draftTransaction.findUnique as Mock).mockResolvedValue({ id: 'd1' });
    (prisma.draftTransaction.findFirst as Mock).mockResolvedValue({ id: 'd1', walletId: 'wallet-1' });

    await expect(findById('d1')).resolves.toEqual({ id: 'd1' });
    await expect(findByIdInWallet('d1', 'wallet-1')).resolves.toEqual({ id: 'd1', walletId: 'wallet-1' });

    expect(prisma.draftTransaction.findUnique).toHaveBeenCalledWith({ where: { id: 'd1' } });
    expect(prisma.draftTransaction.findFirst).toHaveBeenCalledWith({
      where: { id: 'd1', walletId: 'wallet-1' },
    });
  });

  it('findByUserId and findExpired use expected filters', async () => {
    (prisma.draftTransaction.findMany as Mock)
      .mockResolvedValueOnce([{ id: 'u1' }])
      .mockResolvedValueOnce([{ id: 'expired-1' }]);

    await expect(findByUserId('user-1')).resolves.toEqual([{ id: 'u1' }]);
    await expect(findExpired()).resolves.toEqual([{ id: 'expired-1' }]);

    expect(prisma.draftTransaction.findMany).toHaveBeenNthCalledWith(1, {
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.draftTransaction.findMany).toHaveBeenNthCalledWith(2, {
      where: { expiresAt: { lt: expect.any(Date) } },
    });
  });

  it('create applies defaults for nullable and JSON fields', async () => {
    const mockDraft = { id: 'draft-created' };
    (prisma.draftTransaction.create as Mock).mockResolvedValue(mockDraft);

    const result = await create({
      walletId: 'wallet-1',
      userId: 'user-1',
      recipient: 'tb1qrecipient',
      amount: BigInt(1000),
      feeRate: 12,
      selectedUtxoIds: ['u1'],
      enableRBF: true,
      subtractFees: false,
      sendMax: false,
      isRBF: false,
      psbtBase64: 'psbt',
      fee: BigInt(100),
      totalInput: BigInt(1100),
      totalOutput: BigInt(1000),
      changeAmount: BigInt(0),
      effectiveAmount: BigInt(1000),
      inputPaths: ["m/84'/0'/0'/0/0"],
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(result).toBe(mockDraft);
    expect(prisma.draftTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        outputs: Prisma.DbNull,
        inputs: Prisma.DbNull,
        decoyOutputs: Prisma.DbNull,
        payjoinUrl: null,
        label: null,
        memo: null,
        signedPsbtBase64: null,
        changeAddress: null,
        status: 'unsigned',
        signedDeviceIds: [],
      }),
    });
  });

  it('create preserves provided nullable and JSON fields', async () => {
    const mockDraft = { id: 'draft-created-with-optionals' };
    (prisma.draftTransaction.create as Mock).mockResolvedValue(mockDraft);

    const outputs = [{ address: 'tb1qrecipient', amount: 1000 }];
    const inputs = [{ txid: 'a'.repeat(64), vout: 0 }];
    const decoyOutputs = [{ address: 'tb1qdecoy', amount: 100 }];

    const result = await create({
      walletId: 'wallet-1',
      userId: 'user-1',
      recipient: 'tb1qrecipient',
      amount: BigInt(1000),
      feeRate: 12,
      selectedUtxoIds: ['u1'],
      enableRBF: true,
      subtractFees: false,
      sendMax: false,
      outputs,
      inputs,
      decoyOutputs,
      payjoinUrl: 'https://example.com/payjoin',
      isRBF: false,
      label: 'Savings',
      memo: 'memo text',
      psbtBase64: 'psbt',
      signedPsbtBase64: 'signed-psbt',
      signedDeviceIds: ['device-agent'],
      status: 'partial',
      fee: BigInt(100),
      totalInput: BigInt(1100),
      totalOutput: BigInt(1000),
      changeAmount: BigInt(0),
      changeAddress: 'tb1qchange',
      effectiveAmount: BigInt(1000),
      inputPaths: ["m/84'/0'/0'/0/0"],
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(result).toBe(mockDraft);
    expect(prisma.draftTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        outputs,
        inputs,
        decoyOutputs,
        payjoinUrl: 'https://example.com/payjoin',
        label: 'Savings',
        memo: 'memo text',
        signedPsbtBase64: 'signed-psbt',
        signedDeviceIds: ['device-agent'],
        status: 'partial',
        changeAddress: 'tb1qchange',
      }),
    });
  });

  it('update without expectedUpdatedAt performs direct update', async () => {
    const updated = { id: 'd1', status: 'partial' };
    (prisma.draftTransaction.update as Mock).mockResolvedValue(updated);

    const result = await update('d1', {
      status: 'partial',
      signedDeviceIds: ['dev-1'],
      signedPsbtBase64: 'signed-psbt',
      label: 'label',
      memo: 'memo',
    });

    expect(result).toEqual(updated);
    expect(prisma.draftTransaction.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: expect.objectContaining({
        status: 'partial',
        signedDeviceIds: ['dev-1'],
        signedPsbtBase64: 'signed-psbt',
        label: 'label',
        memo: 'memo',
        updatedAt: expect.any(Date),
      }),
    });
  });

  it('update with expectedUpdatedAt throws conflict when no rows updated', async () => {
    (prisma.draftTransaction.updateMany as Mock).mockResolvedValue({ count: 0 });

    await expect(
      update('d1', {
        expectedUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        status: 'signed',
      })
    ).rejects.toThrow('DRAFT_UPDATE_CONFLICT');
  });

  it('update with expectedUpdatedAt throws when updated record cannot be reloaded', async () => {
    (prisma.draftTransaction.updateMany as Mock).mockResolvedValue({ count: 1 });
    (prisma.draftTransaction.findUnique as Mock).mockResolvedValue(null);

    await expect(
      update('d1', {
        expectedUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        status: 'signed',
      })
    ).rejects.toThrow('Draft not found after update');
  });

  it('update with expectedUpdatedAt returns reloaded record', async () => {
    const reloaded = { id: 'd1', status: 'signed' };
    (prisma.draftTransaction.updateMany as Mock).mockResolvedValue({ count: 1 });
    (prisma.draftTransaction.findUnique as Mock).mockResolvedValue(reloaded);

    const result = await update('d1', {
      expectedUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      status: 'signed',
    });

    expect(result).toEqual(reloaded);
    expect(prisma.draftTransaction.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'd1',
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      data: expect.objectContaining({
        status: 'signed',
        updatedAt: expect.any(Date),
      }),
    });
  });

  it('remove, deleteExpired, countByWalletId and countByStatus delegate to Prisma', async () => {
    (prisma.draftTransaction.delete as Mock).mockResolvedValue(undefined);
    (prisma.draftTransaction.deleteMany as Mock).mockResolvedValue({ count: 3 });
    (prisma.draftTransaction.count as Mock)
      .mockResolvedValueOnce(11)
      .mockResolvedValueOnce(4);

    await remove('d1');
    const expiredCount = await deleteExpired();
    const walletCount = await countByWalletId('wallet-1');
    const statusCount = await countByStatus('wallet-1', 'signed');

    expect(prisma.draftTransaction.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
    expect(prisma.draftTransaction.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
    expect(prisma.draftTransaction.count).toHaveBeenNthCalledWith(1, {
      where: { walletId: 'wallet-1' },
    });
    expect(prisma.draftTransaction.count).toHaveBeenNthCalledWith(2, {
      where: { walletId: 'wallet-1', status: 'signed' },
    });
    expect(expiredCount).toBe(3);
    expect(walletCount).toBe(11);
    expect(statusCount).toBe(4);
  });

  describe('updateApprovalStatus', () => {
    it('should update approval status without approvedAt for non-approved', async () => {
      (prisma.draftTransaction.update as Mock).mockResolvedValue(undefined);

      await updateApprovalStatus('d1', 'rejected');

      expect(prisma.draftTransaction.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: { approvalStatus: 'rejected' },
      });
    });

    it('should set approvedAt when status is approved', async () => {
      (prisma.draftTransaction.update as Mock).mockResolvedValue(undefined);

      await updateApprovalStatus('d1', 'approved');

      expect(prisma.draftTransaction.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: {
          approvalStatus: 'approved',
          approvedAt: expect.any(Date),
        },
      });
    });
  });

  it('exports all operations via namespace and default object', () => {
    expect(draftRepository.findById).toBe(findById);
    expect(draftRepository.create).toBe(create);
    expect(draftRepository.update).toBe(update);
    expect(draftRepository.updateApprovalStatus).toBe(updateApprovalStatus);
  });
});
