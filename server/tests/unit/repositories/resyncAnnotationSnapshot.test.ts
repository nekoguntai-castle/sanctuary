import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => loggerMocks,
}));

import {
  captureAnnotations,
  deleteResyncAnnotationSnapshot,
  getResyncAnnotationSnapshotKey,
  RESYNC_ANNOTATION_RESTORE_CHUNK_SIZE,
  RESYNC_ANNOTATION_SNAPSHOT_MAX_ENTRIES,
  ResyncAnnotationSnapshotError,
  restoreAnnotations,
} from '../../../src/repositories/resyncAnnotationSnapshot';
import type { PrismaTxClient } from '../../../src/models/prisma';

const WALLET_ID = 'wallet-1';
const KEY = 'operational.wallet-resync-annotations.v1:wallet-1';
const tx = mockPrismaClient as unknown as PrismaTxClient;

type Entry = { label?: string | null; memo?: string | null; labelIds?: string[] };

function storeSnapshot(entries: Record<string, Entry>, walletId = WALLET_ID): void {
  mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
    key: KEY,
    value: JSON.stringify({ v: 1, walletId, entries }),
  });
}

function upsertedEntries(): Record<string, Entry> {
  const call = mockPrismaClient.systemSetting.upsert.mock.calls.at(-1)?.[0];
  expect(call).toMatchObject({ where: { key: KEY }, create: { key: KEY } });
  expect(call.create.value).toBe(call.update.value);
  return JSON.parse(call.update.value).entries;
}

/** Answer each chunk lookup with a live row for every txid in `present`. */
function liveRows(present: ReadonlySet<string>): void {
  mockPrismaClient.transaction.findMany.mockImplementation(async (args: {
    where: { txid: { in: string[] } };
  }) => args.where.txid.in
    .filter(txid => present.has(txid))
    .map(txid => ({ id: `id-${txid}`, txid })));
}

