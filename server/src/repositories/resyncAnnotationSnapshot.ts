/**
 * Full-resync annotation snapshot.
 *
 * A full resync deletes every transaction row of the wallet and lets the
 * rebuild recreate them. User annotations live on those rows (`label`,
 * `memo`) or cascade with them (`TransactionLabel`), so they are captured in
 * the same database transaction as the delete and re-applied when the resync
 * completion is recorded. The snapshot is an `operational.` SystemSetting, so
 * it never appears in the admin settings listing or in backups.
 */

import { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import type { PrismaTxClient } from '../models/prisma';
import { safeJsonParse } from '../utils/safeJson';
import { createLogger } from '../utils/logger';
import { OPERATIONAL_SYSTEM_SETTING_PREFIX } from './operationalSystemSettings';

const log = createLogger('REPO:RESYNC_ANNOTATIONS');

/** Upper bound on annotated txids one snapshot may hold. */
export const RESYNC_ANNOTATION_SNAPSHOT_MAX_ENTRIES = 50_000;
/** Txids per restore query; keeps each bulk statement bounded. */
export const RESYNC_ANNOTATION_RESTORE_CHUNK_SIZE = 1_000;

const SNAPSHOT_KEY_PREFIX = `${OPERATIONAL_SYSTEM_SETTING_PREFIX}wallet-resync-annotations.v1:`;

const annotationEntrySchema = z.object({
  label: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  labelIds: z.array(z.string()).optional(),
});

const snapshotSchema = z.object({
  v: z.literal(1),
  walletId: z.string(),
  entries: z.record(z.string(), annotationEntrySchema),
});

type AnnotationEntry = z.infer<typeof annotationEntrySchema>;
type AnnotationSnapshot = z.infer<typeof snapshotSchema>;

/**
 * Raised when a snapshot cannot be captured safely. The reset rolls back, so
 * no transaction row is deleted; no retry can repair either condition.
 */
export class ResyncAnnotationSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResyncAnnotationSnapshotError';
  }
}

