import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

vi.mock('../../../src/models/prisma', () => ({
  default: mockPrismaClient,
}));

import { priceDataRepository } from '../../../src/repositories/priceDataRepository';

describe('priceDataRepository', () => {
  beforeEach(() => {
    resetPrismaMocks();
  });

  it('inserts normalized price data rows', async () => {
    await priceDataRepository.insertPriceData({
      currency: ' usd ',
      price: 61_000,
      source: 'aggregate',
    });

    expect(mockPrismaClient.priceData.create).toHaveBeenCalledWith({
      data: {
        currency: 'USD',
        price: 61_000,
        source: 'aggregate',
      },
    });
  });

  it('inserts fee estimate rows using the cache serialization shape', async () => {
    await priceDataRepository.insertFeeEstimate({
      fastest: 12,
      halfHour: 8,
      hour: 4,
    });

    expect(mockPrismaClient.feeEstimate.create).toHaveBeenCalledWith({
      data: {
        fastest: 12,
        halfHour: 8,
        hour: 4,
      },
    });
  });
});
