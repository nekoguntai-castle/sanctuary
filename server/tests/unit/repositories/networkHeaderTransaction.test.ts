import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../../src/generated/prisma/client';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  default: { $transaction: mocks.transaction },
}));

import { withNetworkHeaderSerializableTransaction } from '../../../src/repositories/networkHeaderTransaction';

const p2034 = () => new Prisma.PrismaClientKnownRequestError('write conflict', {
  code: 'P2034',
  clientVersion: 'test',
});

const wrappedP2010 = () => new Prisma.PrismaClientKnownRequestError('adapter conflict', {
  code: 'P2010',
  clientVersion: 'test',
  meta: {
    driverAdapterError: {
      cause: { kind: 'TransactionWriteConflict' },
    },
  },
});

describe('withNetworkHeaderSerializableTransaction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    ['P2034', p2034],
    ['adapter-wrapped P2010', wrappedP2010],
  ])('replays the whole transaction after a %s conflict', async (_label, conflict) => {
    const firstTx = { attempt: 1 };
    const secondTx = { attempt: 2 };
    const operation = vi.fn().mockResolvedValue('persisted');
    mocks.transaction
      .mockImplementationOnce(async (callback: (client: unknown) => unknown) => {
        await callback(firstTx);
        throw conflict();
      })
      .mockImplementationOnce((callback: (client: unknown) => unknown) => callback(secondTx));

    await expect(withNetworkHeaderSerializableTransaction(operation)).resolves.toBe('persisted');

    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenNthCalledWith(1, firstTx);
    expect(operation).toHaveBeenNthCalledWith(2, secondTx);
    expect(mocks.transaction).toHaveBeenLastCalledWith(operation, {
      isolationLevel: 'Serializable',
    });
  });

  it('does not retry an error that is not a serialization conflict', async () => {
    const failure = new Error('constraint failed');
    mocks.transaction.mockRejectedValue(failure);

    await expect(withNetworkHeaderSerializableTransaction(vi.fn())).rejects.toBe(failure);
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it('serializes short state transactions while allowing callers to overlap', async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    mocks.transaction
      .mockImplementationOnce(async () => {
        await firstBlocked;
        return 'first';
      })
      .mockResolvedValueOnce('second');

    const first = withNetworkHeaderSerializableTransaction(vi.fn());
    const second = withNetworkHeaderSerializableTransaction(vi.fn());
    await vi.waitFor(() => expect(mocks.transaction).toHaveBeenCalledOnce());
    expect(mocks.transaction).toHaveBeenCalledOnce();

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it('rethrows the third serialization conflict after exhausting bounded attempts', async () => {
    const failures = [p2034(), p2034(), p2034()];
    failures.forEach(failure => mocks.transaction.mockRejectedValueOnce(failure));

    await expect(withNetworkHeaderSerializableTransaction(vi.fn())).rejects.toBe(failures[2]);
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
  });
});