describe('resyncAnnotationSnapshot', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);
  });

  it('keys the snapshot under the operational prefix per wallet', () => {
    expect(getResyncAnnotationSnapshotKey(WALLET_ID)).toBe(KEY);
  });

  it('deletes only the wallet snapshot setting', async () => {
    await deleteResyncAnnotationSnapshot(tx, WALLET_ID);

    expect(mockPrismaClient.systemSetting.deleteMany).toHaveBeenCalledWith({
      where: { key: KEY },
    });
  });

  describe('captureAnnotations', () => {
    it('writes nothing when the wallet has no annotated transactions', async () => {
      mockPrismaClient.transaction.count.mockResolvedValue(0);

      await captureAnnotations(tx, WALLET_ID);

      expect(mockPrismaClient.transaction.count).toHaveBeenCalledWith({
        where: {
          walletId: WALLET_ID,
          OR: [
            { label: { not: null } },
            { memo: { not: null } },
            { transactionLabels: { some: {} } },
          ],
        },
      });
      expect(mockPrismaClient.transaction.findMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.systemSetting.upsert).not.toHaveBeenCalled();
    });

    it('merges live annotations over a leftover snapshot and unions label ids', async () => {
      storeSnapshot({
        a: { label: 'old', memo: 'old memo', labelIds: ['L1'] },
        b: { label: 'kept' },
      });
      mockPrismaClient.transaction.count.mockResolvedValue(3);
      mockPrismaClient.transaction.findMany.mockResolvedValue([
        { txid: 'a', label: 'new', memo: null, transactionLabels: [{ labelId: 'L2' }, { labelId: 'L1' }] },
        { txid: 'c', label: null, memo: 'c memo', transactionLabels: [] },
        { txid: 'd', label: null, memo: null, transactionLabels: [{ labelId: 'L3' }] },
      ]);

      await captureAnnotations(tx, WALLET_ID);

      expect(upsertedEntries()).toEqual({
        a: { label: 'new', memo: 'old memo', labelIds: ['L1', 'L2'] },
        b: { label: 'kept' },
        c: { memo: 'c memo' },
        d: { labelIds: ['L3'] },
      });
    });

    it.each([
      ['unparseable JSON', '{not json'],
      ['a schema mismatch', JSON.stringify({ v: 2, walletId: WALLET_ID, entries: {} })],
      ['another wallet', JSON.stringify({ v: 1, walletId: 'wallet-2', entries: {} })],
    ])('refuses to overwrite a snapshot holding %s', async (_case, value) => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ key: KEY, value });

      await expect(captureAnnotations(tx, WALLET_ID))
        .rejects.toBeInstanceOf(ResyncAnnotationSnapshotError);

      expect(loggerMocks.error).toHaveBeenCalledWith(
        expect.stringContaining('unreadable'),
        { walletId: WALLET_ID },
      );
      expect(mockPrismaClient.transaction.count).not.toHaveBeenCalled();
      expect(mockPrismaClient.systemSetting.upsert).not.toHaveBeenCalled();
    });

    it('accepts exactly the entry cap counted with the leftover snapshot', async () => {
      storeSnapshot({ a: { label: 'a' } });
      mockPrismaClient.transaction.count.mockResolvedValue(RESYNC_ANNOTATION_SNAPSHOT_MAX_ENTRIES - 1);
      mockPrismaClient.transaction.findMany.mockResolvedValue([]);

      await captureAnnotations(tx, WALLET_ID);

      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledOnce();
      expect(mockPrismaClient.systemSetting.upsert).toHaveBeenCalledOnce();
    });

    it('fails closed above the entry cap before loading any row', async () => {
      storeSnapshot({ a: { label: 'a' } });
      mockPrismaClient.transaction.count.mockResolvedValue(RESYNC_ANNOTATION_SNAPSHOT_MAX_ENTRIES);

      const rejection = await captureAnnotations(tx, WALLET_ID).catch(error => error);

      expect(rejection).toBeInstanceOf(ResyncAnnotationSnapshotError);
      expect((rejection as Error).message).toMatch(/export or clean up transaction labels and memos/);
      expect(loggerMocks.error).toHaveBeenCalledWith(
        expect.stringContaining('too many annotated transactions'),
        {
          walletId: WALLET_ID,
          count: RESYNC_ANNOTATION_SNAPSHOT_MAX_ENTRIES + 1,
          max: RESYNC_ANNOTATION_SNAPSHOT_MAX_ENTRIES,
        },
      );
      expect(mockPrismaClient.transaction.findMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.systemSetting.upsert).not.toHaveBeenCalled();
    });
  });

  describe('restoreAnnotations', () => {
    it('does nothing without a snapshot', async () => {
      await restoreAnnotations(tx, WALLET_ID);

      expect(mockPrismaClient.transaction.findMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.systemSetting.deleteMany).not.toHaveBeenCalled();
    });

    it('logs and keeps a corrupt snapshot in place', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({ key: KEY, value: 'null' });

      await expect(restoreAnnotations(tx, WALLET_ID)).resolves.toBeUndefined();

      expect(loggerMocks.error).toHaveBeenCalledWith(
        expect.stringContaining('unreadable'),
        { walletId: WALLET_ID },
      );
      expect(mockPrismaClient.transaction.findMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.systemSetting.deleteMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.systemSetting.upsert).not.toHaveBeenCalled();
    });

    it('deletes an empty snapshot without querying transactions', async () => {
      storeSnapshot({});

      await restoreAnnotations(tx, WALLET_ID);

      expect(mockPrismaClient.label.findMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.transaction.findMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.systemSetting.deleteMany).toHaveBeenCalledWith({
        where: { key: KEY },
      });
    });

    it('bulk-updates text annotations with COALESCE and null-padded arrays', async () => {
      storeSnapshot({
        both: { label: 'rent', memo: 'March' },
        labelOnly: { label: 'payroll' },
        memoOnly: { memo: 'gift', label: null },
        linkOnly: { labelIds: ['L1'] },
      });
      mockPrismaClient.label.findMany.mockResolvedValue([{ id: 'L1' }]);
      liveRows(new Set(['both', 'labelOnly', 'memoOnly', 'linkOnly']));

      await restoreAnnotations(tx, WALLET_ID);

      expect(mockPrismaClient.label.findMany).toHaveBeenCalledWith({
        where: { walletId: WALLET_ID, id: { in: ['L1'] } },
        select: { id: true },
      });
      expect(mockPrismaClient.$executeRaw).toHaveBeenCalledOnce();
      const sql = mockPrismaClient.$executeRaw.mock.calls[0]![0];
      const text = sql.strings.join('?');
      expect(text).toContain('UPDATE "transactions" AS t');
      expect(text).toContain('COALESCE(t."label", v."label")');
      expect(text).toContain('COALESCE(t."memo", v."memo")');
      expect(text).toContain('"updatedAt" = now()');
      expect(sql.values).toEqual([
        ['both', 'labelOnly', 'memoOnly'],
        ['rent', 'payroll', null],
        ['March', null, 'gift'],
        WALLET_ID,
      ]);
      expect(mockPrismaClient.transactionLabel.createMany).toHaveBeenCalledWith({
        data: [{ transactionId: 'id-linkOnly', labelId: 'L1' }],
        skipDuplicates: true,
      });
      expect(mockPrismaClient.systemSetting.deleteMany).toHaveBeenCalledWith({
        where: { key: KEY },
      });
    });

    it('skips label ids deleted since capture and link-free entries', async () => {
      storeSnapshot({ a: { labelIds: ['L1', 'L-deleted'] }, b: { labelIds: ['L-deleted'] } });
      mockPrismaClient.label.findMany.mockResolvedValue([{ id: 'L1' }]);
      liveRows(new Set(['a', 'b']));

      await restoreAnnotations(tx, WALLET_ID);

      expect(mockPrismaClient.$executeRaw).not.toHaveBeenCalled();
      expect(mockPrismaClient.transactionLabel.createMany).toHaveBeenCalledWith({
        data: [{ transactionId: 'id-a', labelId: 'L1' }],
        skipDuplicates: true,
      });
    });

    it('keeps entries whose txid was not recreated', async () => {
      storeSnapshot({ found: { memo: 'found' }, missing: { label: 'missing' } });
      liveRows(new Set(['found']));

      await restoreAnnotations(tx, WALLET_ID);

      expect(mockPrismaClient.label.findMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.transactionLabel.createMany).not.toHaveBeenCalled();
      expect(upsertedEntries()).toEqual({ missing: { label: 'missing' } });
      expect(mockPrismaClient.systemSetting.deleteMany).not.toHaveBeenCalled();
    });

    it('leaves the snapshot untouched when no txid was recreated', async () => {
      storeSnapshot({ missing: { label: 'missing' } });
      liveRows(new Set());

      await restoreAnnotations(tx, WALLET_ID);

      expect(mockPrismaClient.$executeRaw).not.toHaveBeenCalled();
      expect(mockPrismaClient.systemSetting.upsert).not.toHaveBeenCalled();
      expect(mockPrismaClient.systemSetting.deleteMany).not.toHaveBeenCalled();
    });

    it.each([
      [RESYNC_ANNOTATION_RESTORE_CHUNK_SIZE, 1],
      [RESYNC_ANNOTATION_RESTORE_CHUNK_SIZE + 1, 2],
    ])('restores %i txids in %i chunk(s)', async (count, chunks) => {
      const txids = Array.from({ length: count }, (_, index) => `tx-${index}`);
      storeSnapshot(Object.fromEntries(txids.map(txid => [txid, { label: txid }])));
      liveRows(new Set(txids));

      await restoreAnnotations(tx, WALLET_ID);

      expect(RESYNC_ANNOTATION_RESTORE_CHUNK_SIZE).toBe(1_000);
      expect(mockPrismaClient.transaction.findMany).toHaveBeenCalledTimes(chunks);
      expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(chunks);
      const chunkSizes = mockPrismaClient.transaction.findMany.mock.calls
        .map(([args]) => args.where.txid.in.length);
      expect(chunkSizes).toEqual(chunks === 1 ? [1_000] : [1_000, 1]);
      expect(mockPrismaClient.systemSetting.deleteMany).toHaveBeenCalledOnce();
    });
  });
});
