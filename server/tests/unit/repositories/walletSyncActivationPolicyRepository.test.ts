import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../src/models/prisma', () => ({
  default: {
    systemSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../../../src/constants/walletSyncActivation';
import prisma from '../../../src/models/prisma';
import {
  activateWalletSync,
  assertCurrentBinarySupportsWalletSyncActivation,
  readWalletSyncActivationPolicy,
} from '../../../src/repositories/walletSyncActivationPolicyRepository';
import {
  isOperationalSystemSettingKey,
  WALLET_SYNC_ACTIVATION_KEY,
} from '../../../src/repositories/operationalSystemSettings';

const activation = {
  version: 1 as const,
  activatedAt: '2026-08-22T12:00:00.000Z',
  mutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
};

describe('walletSyncActivationPolicyRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('classifies the activation record as protected operational state', () => {
    expect(WALLET_SYNC_ACTIVATION_KEY).toBe('operational.wallet-sync.activation.v1');
    expect(isOperationalSystemSettingKey(WALLET_SYNC_ACTIVATION_KEY)).toBe(true);
  });

  it('defaults a missing activation record to dormant', async () => {
    (prisma.systemSetting.findUnique as Mock).mockResolvedValue(null);

    await expect(readWalletSyncActivationPolicy()).resolves.toEqual({
      mode: 'dormant',
    });
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({
      where: { key: WALLET_SYNC_ACTIVATION_KEY },
      select: { value: true },
    });
  });

  it('strictly reads a compatible durable activation', async () => {
    (prisma.systemSetting.findUnique as Mock).mockResolvedValue({
      value: JSON.stringify(activation),
    });

    await expect(readWalletSyncActivationPolicy()).resolves.toEqual({
      mode: 'active',
      activation,
    });
  });

  it.each([
    'not-json',
    'null',
    '{}',
    JSON.stringify({ ...activation, version: 2 }),
    JSON.stringify({ ...activation, activatedAt: 'not-a-date' }),
    JSON.stringify({ ...activation, mutationFenceFloor: 0 }),
    JSON.stringify({ ...activation, mutationFenceFloor: -1 }),
    JSON.stringify({ ...activation, mutationFenceFloor: 1.5 }),
    JSON.stringify({ ...activation, mutationFenceFloor: '1' }),
    JSON.stringify({ ...activation, extra: true }),
  ])('fails closed for malformed durable state: %s', async (value) => {
    (prisma.systemSetting.findUnique as Mock).mockResolvedValue({ value });

    await expect(readWalletSyncActivationPolicy()).rejects.toThrow(
      'Invalid durable wallet-sync activation policy',
    );
  });

  it('refuses a valid activation above the current binary floor', async () => {
    const newerActivation = {
      ...activation,
      mutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR + 1,
    };
    (prisma.systemSetting.findUnique as Mock).mockResolvedValue({
      value: JSON.stringify(newerActivation),
    });

    await expect(readWalletSyncActivationPolicy()).rejects.toThrow(
      `requires mutation-fence floor ${newerActivation.mutationFenceFloor}`,
    );
  });

  it('accepts the current binary floor and directly refuses a newer floor', () => {
    expect(() => assertCurrentBinarySupportsWalletSyncActivation(activation)).not.toThrow();
    expect(() =>
      assertCurrentBinarySupportsWalletSyncActivation({
        ...activation,
        mutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR + 1,
      }),
    ).toThrow(`current binary supports ${WALLET_SYNC_MUTATION_FENCE_FLOOR}`);
  });

  it('creates the activation once with the current floor and exact timestamp', async () => {
    (prisma.systemSetting.upsert as Mock).mockResolvedValue({
      value: JSON.stringify(activation),
    });

    await expect(activateWalletSync(new Date(activation.activatedAt))).resolves.toEqual(activation);
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
      where: { key: WALLET_SYNC_ACTIVATION_KEY },
      create: {
        key: WALLET_SYNC_ACTIVATION_KEY,
        value: JSON.stringify(activation),
      },
      update: {},
      select: { value: true },
    });
  });

  it('preserves and returns the first committed activation unchanged', async () => {
    (prisma.systemSetting.upsert as Mock).mockResolvedValue({
      value: JSON.stringify(activation),
    });

    await expect(activateWalletSync(new Date('2026-08-23T12:00:00.000Z'))).resolves.toEqual(
      activation,
    );
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} }),
    );
  });

  it('fails closed when immutable stored activation is corrupted', async () => {
    (prisma.systemSetting.upsert as Mock).mockResolvedValue({ value: '{}' });

    await expect(activateWalletSync()).rejects.toThrow(
      'Invalid durable wallet-sync activation policy',
    );
  });

  it('refuses an immutable stored activation above this binary floor', async () => {
    (prisma.systemSetting.upsert as Mock).mockResolvedValue({
      value: JSON.stringify({
        ...activation,
        mutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR + 1,
      }),
    });

    await expect(activateWalletSync()).rejects.toThrow(
      'Wallet-sync activation requires mutation-fence floor',
    );
  });

  it('rejects an invalid activation timestamp before writing', async () => {
    await expect(activateWalletSync(new Date('invalid'))).rejects.toThrow(
      'Wallet-sync activation requires a valid timestamp',
    );
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });
});
