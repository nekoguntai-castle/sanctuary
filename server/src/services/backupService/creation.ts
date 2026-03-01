/**
 * Backup Creation
 *
 * Handles creating database backups with cursor-based pagination for large tables.
 */

import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { version as appVersion } from '../../../package.json';
import { migrationService } from '../migrationService';
import { serializeRecord } from './serialization';
import { BACKUP_FORMAT_VERSION, TABLE_ORDER, CACHE_TABLES, LARGE_TABLES, BACKUP_PAGE_SIZE } from './constants';
import type { BackupRecord, SanctuaryBackup, BackupOptions } from './types';

const log = createLogger('BACKUP');

/**
 * Create a complete database backup
 * Uses cursor-based pagination for large tables to avoid OOM from loading
 * entire tables into a single Prisma response buffer.
 */
export async function createBackup(adminUser: string, options: BackupOptions = {}): Promise<SanctuaryBackup> {
  const { includeCache = false, description } = options;

  log.info('[BACKUP] Creating backup', { adminUser, includeCache });

  const data: Record<string, BackupRecord[]> = {};
  const recordCounts: Record<string, number> = {};

  // Export all tables in dependency order
  const tablesToExport = includeCache
    ? [...TABLE_ORDER, ...CACHE_TABLES]
    : TABLE_ORDER;

  for (const table of tablesToExport) {
    try {
      if (LARGE_TABLES.has(table)) {
        // Cursor-based pagination for large tables to reduce peak memory
        data[table] = await exportTablePaginated(table);
      } else {
        // Small tables: single query is fine
        // @ts-expect-error - Dynamic Prisma table access; table name validated against TABLE_ORDER constant
        const records = await prisma[table].findMany();
        data[table] = records.map((record: BackupRecord) => serializeRecord(record));
      }
      recordCounts[table] = data[table].length;
      log.debug(`[BACKUP] Exported ${data[table].length} records from ${table}`);
    } catch (error) {
      log.warn(`[BACKUP] Failed to export table ${table}`, { error: String(error) });
      data[table] = [];
      recordCounts[table] = 0;
    }
  }

  // Get current schema version from applied migrations
  const schemaVersion = await migrationService.getSchemaVersion();

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
    },
    data,
  };

  const totalRecords = Object.values(recordCounts).reduce((a, b) => a + b, 0);
  log.info('[BACKUP] Backup created', { totalRecords, tables: Object.keys(data).length });

  return backup;
}

/**
 * Export a table using cursor-based pagination to reduce peak memory.
 * Fetches BACKUP_PAGE_SIZE rows at a time instead of loading everything at once.
 */
async function exportTablePaginated(table: string): Promise<BackupRecord[]> {
  const allRecords: BackupRecord[] = [];
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // @ts-expect-error - Dynamic Prisma table access; table name validated against LARGE_TABLES set
    const page: BackupRecord[] = await prisma[table].findMany({
      take: BACKUP_PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    });

    for (const record of page) {
      allRecords.push(serializeRecord(record));
    }

    if (page.length < BACKUP_PAGE_SIZE) {
      break; // Last page
    }

    cursor = page[page.length - 1].id as string;
  }

  return allRecords;
}
