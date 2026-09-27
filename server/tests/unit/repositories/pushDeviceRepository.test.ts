import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    pushDevice: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import {
  countByUserId,
  create,
  deleteById,
  deleteByToken,
  deleteByIdForUser,
  deleteByTokenForUser,
  deleteByUserId,
  deleteStale,
  findById,
  findByToken,
  findByUserId,
  findByUserIdAndPlatform,
  pushDeviceRepository,
  updateLastUsed,
  upsert,
} from '../../../src/repositories/pushDeviceRepository';

describe('pushDeviceRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('find methods delegate to Prisma with expected filters/order', async () => {
    (prisma.pushDevice.findUnique as Mock)
      .mockResolvedValueOnce({ id: 'pd-1' })
      .mockResolvedValueOnce({ id: 'pd-2' });
    (prisma.pushDevice.findMany as Mock)
      .mockResolvedValueOnce([{ id: 'pd-3' }])
      .mockResolvedValueOnce([{ id: 'pd-4' }]);

    await expect(findById('pd-1')).resolves.toEqual({ id: 'pd-1' });
    await expect(findByToken('token-1')).resolves.toEqual({ id: 'pd-2' });
    await expect(findByUserId('user-1')).resolves.toEqual([{ id: 'pd-3' }]);
    await expect(findByUserIdAndPlatform('user-1', 'ios')).resolves.toEqual([{ id: 'pd-4' }]);

    expect(prisma.pushDevice.findUnique).toHaveBeenNthCalledWith(1, { where: { id: 'pd-1' } });
    expect(prisma.pushDevice.findUnique).toHaveBeenNthCalledWith(2, { where: { token: 'token-1' } });
    expect(prisma.pushDevice.findMany).toHaveBeenNthCalledWith(1, {
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.pushDevice.findMany).toHaveBeenNthCalledWith(2, {
      where: { userId: 'user-1', platform: 'ios' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('countByUserId returns Prisma count', async () => {
    (prisma.pushDevice.count as Mock).mockResolvedValue(3);

    await expect(countByUserId('user-1')).resolves.toBe(3);
    expect(prisma.pushDevice.count).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  it('upsert creates or updates using token key', async () => {
    (prisma.pushDevice.upsert as Mock).mockResolvedValue({ id: 'pd-1' });

    const result = await upsert({
      userId: 'user-1',
      token: 'token-1',
      platform: 'android',
      deviceName: 'Pixel',
    });

    expect(result).toEqual({ id: 'pd-1' });
    expect(prisma.pushDevice.upsert).toHaveBeenCalledWith({
      where: { token: 'token-1' },
      update: {
        userId: 'user-1',
        platform: 'android',
        deviceName: 'Pixel',
        lastUsedAt: expect.any(Date),
      },
      create: {
        userId: 'user-1',
        token: 'token-1',
        platform: 'android',
        deviceName: 'Pixel',
      },
    });
  });

  it('create inserts a new device', async () => {
    const created = { id: 'pd-created' };
    (prisma.pushDevice.create as Mock).mockResolvedValue(created);

    await expect(
      create({
        userId: 'user-1',
        token: 'token-new',
        platform: 'ios',
        deviceName: null,
      })
    ).resolves.toBe(created);

    expect(prisma.pushDevice.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        token: 'token-new',
        platform: 'ios',
        deviceName: null,
      },
    });
  });

  it('update and delete helpers call Prisma operations', async () => {
    (prisma.pushDevice.update as Mock).mockResolvedValue(undefined);
    (prisma.pushDevice.delete as Mock).mockResolvedValue(undefined);
    (prisma.pushDevice.deleteMany as Mock)
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 1 });

    await updateLastUsed('pd-1');
    await deleteById('pd-1');
    await deleteByToken('token-1');
    const byUser = await deleteByUserId('user-1');
    const stale = await deleteStale(new Date('2025-01-01T00:00:00.000Z'));

    expect(prisma.pushDevice.update).toHaveBeenCalledWith({
      where: { id: 'pd-1' },
      data: { lastUsedAt: expect.any(Date) },
    });
    expect(prisma.pushDevice.delete).toHaveBeenNthCalledWith(1, { where: { id: 'pd-1' } });
    expect(prisma.pushDevice.delete).toHaveBeenNthCalledWith(2, { where: { token: 'token-1' } });
    expect(prisma.pushDevice.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { userId: 'user-1' },
    });
    expect(prisma.pushDevice.deleteMany).toHaveBeenNthCalledWith(2, {
      where: {
        lastUsedAt: { lt: new Date('2025-01-01T00:00:00.000Z') },
      },
    });
    expect(byUser).toBe(2);
    expect(stale).toBe(1);
  });

  it.each([0, 1])('conditional deletes return affected count %s with owner predicates', async count => {
    (prisma.pushDevice.deleteMany as Mock).mockResolvedValue({ count });
    await expect(deleteByIdForUser('pd-1', 'user-1')).resolves.toBe(count);
    await expect(deleteByTokenForUser('token-1', 'user-1')).resolves.toBe(count);
    expect(prisma.pushDevice.deleteMany).toHaveBeenNthCalledWith(1, { where: { id: 'pd-1', userId: 'user-1' } });
    expect(prisma.pushDevice.deleteMany).toHaveBeenNthCalledWith(2, { where: { token: 'token-1', userId: 'user-1' } });
  });

  it('propagates conditional deletion database failures', async () => {
    const error = new Error('database unavailable');
    (prisma.pushDevice.deleteMany as Mock).mockRejectedValue(error);
    await expect(deleteByIdForUser('pd-1', 'user-1')).rejects.toBe(error);
    await expect(deleteByTokenForUser('token-1', 'user-1')).rejects.toBe(error);
  });

  it('exports all operations via namespace and default object', () => {
    expect(pushDeviceRepository.findById).toBe(findById);
    expect(pushDeviceRepository.upsert).toBe(upsert);
    expect(pushDeviceRepository.deleteStale).toBe(deleteStale);
  });
});
