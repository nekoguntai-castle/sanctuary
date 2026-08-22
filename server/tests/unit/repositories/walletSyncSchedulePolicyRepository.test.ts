import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../src/models/prisma', () => ({
  default: {
    systemSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import prisma from '../../../src/models/prisma';
import {
  WALLET_SYNC_SCHEDULE_COMPATIBILITY_FLOOR,
  forbidStaleWalletSchedule,
  readStaleWalletSchedulePolicy,
} from '../../../src/repositories/walletSyncSchedulePolicyRepository';
import { STALE_WALLET_SCHEDULE_FORBIDDEN_KEY } from '../../../src/repositories/operationalSystemSettings';

const tombstone = {
  version: 1,
  forbiddenAt: '2026-08-22T12:00:00.000Z',
  compatibilityFloor: WALLET_SYNC_SCHEDULE_COMPATIBILITY_FLOOR,
};

describe('walletSyncSchedulePolicyRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults a missing tombstone to the compatibility scheduler', async () => {
    (prisma.systemSetting.findUnique as Mock).mockResolvedValue(null);

    await expect(readStaleWalletSchedulePolicy()).resolves.toEqual({
      mode: 'legacy_enabled',
    });
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({
      where: { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY },
      select: { value: true },
    });
  });

  it('strictly reads an existing permanent tombstone', async () => {
    (prisma.systemSetting.findUnique as Mock).mockResolvedValue({
      value: JSON.stringify(tombstone),
    });

    await expect(readStaleWalletSchedulePolicy()).resolves.toEqual({
      mode: 'forbidden',
      tombstone,
    });
  });

  it.each([
    'not-json',
    'null',
    '{}',
    JSON.stringify({ ...tombstone, version: 2 }),
    JSON.stringify({ ...tombstone, compatibilityFloor: 1 }),
    JSON.stringify({ ...tombstone, forbiddenAt: 'not-a-date' }),
    JSON.stringify({ ...tombstone, extra: true }),
  ])('fails closed for malformed durable state: %s', async (value) => {
    (prisma.systemSetting.findUnique as Mock).mockResolvedValue({ value });

    await expect(readStaleWalletSchedulePolicy()).rejects.toThrow(
      'Invalid durable stale-wallet schedule tombstone',
    );
  });

  it('creates the tombstone once and returns the stored value', async () => {
    (prisma.systemSetting.upsert as Mock).mockResolvedValue({
      value: JSON.stringify(tombstone),
    });

    await expect(
      forbidStaleWalletSchedule(new Date(tombstone.forbiddenAt)),
    ).resolves.toEqual(tombstone);
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
      where: { key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY },
      create: {
        key: STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
        value: JSON.stringify(tombstone),
      },
      update: {},
      select: { value: true },
    });
  });

  it('preserves an existing tombstone and rejects corrupted stored state', async () => {
    (prisma.systemSetting.upsert as Mock).mockResolvedValue({ value: '{}' });

    await expect(forbidStaleWalletSchedule()).rejects.toThrow(
      'Invalid durable stale-wallet schedule tombstone',
    );
  });

  it('rejects an invalid tombstone timestamp before writing', async () => {
    await expect(forbidStaleWalletSchedule(new Date('invalid'))).rejects.toThrow(
      'requires a valid timestamp',
    );
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });
});
