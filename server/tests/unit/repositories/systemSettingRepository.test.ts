import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    systemSetting: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import prisma from '../../../src/models/prisma';
import {
  deleteByPrefix,
  deleteSetting,
  exists,
  get,
  getAll,
  getAllAsMap,
  getBoolean,
  getByPrefix,
  getJson,
  getNumber,
  getParsed,
  getValue,
  getValueOrDefault,
  set,
  setBoolean,
  setJson,
  setMany,
  setNumber,
  systemSettingRepository,
} from '../../../src/repositories/systemSettingRepository';

describe('systemSettingRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('get/getValue/getValueOrDefault fetch settings and apply defaults', async () => {
    (prisma.systemSetting.findUnique as Mock)
      .mockResolvedValueOnce({ key: 'k', value: 'v' })
      .mockResolvedValueOnce({ key: 'k', value: 'v2' })
      .mockResolvedValueOnce(null);

    await expect(get('k')).resolves.toEqual({ key: 'k', value: 'v' });
    await expect(getValue('k')).resolves.toBe('v2');
    await expect(getValueOrDefault('missing', 'fallback')).resolves.toBe('fallback');

    expect(prisma.systemSetting.findUnique).toHaveBeenNthCalledWith(1, { where: { key: 'k' } });
  });

  it('getBoolean handles true/1/false and default', async () => {
    (prisma.systemSetting.findUnique as Mock)
      .mockResolvedValueOnce({ key: 'b1', value: 'true' })
      .mockResolvedValueOnce({ key: 'b2', value: '1' })
      .mockResolvedValueOnce({ key: 'b3', value: 'false' })
      .mockResolvedValueOnce(null);

    await expect(getBoolean('b1')).resolves.toBe(true);
    await expect(getBoolean('b2')).resolves.toBe(true);
    await expect(getBoolean('b3')).resolves.toBe(false);
    await expect(getBoolean('missing', true)).resolves.toBe(true);
  });

  it('getNumber parses values and falls back to defaults', async () => {
    (prisma.systemSetting.findUnique as Mock)
      .mockResolvedValueOnce({ key: 'n1', value: '42' })
      .mockResolvedValueOnce({ key: 'n2', value: 'not-a-number' })
      .mockResolvedValueOnce(null);

    await expect(getNumber('n1')).resolves.toBe(42);
    await expect(getNumber('n2', 7)).resolves.toBe(7);
    await expect(getNumber('n3', 9)).resolves.toBe(9);
  });

  it('getJson parses valid JSON and returns default for invalid/missing', async () => {
    (prisma.systemSetting.findUnique as Mock)
      .mockResolvedValueOnce({ key: 'j1', value: '{"enabled":true}' })
      .mockResolvedValueOnce({ key: 'j2', value: '{invalid-json' })
      .mockResolvedValueOnce(null);

    await expect(getJson<{ enabled: boolean }>('j1')).resolves.toEqual({ enabled: true });
    await expect(getJson('j2', { enabled: false })).resolves.toEqual({ enabled: false });
    await expect(getJson('j3', { x: 1 })).resolves.toEqual({ x: 1 });
  });

  it('getParsed validates with Zod schema and returns default for invalid/missing', async () => {
    const { z } = await import('zod');

    (prisma.systemSetting.findUnique as Mock)
      .mockResolvedValueOnce({ key: 'n', value: '42' })
      .mockResolvedValueOnce({ key: 'n', value: '"not_a_number"' })
      .mockResolvedValueOnce(null);

    await expect(getParsed('n', z.number(), 0)).resolves.toBe(42);
    await expect(getParsed('n', z.number(), 99)).resolves.toBe(99);
    await expect(getParsed('missing', z.number(), 7)).resolves.toBe(7);
  });

  it('getAll/getByPrefix/getAllAsMap use expected queries', async () => {
    (prisma.systemSetting.findMany as Mock)
      .mockResolvedValueOnce([{ key: 'a', value: '1' }])
      .mockResolvedValueOnce([{ key: 'sync.a', value: '2' }])
      .mockResolvedValueOnce([
        { key: 'x', value: '10' },
        { key: 'y', value: '20' },
      ]);

    await expect(getAll()).resolves.toEqual([{ key: 'a', value: '1' }]);
    await expect(getByPrefix('sync.')).resolves.toEqual([{ key: 'sync.a', value: '2' }]);
    await expect(getAllAsMap()).resolves.toEqual({ x: '10', y: '20' });

    expect(prisma.systemSetting.findMany).toHaveBeenNthCalledWith(1, {
      orderBy: { key: 'asc' },
    });
    expect(prisma.systemSetting.findMany).toHaveBeenNthCalledWith(2, {
      where: { key: { startsWith: 'sync.' } },
      orderBy: { key: 'asc' },
    });
  });

  it('set and typed setters persist settings via upsert', async () => {
    (prisma.systemSetting.upsert as Mock).mockResolvedValue({ key: 'k', value: 'v' });

    await set('k', 'v');
    await setBoolean('bool.k', true);
    await setNumber('num.k', 123);
    await setJson('json.k', { a: 1 });

    expect(prisma.systemSetting.upsert).toHaveBeenNthCalledWith(1, {
      where: { key: 'k' },
      update: { value: 'v' },
      create: { key: 'k', value: 'v' },
    });
    expect(prisma.systemSetting.upsert).toHaveBeenNthCalledWith(2, {
      where: { key: 'bool.k' },
      update: { value: 'true' },
      create: { key: 'bool.k', value: 'true' },
    });
    expect(prisma.systemSetting.upsert).toHaveBeenNthCalledWith(3, {
      where: { key: 'num.k' },
      update: { value: '123' },
      create: { key: 'num.k', value: '123' },
    });
    expect(prisma.systemSetting.upsert).toHaveBeenNthCalledWith(4, {
      where: { key: 'json.k' },
      update: { value: '{"a":1}' },
      create: { key: 'json.k', value: '{"a":1}' },
    });
  });

  it('setBoolean persists false values as the string "false"', async () => {
    (prisma.systemSetting.upsert as Mock).mockResolvedValue({ key: 'bool.k', value: 'false' });

    await setBoolean('bool.k', false);

    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'bool.k' },
      update: { value: 'false' },
      create: { key: 'bool.k', value: 'false' },
    });
  });

  it('setMany executes upserts inside a transaction', async () => {
    (prisma.systemSetting.upsert as Mock).mockImplementation((args) => args);
    (prisma.$transaction as Mock).mockResolvedValue(undefined);

    await setMany([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);

    expect(prisma.systemSetting.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledWith([
      {
        where: { key: 'a' },
        update: { value: '1' },
        create: { key: 'a', value: '1' },
      },
      {
        where: { key: 'b' },
        update: { value: '2' },
        create: { key: 'b', value: '2' },
      },
    ]);
  });

  it('delete helpers and exists use expected Prisma operations', async () => {
    (prisma.systemSetting.delete as Mock).mockResolvedValueOnce(undefined);
    (prisma.systemSetting.delete as Mock).mockRejectedValueOnce(new Error('not found'));
    (prisma.systemSetting.deleteMany as Mock).mockResolvedValue({ count: 4 });
    (prisma.systemSetting.count as Mock)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    await expect(deleteSetting('k1')).resolves.toBeUndefined();
    await expect(deleteSetting('k2')).resolves.toBeUndefined();
    await expect(deleteByPrefix('sync.')).resolves.toBe(4);
    await expect(exists('k1')).resolves.toBe(true);
    await expect(exists('k2')).resolves.toBe(false);

    expect(prisma.systemSetting.delete).toHaveBeenCalledWith({ where: { key: 'k1' } });
    expect(prisma.systemSetting.deleteMany).toHaveBeenCalledWith({
      where: { key: { startsWith: 'sync.' } },
    });
    expect(prisma.systemSetting.count).toHaveBeenNthCalledWith(1, { where: { key: 'k1' } });
    expect(prisma.systemSetting.count).toHaveBeenNthCalledWith(2, { where: { key: 'k2' } });
  });

  it('exports all operations via namespace and default object', () => {
    expect(systemSettingRepository.get).toBe(get);
    expect(systemSettingRepository.set).toBe(set);
    expect(systemSettingRepository.setMany).toBe(setMany);
    expect(systemSettingRepository.deleteByPrefix).toBe(deleteByPrefix);
  });
});