export function getResyncAnnotationSnapshotKey(walletId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${walletId}`;
}

const annotatedWhere = (walletId: string): Prisma.TransactionWhereInput => ({
  walletId,
  OR: [
    { label: { not: null } },
    { memo: { not: null } },
    { transactionLabels: { some: {} } },
  ],
});

type SnapshotRead =
  | { status: 'absent' }
  | { status: 'corrupt' }
  | { status: 'valid'; snapshot: AnnotationSnapshot };

async function readSnapshot(tx: PrismaTxClient, walletId: string): Promise<SnapshotRead> {
  const setting = await tx.systemSetting.findUnique({
    where: { key: getResyncAnnotationSnapshotKey(walletId) },
  });
  if (!setting) return { status: 'absent' };
  const snapshot = safeJsonParse(
    setting.value,
    snapshotSchema,
    null,
    'wallet resync annotation snapshot',
  );
  if (!snapshot || snapshot.walletId !== walletId) return { status: 'corrupt' };
  return { status: 'valid', snapshot };
}

async function writeSnapshot(
  tx: PrismaTxClient,
  walletId: string,
  entries: Record<string, AnnotationEntry>,
): Promise<void> {
  const key = getResyncAnnotationSnapshotKey(walletId);
  const value = JSON.stringify({ v: 1, walletId, entries } satisfies AnnotationSnapshot);
  await tx.systemSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/** Remove a wallet's snapshot; used when the wallet itself is deleted. */
export async function deleteResyncAnnotationSnapshot(
  tx: PrismaTxClient,
  walletId: string,
): Promise<void> {
  await tx.systemSetting.deleteMany({
    where: { key: getResyncAnnotationSnapshotKey(walletId) },
  });
}

/**
 * Capture every annotated transaction of the wallet, merged into any snapshot
 * left by an attempt that never completed. Must run in the reset transaction,
 * before the transaction rows are deleted.
 */
export async function captureAnnotations(tx: PrismaTxClient, walletId: string): Promise<void> {
  const existing = await readSnapshot(tx, walletId);
  if (existing.status === 'corrupt') {
    log.error('Refusing full resync: existing annotation snapshot is unreadable', { walletId });
    throw new ResyncAnnotationSnapshotError(
      `Wallet ${walletId} has an unreadable resync annotation snapshot; `
      + 'refusing to reset transactions until it is repaired',
    );
  }
  const entries = existing.status === 'valid' ? { ...existing.snapshot.entries } : {};
  const annotatedCount = await tx.transaction.count({ where: annotatedWhere(walletId) });
  if (annotatedCount === 0) return;
  const boundedCount = annotatedCount + Object.keys(entries).length;
  if (boundedCount > RESYNC_ANNOTATION_SNAPSHOT_MAX_ENTRIES) {
    log.error('Refusing full resync: too many annotated transactions to preserve', {
      walletId,
      count: boundedCount,
      max: RESYNC_ANNOTATION_SNAPSHOT_MAX_ENTRIES,
    });
    throw new ResyncAnnotationSnapshotError(
      `Wallet ${walletId} has ${boundedCount} annotated transactions, above the `
      + `${RESYNC_ANNOTATION_SNAPSHOT_MAX_ENTRIES} a full resync can preserve; `
      + 'export or clean up transaction labels and memos first',
    );
  }

  const rows = await tx.transaction.findMany({
    where: annotatedWhere(walletId),
    select: {
      txid: true,
      label: true,
      memo: true,
      transactionLabels: { select: { labelId: true } },
    },
  });
  for (const row of rows) {
    const previous = entries[row.txid] ?? {};
    const labelIds = [...new Set([
      ...(previous.labelIds ?? []),
      ...row.transactionLabels.map(link => link.labelId),
    ])];
    const label = row.label ?? previous.label ?? null;
    const memo = row.memo ?? previous.memo ?? null;
    entries[row.txid] = {
      ...(label !== null ? { label } : {}),
      ...(memo !== null ? { memo } : {}),
      ...(labelIds.length > 0 ? { labelIds } : {}),
    };
  }
  await writeSnapshot(tx, walletId, entries);
}

async function restoreChunk(
  tx: PrismaTxClient,
  walletId: string,
  txids: string[],
  entries: Record<string, AnnotationEntry>,
  liveLabelIds: ReadonlySet<string>,
): Promise<string[]> {
  const live = await tx.transaction.findMany({
    where: { walletId, txid: { in: txids } },
    select: { id: true, txid: true },
  });
  if (live.length === 0) return [];

  const textUpdates = live
    .map(row => ({ txid: row.txid, entry: entries[row.txid]! }))
    .filter(({ entry }) => entry.label != null || entry.memo != null);
  if (textUpdates.length > 0) {
    // One statement per chunk: this runs inside the bounded completion
    // transaction. COALESCE keeps any value written after the row was
    // recreated; raw SQL bypasses @updatedAt, so it is set explicitly.
    await tx.$executeRaw(Prisma.sql`
      UPDATE "transactions" AS t
      SET "label" = COALESCE(t."label", v."label"),
          "memo" = COALESCE(t."memo", v."memo"),
          "updatedAt" = now()
      FROM unnest(
        ${textUpdates.map(update => update.txid)}::text[],
        ${textUpdates.map(update => update.entry.label ?? null)}::text[],
        ${textUpdates.map(update => update.entry.memo ?? null)}::text[]
      ) AS v("txid", "label", "memo")
      WHERE t."walletId" = ${walletId}
        AND t."txid" = v."txid"
        AND ((t."label" IS NULL AND v."label" IS NOT NULL)
          OR (t."memo" IS NULL AND v."memo" IS NOT NULL))
    `);
  }

  const links = live.flatMap(row => (entries[row.txid]!.labelIds ?? [])
    .filter(labelId => liveLabelIds.has(labelId))
    .map(labelId => ({ transactionId: row.id, labelId })));
  if (links.length > 0) {
    await tx.transactionLabel.createMany({ data: links, skipDuplicates: true });
  }
  return live.map(row => row.txid);
}

/**
 * Re-apply snapshot annotations to the rows the rebuild recreated. Live values
 * win; entries whose txid was not found again stay pending for a later resync.
 * Must run in the transaction that records the resync completion.
 */
export async function restoreAnnotations(tx: PrismaTxClient, walletId: string): Promise<void> {
  const read = await readSnapshot(tx, walletId);
  if (read.status === 'absent') return;
  if (read.status === 'corrupt') {
    // Keep the row: deleting it would make the loss irreversible.
    log.error('Skipping annotation restore: snapshot is unreadable', { walletId });
    return;
  }
  const entries = { ...read.snapshot.entries };
  const txids = Object.keys(entries);
  const snapshotLabelIds = [...new Set(txids.flatMap(txid => entries[txid]!.labelIds ?? []))];
  const liveLabelIds = new Set(snapshotLabelIds.length === 0
    ? []
    : (await tx.label.findMany({
      where: { walletId, id: { in: snapshotLabelIds } },
      select: { id: true },
    })).map(label => label.id));

  for (let start = 0; start < txids.length; start += RESYNC_ANNOTATION_RESTORE_CHUNK_SIZE) {
    const chunk = txids.slice(start, start + RESYNC_ANNOTATION_RESTORE_CHUNK_SIZE);
    const restored = await restoreChunk(tx, walletId, chunk, entries, liveLabelIds);
    for (const txid of restored) delete entries[txid];
  }

  if (Object.keys(entries).length === 0) {
    await deleteResyncAnnotationSnapshot(tx, walletId);
  } else if (Object.keys(entries).length < txids.length) {
    await writeSnapshot(tx, walletId, entries);
  }
}
