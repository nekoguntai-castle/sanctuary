/**
 * Backup Creation
 *
 * Handles creating database backups with cursor-based pagination for large tables.
 */

import prisma, { type PrismaTxClient } from '../../models/prisma';
import { Prisma } from '../../generated/prisma/client';
import { createLogger } from '../../utils/logger';
import { version as appVersion } from '../../../package.json';
import { migrationService } from '../migrationService';
import { serializeRecord } from './serialization';
import {
  BACKUP_FORMAT_VERSION,
  COMPLETE_TABLE_POLICY_HASH,
  COMPLETE_TABLE_POLICY_VERSION,
  TABLE_ORDER,
  CACHE_TABLES,
  LARGE_TABLES,
  BACKUP_PAGE_SIZE,
} from './constants';
import type { BackupRecord, SanctuaryBackup, BackupOptions } from './types';
import { FEATURE_RUNTIME_GENERATION_KEY } from '../../repositories/operationalSystemSettings';

const log = createLogger('BACKUP:SVC');
export const BACKUP_TRANSACTION_MAX_WAIT_MS = 10_000;
export const BACKUP_TRANSACTION_TIMEOUT_MS = 10 * 60_000;

/**
 * Create a complete database backup
 * Uses cursor-based pagination for large tables to avoid OOM from loading
 * entire tables into a single Prisma response buffer.
 */
export async function createBackup(adminUser: string, options: BackupOptions = {}): Promise<SanctuaryBackup> {
  const { includeCache = false, description, signal } = options;
  signal?.throwIfAborted();

  log.info('[BACKUP] Creating backup', { adminUser, includeCache });

  return prisma.$transaction(
    (tx) => createBackupSnapshot(tx, adminUser, includeCache, description, signal),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: BACKUP_TRANSACTION_MAX_WAIT_MS,
      timeout: BACKUP_TRANSACTION_TIMEOUT_MS,
    },
  );
}

export async function createBackupSnapshot(
  client: PrismaTxClient,
  adminUser: string,
  includeCache: boolean,
  description: string | undefined,
  signal: AbortSignal | undefined,
): Promise<SanctuaryBackup> {
  const data: Record<string, BackupRecord[]> = {};
  const recordCounts: Record<string, number> = {};

  // Export all tables in dependency order
  const tablesToExport = includeCache
    ? [...TABLE_ORDER, ...CACHE_TABLES]
    : TABLE_ORDER;

  for (const table of tablesToExport) {
    signal?.throwIfAborted();
    if (LARGE_TABLES.has(table)) {
      // Cursor-based pagination for large tables to reduce peak memory
      data[table] = await exportTablePaginated(client, table, signal);
    } else {
      // Small tables: single query is fine
      // @ts-expect-error - Dynamic Prisma table access; table name validated by the canonical policy
      const records = await client[table].findMany();
      data[table] = records
        .filter((record: BackupRecord) => !isOperationalRecord(table, record))
        .map((record: BackupRecord) => serializeRecord(record));
    }
    recordCounts[table] = data[table].length;
    signal?.throwIfAborted();
    log.debug(`[BACKUP] Exported ${data[table].length} records from ${table}`);
  }

  // Get current schema version from applied migrations
  signal?.throwIfAborted();
  const schemaVersion = await migrationService.getSchemaVersion(client);
  signal?.throwIfAborted();

  const backup: SanctuaryBackup = {
    meta: {
      version: BACKUP_FORMAT_VERSION,
      appVersion,
      schemaVersion,
      createdAt: new Date().toISOString(),
      createdBy: adminUser,
      description,
      includesCache: includeCache,
      recordCounts,
      tablePolicy: {
        version: COMPLETE_TABLE_POLICY_VERSION,
        hash: COMPLETE_TABLE_POLICY_HASH,
      },
    },
    data,
  };

  const totalRecords = Object.values(recordCounts).reduce((a, b) => a + b, 0);
  log.info('[BACKUP] Backup created', { totalRecords, tables: Object.keys(data).length });

  return backup;
}

function isOperationalRecord(table: string, record: BackupRecord): boolean {
  return table === 'systemSetting' && record.key === FEATURE_RUNTIME_GENERATION_KEY;
}

/**
 * Export a table using cursor-based pagination to reduce peak memory.
 * Fetches BACKUP_PAGE_SIZE rows at a time instead of loading everything at once.
 */
async function exportTablePaginated(
  client: PrismaTxClient,
  table: string,
  signal?: AbortSignal,
): Promise<BackupRecord[]> {
  const allRecords: BackupRecord[] = [];
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    signal?.throwIfAborted();
    // @ts-expect-error - Dynamic Prisma table access; table name validated against LARGE_TABLES set
    const page: BackupRecord[] = await client[table].findMany({
      take: BACKUP_PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });

    for (const record of page) {
      allRecords.push(serializeRecord(record));
    }
    signal?.throwIfAborted();

    if (page.length < BACKUP_PAGE_SIZE) {
      break; // Last page
    }

    cursor = page[page.length - 1].id as string;
  }

  return allRecords;
}
