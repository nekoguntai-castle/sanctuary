import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  prismaDraftUtxoLock: {
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
  prismaUTXO: {
    findMany: vi.fn(),
  },
}));

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: mocks.transaction,
    draftUtxoLock: mocks.prismaDraftUtxoLock,
    uTXO: mocks.prismaUTXO,
  },
}));

import { lockUtxos, resolveUtxoRefs } from '../../../src/repositories/draftLockRepository';
import prisma from '../../../src/models/prisma';

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
      draftUtxoLock: prisma.draftUtxoLock,
      uTXO: prisma.uTXO,
    };
    vi.mocked(client.draftUtxoLock.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(client.draftUtxoLock.findMany).mockResolvedValue([]);
    vi.mocked(client.draftUtxoLock.createMany).mockResolvedValue({ count: 2 });

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

  it('filters out spent and frozen UTXOs when resolving UTXO refs for locking', async () => {
    mocks.prismaUTXO.findMany.mockResolvedValue([
      { id: 'utxo-1', txid: 'tx-1', vout: 0 },
    ]);

    const result = await resolveUtxoRefs('wallet-1', [
      { txid: 'tx-1', vout: 0 },
      { txid: 'tx-2', vout: 1 },
    ]);

    expect(result).toEqual([{ id: 'utxo-1', txid: 'tx-1', vout: 0 }]);
    expect(mocks.prismaUTXO.findMany).toHaveBeenCalledWith({
      where: {
        walletId: 'wallet-1',
        spent: false,
        frozen: false,
        OR: [
          { txid: 'tx-1', vout: 0 },
          { txid: 'tx-2', vout: 1 },
        ],
      },
      select: { id: true, txid: true, vout: true },
    });
  });
});
