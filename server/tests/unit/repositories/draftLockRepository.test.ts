import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  prismaDraftUtxoLock: {
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: mocks.transaction,
    draftUtxoLock: mocks.prismaDraftUtxoLock,
    uTXO: {},
  },
}));

import { lockUtxos } from '../../../src/repositories/draftLockRepository';

describe('draftLockRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async callback => callback({
      draftUtxoLock: mocks.prismaDraftUtxoLock,
      uTXO: {},
    }));
  });

  it('locks UTXOs with a provided transaction client without opening a new transaction', async () => {
    const client = {
      draftUtxoLock: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      uTXO: {},
    };

    const result = await lockUtxos('draft-1', ['utxo-1', 'utxo-2'], client);

    expect(result).toEqual({
      success: true,
      lockedCount: 2,
      failedUtxoIds: [],
      lockedByDraftIds: [],
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(client.draftUtxoLock.deleteMany).toHaveBeenCalledWith({
      where: { draftId: 'draft-1' },
    });
    expect(client.draftUtxoLock.findMany).toHaveBeenCalledWith({
      where: {
        utxoId: { in: ['utxo-1', 'utxo-2'] },
        draftId: { not: 'draft-1' },
      },
      include: {
        draft: { select: { id: true, label: true } },
        utxo: { select: { txid: true, vout: true } },
      },
    });
    expect(client.draftUtxoLock.createMany).toHaveBeenCalledWith({
      data: [
        { draftId: 'draft-1', utxoId: 'utxo-1' },
        { draftId: 'draft-1', utxoId: 'utxo-2' },
      ],
    });
  });
});
