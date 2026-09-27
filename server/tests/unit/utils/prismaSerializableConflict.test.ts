import { describe, expect, it } from 'vitest';
import { Prisma } from '../../../src/generated/prisma/client';
import { isSerializableTransactionConflict } from '../../../src/utils/prismaSerializableConflict';

function adapterError(cause: unknown, name = 'DriverAdapterError'): Error {
  return Object.assign(new Error('adapter failure'), { name, cause });
}

describe('isSerializableTransactionConflict', () => {
  it.each(['40001', '40P01'])('recognizes raw PostgreSQL conflict %s', code => {
    expect(isSerializableTransactionConflict(adapterError({
      kind: 'TransactionWriteConflict', originalCode: code,
    }))).toBe(true);
  });
  it.each(['P2034', 'P2010'])('preserves Prisma conflict %s', code => {
    const error = new Prisma.PrismaClientKnownRequestError('conflict', {
      code, clientVersion: 'test',
      meta: { driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } } },
    });
    expect(isSerializableTransactionConflict(error)).toBe(true);
  });
  it.each([
    undefined, null, '40001', new Error('40001 TransactionWriteConflict'),
    { name: 'DriverAdapterError', cause: { kind: 'TransactionWriteConflict', originalCode: '40001' } },
    adapterError(null), adapterError(undefined), adapterError('40001'),
    adapterError({ originalCode: '40001' }),
    adapterError({ kind: 'TransactionWriteConflict' }),
    adapterError({ kind: 'TransactionWriteConflict', originalCode: 40001 }),
    adapterError({ kind: 'TransactionWriteConflict', originalCode: '23505' }),
    adapterError({ kind: 'UniqueConstraintViolation', originalCode: '40001' }),
    adapterError({ kind: 'TransactionWriteConflict', originalCode: '40001' }, 'Error'),
    new Prisma.PrismaClientKnownRequestError('query error', { code: 'P2010', clientVersion: 'test' }),
    new Prisma.PrismaClientKnownRequestError('unique error', { code: 'P2002', clientVersion: 'test' }),
  ])('rejects unrelated or malformed error %#', error => {
    expect(isSerializableTransactionConflict(error)).toBe(false);
  });
});
