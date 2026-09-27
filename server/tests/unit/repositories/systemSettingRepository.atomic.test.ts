import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), findMany: vi.fn(), upsert: vi.fn() }));
vi.mock('../../../src/models/prisma', () => ({ default: { $transaction: mocks.transaction } }));
import * as repository from '../../../src/repositories/systemSettingRepository';
import { Prisma } from '../../../src/generated/prisma/client';
const conflict = (code: string) => new Prisma.PrismaClientKnownRequestError('conflict', {
  code, clientVersion: 'test', meta: { driverAdapterError: { cause: { kind: 'TransactionWriteConflict' } } },
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async operation => operation({ systemSetting: { findMany: mocks.findMany, upsert: mocks.upsert } }));
  mocks.findMany.mockResolvedValue([]);
});
it('derives from a filtered snapshot and returns the committed resulting snapshot', async () => {
  const before = [{ key: 'confirmationThreshold', value: '1' }];
  const after = [{ key: 'confirmationThreshold', value: '6' }];
  mocks.findMany.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
  const derive = vi.fn(() => after);
  expect(await repository.updateAtomically(derive)).toEqual(after);
  expect(derive).toHaveBeenCalledWith(before);
  expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  expect(mocks.findMany).toHaveBeenCalledWith({ where: { key: { not: { startsWith: 'operational.' } } }, orderBy: { key: 'asc' } });
  expect(mocks.upsert).toHaveBeenCalledWith({ where: { key: 'confirmationThreshold' }, update: { value: '6' }, create: after[0] });
});
it('supports first setup and empty derived updates', async () => {
  await expect(repository.updateAtomically(() => [])).resolves.toEqual([]);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it('rejects every operational output before writing any rows', async () => {
  await expect(repository.updateAtomically(() => [{ key: 'okay', value: '1' }, { key: 'operational.secret', value: '2' }])).rejects.toThrow();
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it.each(['P2034', 'P2010'])('replays the complete derivation with fresh state on %s', async code => {
  mocks.findMany.mockResolvedValueOnce([{ key: 'n', value: '1' }]).mockResolvedValueOnce([{ key: 'n', value: '2' }]).mockResolvedValueOnce([{ key: 'n', value: '3' }]);
  mocks.upsert.mockRejectedValueOnce(conflict(code));
  const derive = vi.fn(rows => [{ key: 'n', value: String(Number(rows[0].value) + 1) }]);
  await expect(repository.updateAtomically(derive)).resolves.toEqual([{ key: 'n', value: '3' }]);
  expect(derive.mock.calls.map(([rows]) => rows[0].value)).toEqual(['1', '2']);
});
it('bounds conflicts to three attempts', async () => {
  mocks.transaction.mockRejectedValue(conflict('P2034'));
  await expect(repository.updateAtomically(() => [])).rejects.toMatchObject({ statusCode: 409 });
  expect(mocks.transaction).toHaveBeenCalledTimes(3);
});
it('does not retry other database or derivation failures', async () => {
  const failure = new Error('derive failed');
  await expect(repository.updateAtomically(() => { throw failure; })).rejects.toBe(failure);
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
});

it('replays derivation from a new snapshot after a raw commit conflict', async () => {
  let attempt = 0;
  mocks.transaction.mockImplementation(async operation => {
    attempt += 1;
    let value = String(attempt);
    const result = await operation({ systemSetting: {
      findMany: async () => [{ key: 'n', value }],
      upsert: async (args: { update: { value: string } }) => {
        mocks.upsert(args);
        value = args.update.value;
      },
    } });
    if (attempt === 1) {
      throw Object.assign(new Error('commit conflict'), {
        name: 'DriverAdapterError',
        cause: { kind: 'TransactionWriteConflict', originalCode: '40001' },
      });
    }
    return result;
  });
  const derive = vi.fn(rows => [{ key: 'n', value: String(Number(rows[0].value) + 1) }]);
  await expect(repository.updateAtomically(derive)).resolves.toEqual([{ key: 'n', value: '3' }]);
  expect(derive.mock.calls.map(([rows]) => rows[0].value)).toEqual(['1', '2']);
  expect(mocks.upsert).toHaveBeenLastCalledWith({ where: { key: 'n' }, update: { value: '3' }, create: { key: 'n', value: '3' } });
});
