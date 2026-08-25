import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const client = {
    address: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }) => ({ id: 'uncommitted', ...data })),
    },
    addressSubscriptionCheckpoint: {
      createMany: vi.fn(async () => ({ count: 1 })),
    },
    wallet: {
      findUnique: vi.fn(async () => ({ id: 'wallet-1' })),
    },
    $queryRaw: vi.fn()
      .mockResolvedValueOnce([{ id: 'wallet-1', network: 'signet' }])
      .mockResolvedValueOnce([]),
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation(async callback => callback(client));
  return { client };
});

vi.mock('../../../src/models/prisma', () => ({ default: mocks.client }));

import { addressRepository } from '../../../src/repositories/addressRepository';

describe('addressRepository sync-intent coupling', () => {
  it('rolls back address allocation when no catch-up generation remains', async () => {
    await expect(addressRepository.createNextCanonical(
      'wallet-1',
      0,
      index => ({
        address: `bc1qreceive${index}`,
        derivationPath: `m/84'/0'/0'/0/${index}`,
        coordinateVersion: 1,
        canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
        canonicalPolicyVersion: 1,
        scriptPubKey: `0014${'00'.repeat(20)}`,
        used: false,
      }),
    )).rejects.toThrow('catch-up request failed with status generation_exhausted');
  });
});
