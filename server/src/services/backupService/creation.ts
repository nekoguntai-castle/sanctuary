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
  LARGE_TABLE_CURSOR_FIELDS,
  BACKUP_PAGE_SIZE,
} from './constants';
import type { BackupMeta, BackupRecord, SanctuaryBackup, BackupOptions } from './types';
import {
  STALE_WALLET_SCHEDULE_FORBIDDEN_KEY,
  WALLET_SYNC_ACTIVATION_KEY,
  isOperationalSystemSettingKey,
} from '../../repositories/operationalSystemSettings';
import { parseStaleWalletScheduleTombstone } from '../../repositories/walletSyncSchedulePolicyRepository';
import {
  assertCurrentBinarySupportsWalletSyncActivation,
  parseWalletSyncActivation,
} from '../../repositories/walletSyncActivationPolicyRepository';

const log = createLogger('BACKUP:SVC');
export const BACKUP_TRANSACTION_MAX_WAIT_MS = 10_000;
export const BACKUP_TRANSACTION_TIMEOUT_MS = 10 * 60_000;

/**
 * Receives the serialized backup document in order. Each call is awaited, so a
 * slow destination applies backpressure instead of buffering the backup.
 */
export type BackupChunkWriter = (chunk: string) => Promise<void>;

/**
 * Create a complete database backup
 * Uses cursor-based pagination for large tables to avoid OOM from loading
 * entire tables into a single Prisma response buffer.
 */
export async function createBackup(adminUser: string, options: BackupOptions = {}): Promise<SanctuaryBackup> {
  const request = resolveRequest(adminUser, options);
  return inBackupSnapshot(request, (tx) => createBackupSnapshot(
    tx,
    request.adminUser,
    request.includeCache,
    request.description,
    request.signal,
  ));
}

/**
 * Write a complete database backup as JSON without holding it in memory.
 *
 * Peak memory is one export page, so the size of the database no longer
 * bounds the heap. Building the whole document and serializing it at once
 * exhausted the worker's heap on an install with ~800k transaction outputs. The
 * document parses to the same `SanctuaryBackup` as `createBackup`; only the
 * key order differs, because `meta.recordCounts` is known once `data` is
 * written.
 */
export async function writeBackup(
  adminUser: string,
  write: BackupChunkWriter,
  options: BackupOptions = {},
): Promise<BackupMeta> {
  const request = resolveRequest(adminUser, options);
  return inBackupSnapshot(request, (tx) => writeBackupSnapshot(tx, write, request));
}

interface BackupRequest {
  adminUser: string;
  includeCache: boolean;
  description: string | undefined;
  signal: AbortSignal | undefined;
}

function resolveRequest(adminUser: string, options: BackupOptions): BackupRequest {
  return {
    adminUser,
    includeCache: options.includeCache ?? false,
    description: options.description,
    signal: options.signal,
  };
}

async function inBackupSnapshot<T>(
  request: BackupRequest,
  run: (tx: PrismaTxClient) => Promise<T>,
): Promise<T> {
  request.signal?.throwIfAborted();

  log.info('[BACKUP] Creating backup', { adminUser: request.adminUser, includeCache: request.includeCache });

  return prisma.$transaction(run, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    maxWait: BACKUP_TRANSACTION_MAX_WAIT_MS,
    timeout: BACKUP_TRANSACTION_TIMEOUT_MS,
  });
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

  for (const table of tablesToExport(includeCache)) {
    const records: BackupRecord[] = [];
    for await (const page of exportTablePages(client, table, signal)) {
      for (const record of page) records.push(record);
    }
    data[table] = records;
    recordCounts[table] = records.length;
    log.debug(`[BACKUP] Exported ${records.length} records from ${table}`);
  }

  const meta = await buildBackupMeta(client, { adminUser, includeCache, description, signal }, recordCounts);
  return { meta, data };
}

