import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../src/models/prisma', () => ({
  default: {
    featureFlag: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
    },
    featureFlagAudit: { create: vi.fn(), findMany: vi.fn() },
    systemSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import prisma from '../../../src/models/prisma';
import { featureFlagRepository } from '../../../src/repositories/featureFlagRepository';

describe('featureFlagRepository runtime snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as Mock).mockImplementation(async (operation) => operation(prisma));
    (prisma.systemSetting.findUnique as Mock).mockResolvedValue({ value: '7' });
    (prisma.systemSetting.upsert as Mock).mockResolvedValue(undefined);
    (prisma.systemSetting.update as Mock).mockResolvedValue(undefined);
  });

  it('advances generation and loads the exact snapshot inside the flag mutation transaction', async () => {
    const current = { id: 'flag-1', key: 'aiAssistant', enabled: false };
    const rows = [{ ...current, enabled: true }];
    (prisma.featureFlag.findUnique as Mock).mockResolvedValue(current);
    (prisma.featureFlag.update as Mock).mockResolvedValue(rows[0]);
    (prisma.featureFlagAudit.create as Mock).mockResolvedValue({});
    (prisma.featureFlag.findMany as Mock).mockResolvedValue(rows);

    const result = await featureFlagRepository.setFlagWithAudit(
      'aiAssistant',
      true,
      { userId: 'admin' },
    );

    expect(result).toEqual({ previousValue: false, generation: '8', flags: rows });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect((prisma.systemSetting.update as Mock).mock.invocationCallOrder[0])
      .toBeLessThan((prisma.featureFlag.findMany as Mock).mock.invocationCallOrder[0]);
  });

  it('loads generation and rows under one repeatable-read boundary for polling', async () => {
    (prisma.featureFlag.findMany as Mock).mockResolvedValue([]);

    await expect(featureFlagRepository.loadRuntimeState()).resolves.toEqual({
      generation: '7',
      flags: [],
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it('does not advance generation or write audit for an idempotent set', async () => {
    (prisma.featureFlag.findUnique as Mock).mockResolvedValue({
      id: 'flag-1',
      key: 'aiAssistant',
      enabled: true,
    });
    (prisma.featureFlag.findMany as Mock).mockResolvedValue([]);

    const result = await featureFlagRepository.setFlagWithAudit(
      'aiAssistant',
      true,
      { userId: 'admin' },
    );

    expect(result.generation).toBe('7');
    expect(prisma.systemSetting.update).not.toHaveBeenCalled();
    expect(prisma.featureFlagAudit.create).not.toHaveBeenCalled();
  });

  it('fails closed on corrupted operational generation metadata', async () => {
    (prisma.systemSetting.findUnique as Mock).mockResolvedValue({ value: 'not-a-generation' });

    await expect(featureFlagRepository.loadRuntimeState())
      .rejects.toThrow("Invalid feature runtime generation 'not-a-generation'");
  });

  it('creates standalone flags with the supplied description or a null description', async () => {
    (prisma.featureFlag.create as Mock).mockResolvedValue({ id: 'flag-1' });

    await featureFlagRepository.create({
      key: 'documentedFlag',
      enabled: true,
      description: 'A documented flag',
    });
    await featureFlagRepository.create({ key: 'undocumentedFlag', enabled: false });

    expect(prisma.featureFlag.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ description: 'A documented flag' }),
    });
    expect(prisma.featureFlag.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ description: null }),
    });
  });

  it('preserves generation and skips inserts when every default already exists', async () => {
    (prisma.featureFlag.findMany as Mock).mockResolvedValue([
      { key: 'hardwareWalletSigning', enabled: true },
    ]);

    await expect(featureFlagRepository.ensureDefaults([{
      key: 'hardwareWalletSigning',
      enabled: true,
      description: 'Hardware wallet support',
      category: 'general',
      modifiedBy: 'system',
    }])).resolves.toEqual({
      generation: '7',
      flags: [{ key: 'hardwareWalletSigning', enabled: true }],
    });

    expect(prisma.featureFlag.createMany).not.toHaveBeenCalled();
  });

  it('treats missing generation metadata as the initial generation', async () => {
    (prisma.systemSetting.findUnique as Mock).mockResolvedValue(null);

    await expect(featureFlagRepository.readGeneration(prisma as any)).resolves.toBe('0');
  });
});