async function writeBackupSnapshot(
  client: PrismaTxClient,
  write: BackupChunkWriter,
  request: BackupRequest,
): Promise<BackupMeta> {
  const { includeCache, signal } = request;
  const recordCounts: Record<string, number> = {};

  await write('{"data":{');
  let firstTable = true;
  for (const table of tablesToExport(includeCache)) {
    await write(`${firstTable ? '' : ','}${JSON.stringify(table)}:[`);
    firstTable = false;
    let count = 0;
    for await (const page of exportTablePages(client, table, signal)) {
      if (page.length === 0) continue;
      // One string per page: the page array's JSON without its brackets.
      await write(`${count === 0 ? '' : ','}${JSON.stringify(page).slice(1, -1)}`);
      count += page.length;
    }
    await write(']');
    recordCounts[table] = count;
    log.debug(`[BACKUP] Exported ${count} records from ${table}`);
  }

  const meta = await buildBackupMeta(client, request, recordCounts);
  await write(`},"meta":${JSON.stringify(meta)}}`);
  return meta;
}

function tablesToExport(includeCache: boolean): readonly string[] {
  // Export all tables in dependency order
  return includeCache ? [...TABLE_ORDER, ...CACHE_TABLES] : TABLE_ORDER;
}

async function buildBackupMeta(
  client: PrismaTxClient,
  { adminUser, includeCache, description, signal }: BackupRequest,
  recordCounts: Record<string, number>,
): Promise<BackupMeta> {
  // Get current schema version from applied migrations
  signal?.throwIfAborted();
  const schemaVersion = await migrationService.getSchemaVersion(client);
  signal?.throwIfAborted();

  const totalRecords = Object.values(recordCounts).reduce((a, b) => a + b, 0);
  log.info('[BACKUP] Backup created', { totalRecords, tables: Object.keys(recordCounts).length });

  return {
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
  };
}

function isOperationalRecord(table: string, record: BackupRecord): boolean {
  if (table !== 'systemSetting' || typeof record.key !== 'string') return false;
  if (record.key === STALE_WALLET_SCHEDULE_FORBIDDEN_KEY) {
    validateOperationalSettingValue(
      record,
      parseStaleWalletScheduleTombstone,
      'Invalid durable stale-wallet schedule tombstone',
    );
    return false;
  }
  if (record.key === WALLET_SYNC_ACTIVATION_KEY) {
    validateWalletSyncActivationRecord(record);
    return false;
  }
  return isOperationalSystemSettingKey(record.key);
}

function validateOperationalSettingValue(
  record: BackupRecord,
  parse: (value: string) => unknown,
  invalidMessage: string,
): void {
  if (typeof record.value !== 'string') throw new Error(invalidMessage);
  parse(record.value);
}

function validateWalletSyncActivationRecord(record: BackupRecord): void {
  if (typeof record.value !== 'string') {
    throw new Error('Invalid durable wallet-sync activation policy');
  }
  const activation = parseWalletSyncActivation(record.value);
  assertCurrentBinarySupportsWalletSyncActivation(activation);
}

/**
 * Yield a table's serialized records one page at a time.
 * Large tables use cursor pagination (BACKUP_PAGE_SIZE rows per query); small
 * tables are read in one query.
 */
async function* exportTablePages(
  client: PrismaTxClient,
  table: string,
  signal?: AbortSignal,
): AsyncGenerator<BackupRecord[]> {
  signal?.throwIfAborted();
  if (!LARGE_TABLES.has(table)) {
    // @ts-expect-error - Dynamic Prisma table access; table name validated by the canonical policy
    const records: BackupRecord[] = await client[table].findMany();
    signal?.throwIfAborted();
    yield records
      .filter(record => !isOperationalRecord(table, record))
      .map(record => serializeRecord(record));
    return;
  }

  // This branch is taken only for LARGE_TABLES, which is derived from this map.
  const cursorField = LARGE_TABLE_CURSOR_FIELDS.get(table)!;
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    signal?.throwIfAborted();
    // @ts-expect-error - Dynamic Prisma table access; table name validated against LARGE_TABLES set
    const page: BackupRecord[] = await client[table].findMany({
      take: BACKUP_PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { [cursorField]: cursor } } : {}),
      orderBy: { [cursorField]: 'asc' },
    });
    signal?.throwIfAborted();

    yield page.map(record => serializeRecord(record));

    if (page.length < BACKUP_PAGE_SIZE) {
      return; // Last page
    }

    const nextCursor = page[page.length - 1][cursorField];
    if (typeof nextCursor !== 'string' || nextCursor.length === 0) {
      throw new Error(`Backup pagination cursor ${table}.${cursorField} must be a non-empty string`);
    }
    cursor = nextCursor;
  }
}
