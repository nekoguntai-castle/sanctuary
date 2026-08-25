import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import { vi } from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const MIGRATIONS_URL = new URL('../../../prisma/migrations/', import.meta.url);
const E1 = '20260822070000_add_incremental_sync_intent';
const A1 = '20260823230000_add_network_header_checkpoint';
const A2 = '20260824010000_add_header_reconciliation_state';
const A3 = '20260825010000_make_subscription_enrollment_indexable';
const NETWORKS = ['mainnet', 'testnet3', 'testnet4', 'signet', 'regtest'] as const;
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HEADER = 'ab'.repeat(80);
const OBSERVED_AT = new Date('2026-08-24T10:00:00.000Z');

interface CheckpointRow extends QueryResultRow {
  addressId: string;
  coverageGapStartedAt?: Date | null;
  lastObservedAt: Date | null;
  network: string;
  observedStatus: string | null;
  processedEnrollmentGeneration: number;
  requestedEnrollmentGeneration: number;
  statusKnown: boolean;
}

interface CoverageResult {
  ready: boolean;
  reason?: string;
  status: string;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function migrationNamesBefore(exclusiveUpperBound: string): string[] {
  return readdirSync(MIGRATIONS_URL, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map(entry => entry.name)
    .filter(name => name < exclusiveUpperBound)
    .sort();
}

function migrationSql(name: string): string {
  return readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS_URL), 'utf8');
}

async function applyMigration(pool: Pool, name: string): Promise<void> {
  await pool.query(migrationSql(name));
}

async function applyBaseline(pool: Pool): Promise<void> {
  for (const name of migrationNamesBefore(E1)) {
    await applyMigration(pool, name);
  }
}

function schemaPoolConfig(connectionString: string, schema: string): PoolConfig {
  return {
    connectionString,
    max: 2,
    options: `-c search_path=${schema}`,
  };
}

function schemaDatabaseUrl(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema}`);
  return url.toString();
}

async function reconnect(pool: Pool, connectionString: string, schema: string): Promise<Pool> {
  await pool.end();
  const next = new Pool(schemaPoolConfig(connectionString, schema));
  await next.query('SELECT 1');
  return next;
}

async function seedLegacyWallets(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT INTO "users" ("id", "username", "password", "updatedAt")
    VALUES ('rolling-owner', 'rolling-owner', 'not-used', CURRENT_TIMESTAMP)
  `);
  for (const [index, network] of NETWORKS.entries()) {
    const walletId = `wallet-${network}`;
    const addressId = `address-${network}`;
    await pool.query(`
      INSERT INTO "wallets" (
        "id", "name", "type", "scriptType", "network", "lastSyncedAt",
        "lastSyncStatus", "syncInProgress", "updatedAt"
      )
      VALUES ($1, $2, 'single_sig', 'native_segwit', $3, $4, $5, $6, CURRENT_TIMESTAMP)
    `, [
      walletId,
      `Rolling ${network}`,
      network,
      index === 0 ? new Date('2026-08-21T12:00:00.000Z') : null,
      index === 0 ? 'success' : null,
      index === 1,
    ]);
    await pool.query(`
      INSERT INTO "wallet_users" ("id", "walletId", "userId", "role")
      VALUES ($1, $2, 'rolling-owner', 'owner')
    `, [`wallet-user-${network}`, walletId]);
    await pool.query(`
      INSERT INTO "addresses" (
        "id", "walletId", "address", "derivationPath", "index", "createdAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      addressId,
      walletId,
      `rolling-address-${network}`,
      `m/84'/1'/0'/0/${index}`,
      index,
      new Date(`2026-08-21T0${index}:00:00.000Z`),
    ]);
  }
}

async function checkpoints(pool: Pool): Promise<CheckpointRow[]> {
  const coverageProjection = await columnExists(
    pool,
    'address_subscription_checkpoints',
    'coverageGapStartedAt',
  )
    ? '"coverageGapStartedAt"'
    : 'NULL::timestamp AS "coverageGapStartedAt"';
  const result = await pool.query<CheckpointRow>(`
    SELECT
      "addressId", "network", "statusKnown", "observedStatus", "lastObservedAt",
      "requestedEnrollmentGeneration", "processedEnrollmentGeneration",
      ${coverageProjection}
    FROM "address_subscription_checkpoints"
    ORDER BY "network"
  `);
  return result.rows;
}

async function columnExists(pool: Pool, table: string, column: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2
    ) AS "exists"
  `, [table, column]);
  return result.rows[0]?.exists === true;
}

async function expectDatabaseRejection(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code: expect.any(String) });
}

async function expectRejectedOrUnavailable(
  operation: () => Promise<unknown>,
  readCoverage: () => Promise<CoverageResult>,
  repair: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    expect(error).toMatchObject({ code: expect.any(String) });
    return;
  }
  try {
    await expect(readCoverage()).resolves.toMatchObject({
      status: 'unavailable',
      ready: false,
      reason: 'invalid_data',
    });
  } finally {
    await repair();
  }
}

describeWithDatabase('wallet sync rolling-upgrade migrations', () => {
  const schema = `wallet_sync_upgrade_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  let admin: Pool;
  let pool: Pool;
  let disconnectIsolatedPrisma: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    if (!databaseUrl) return;
    admin = new Pool({ connectionString: databaseUrl, max: 1 });
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    pool = new Pool(schemaPoolConfig(databaseUrl, schema));
    await applyBaseline(pool);
  }, 120_000);

  afterAll(async () => {
    if (!databaseUrl) return;
    await disconnectIsolatedPrisma?.();
    await pool?.end();
    await admin.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`);
    await admin.end();
  });

  it('preserves fail-closed sync state through the E1, A1, A2, and A3 rollout', async () => {
    if (!databaseUrl) return;
    await expect(pool.query(`SELECT to_regclass('address_subscription_checkpoints') AS value`))
      .resolves.toMatchObject({ rows: [{ value: null }] });
    await seedLegacyWallets(pool);

    await applyMigration(pool, E1);
    let checkpointRows = await checkpoints(pool);
    expect(checkpointRows).toHaveLength(NETWORKS.length);
    expect(new Set(checkpointRows.map(row => row.network))).toEqual(new Set(NETWORKS));
    expect(checkpointRows).toEqual(expect.arrayContaining(NETWORKS.map(network => (
      expect.objectContaining({
        addressId: `address-${network}`,
        network,
        statusKnown: false,
        observedStatus: null,
        lastObservedAt: null,
        requestedEnrollmentGeneration: 1,
        processedEnrollmentGeneration: 0,
      })
    ))));
    await expect(pool.query(`
      SELECT "network", "requestedIncrementalSyncGeneration" AS requested
      FROM "wallets"
      ORDER BY "network"
    `)).resolves.toMatchObject({
      rows: expect.arrayContaining([
        { network: 'mainnet', requested: 0 },
        { network: 'testnet3', requested: 1 },
        { network: 'testnet4', requested: 1 },
        { network: 'signet', requested: 1 },
        { network: 'regtest', requested: 1 },
      ]),
    });
    await pool.query(`
      UPDATE "address_subscription_checkpoints"
      SET
        "scriptHash" = $1,
        "statusKnown" = TRUE,
        "lastObservedAt" = $2,
        "processedEnrollmentGeneration" = "requestedEnrollmentGeneration"
      WHERE "addressId" = 'address-mainnet'
    `, [HASH_A, OBSERVED_AT]);
    pool = await reconnect(pool, databaseUrl, schema);
    await applyMigration(pool, A1);

    checkpointRows = await checkpoints(pool);
    const mainnetCheckpoint = checkpointRows.find(row => row.network === 'mainnet');
    expect(mainnetCheckpoint).toMatchObject({
      statusKnown: true,
      processedEnrollmentGeneration: 1,
      requestedEnrollmentGeneration: 1,
      coverageGapStartedAt: null,
    });
    for (const network of NETWORKS.filter(network => network !== 'mainnet')) {
      const row = checkpointRows.find(candidate => candidate.network === network);
      expect(row?.coverageGapStartedAt?.toISOString()).toBe(
        new Date(`2026-08-21T0${NETWORKS.indexOf(network)}:00:00.000Z`).toISOString(),
      );
    }
    await expect(pool.query('SELECT * FROM "network_header_checkpoints"'))
      .resolves.toMatchObject({ rowCount: 0, rows: [] });
    // Simulate an E1 binary that neither reads nor writes A1's gap column.
    await pool.query(`
      UPDATE "address_subscription_checkpoints"
      SET "requestedEnrollmentGeneration" = 2
      WHERE "addressId" = 'address-mainnet'
    `);
    let normalized = (await checkpoints(pool)).find(row => row.network === 'mainnet');
    expect(normalized?.coverageGapStartedAt).toBeInstanceOf(Date);
    await pool.query(`
      UPDATE "address_subscription_checkpoints"
      SET
        "statusKnown" = TRUE,
        "processedEnrollmentGeneration" = "requestedEnrollmentGeneration"
      WHERE "addressId" = 'address-mainnet'
    `);
    await pool.query(`
      UPDATE "address_subscription_checkpoints"
      SET
        "statusKnown" = TRUE,
        "processedEnrollmentGeneration" = "requestedEnrollmentGeneration"
      WHERE "addressId" = 'address-mainnet'
    `);
    normalized = (await checkpoints(pool)).find(row => row.network === 'mainnet');
    expect(normalized?.coverageGapStartedAt).toBeNull();

    await expectDatabaseRejection(pool.query(`
      INSERT INTO "network_header_checkpoints" (
        "network", "lastProcessedHeight", "lastProcessedHash", "observedAt"
      ) VALUES ('signet', -1, 'not-a-hash', $1)
    `, [OBSERVED_AT]));

    await pool.query(`
      INSERT INTO "address_subscription_comparison_failures" (
        "addressId", "enrollmentGeneration", "firstFailedAt", "lastFailedAt"
      ) VALUES ('address-regtest', 1, $1, $1)
    `, [OBSERVED_AT]);
    await pool.query(`DELETE FROM "addresses" WHERE "id" = 'address-regtest'`);
    await expect(pool.query(`
      SELECT
        (SELECT count(*)::int FROM "address_subscription_checkpoints"
          WHERE "addressId" = 'address-regtest') AS checkpoints,
        (SELECT count(*)::int FROM "address_subscription_comparison_failures"
          WHERE "addressId" = 'address-regtest') AS failures
    `)).resolves.toMatchObject({ rows: [{ checkpoints: 0, failures: 0 }] });

    pool = await reconnect(pool, databaseUrl, schema);
    await applyMigration(pool, A2);
    const previousDatabaseUrl = process.env.DATABASE_URL;
    let isolatedModules;
    try {
      process.env.DATABASE_URL = schemaDatabaseUrl(databaseUrl, schema);
      vi.resetModules();
      isolatedModules = await Promise.all([
        import('../../../src/repositories/subscriptionCoverageRepository'),
        import('../../../src/models/prisma'),
        import('../../../src/repositories/subscriptionCheckpointRepository'),
      ]);
    } finally {
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
    const [
      { readSubscriptionCoverage },
      { default: isolatedPrisma },
      { findPendingSubscriptionEnrollments },
    ] = isolatedModules;
    disconnectIsolatedPrisma = () => isolatedPrisma.$disconnect();

    await expectRejectedOrUnavailable(
      () => pool.query(`
        UPDATE "address_subscription_checkpoints"
        SET "network" = 'mainnet'
        WHERE "addressId" = 'address-signet'
      `),
      readSubscriptionCoverage,
      () => pool.query(`
        UPDATE "address_subscription_checkpoints"
        SET "network" = 'signet'
        WHERE "addressId" = 'address-signet'
      `),
    );
    await expectRejectedOrUnavailable(
      () => pool.query(`
        INSERT INTO "network_header_checkpoints" (
          "network", "lastProcessedHeight", "lastProcessedHash", "observedAt"
        ) VALUES ('unknownnet', 1, $1, $2)
      `, [HASH_A, OBSERVED_AT]),
      readSubscriptionCoverage,
      () => pool.query(`DELETE FROM "network_header_checkpoints" WHERE "network" = 'unknownnet'`),
    );
    await expectRejectedOrUnavailable(
      () => pool.query(`
      INSERT INTO "network_header_reconciliations" (
        "network", "ownerToken", "mode", "targetHeight", "targetHash",
        "targetHeaderHex", "targetObservedAt", "anchorHeight", "anchorHash"
      ) VALUES ('unknownnet', 'owner', 'forward', 2, $1, $2, $3, 0, $4)
      `, [HASH_C, HEADER, OBSERVED_AT, HASH_A]),
      readSubscriptionCoverage,
      () => pool.query(`DELETE FROM "network_header_reconciliations" WHERE "network" = 'unknownnet'`),
    );
    await expectDatabaseRejection(pool.query(`
      INSERT INTO "network_header_reconciliations" (
        "network", "ownerToken", "mode", "targetHeight", "targetHash",
        "targetHeaderHex", "targetObservedAt", "anchorHeight", "anchorHash",
        "cursorHeight", "cursorHash"
      ) VALUES ('signet', 'owner', 'forward', 2, $1, $2, $3, 0, $4, 2, $5)
    `, [HASH_C, HEADER, OBSERVED_AT, HASH_A, HASH_B]));

    await pool.query(`
      INSERT INTO "network_header_reconciliations" (
        "network", "ownerToken", "mode", "targetHeight", "targetHash",
        "targetHeaderHex", "targetObservedAt", "anchorHeight", "anchorHash",
        "cursorHeight", "cursorHash", "confirmationCursorWalletId"
      ) VALUES ('signet', 'owner-a', 'forward', 2, $1, $2, $3, 0, $4, 1, $5,
        'wallet-signet')
    `, [HASH_C, HEADER, OBSERVED_AT, HASH_A, HASH_B]);
    await pool.query(`
      INSERT INTO "network_header_reconciliation_headers" (
        "network", "height", "hash", "previousHash", "observedAt"
      ) VALUES
        ('signet', 0, $1, $1, $3),
        ('signet', 1, $2, $1, $3)
    `, [HASH_A, HASH_B, OBSERVED_AT]);
    await pool.query(`
      INSERT INTO "network_header_history" (
        "network", "height", "hash", "previousHash", "observedAt"
      ) VALUES ('signet', 0, $1, $1, $2)
    `, [HASH_A, OBSERVED_AT]);
    await pool.query(`
      INSERT INTO "network_header_confirmation_retries" ("network", "walletId")
      VALUES ('signet', 'wallet-signet')
    `);
    await expectRejectedOrUnavailable(
      () => pool.query(`
        INSERT INTO "network_header_confirmation_retries" ("network", "walletId")
        VALUES ('signet', 'wallet-mainnet')
      `),
      readSubscriptionCoverage,
      () => pool.query(`
        DELETE FROM "network_header_confirmation_retries"
        WHERE "network" = 'signet' AND "walletId" = 'wallet-mainnet'
      `),
    );

    // A process restart must retain enough partial work to continue from cursor 1.
    pool = await reconnect(pool, databaseUrl, schema);
    await expect(pool.query(`
      SELECT "ownerToken", "cursorHeight", "cursorHash", "confirmationCursorWalletId"
      FROM "network_header_reconciliations"
      WHERE "network" = 'signet'
    `)).resolves.toMatchObject({
      rows: [{
        ownerToken: 'owner-a',
        cursorHeight: 1,
        cursorHash: HASH_B,
        confirmationCursorWalletId: 'wallet-signet',
      }],
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        INSERT INTO "network_header_reconciliation_headers" (
          "network", "height", "hash", "previousHash", "observedAt"
        ) VALUES ('signet', 2, $1, $2, $3)
      `, [HASH_C, HASH_B, OBSERVED_AT]);
      await client.query(`
        UPDATE "network_header_reconciliations"
        SET "cursorHeight" = 2, "cursorHash" = $1
        WHERE "network" = 'signet' AND "ownerToken" = 'owner-a'
      `, [HASH_C]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await expect(pool.query(`
      SELECT "height", "hash" FROM "network_header_reconciliation_headers"
      WHERE "network" = 'signet' ORDER BY "height"
    `)).resolves.toMatchObject({
      rows: [
        { height: 0, hash: HASH_A },
        { height: 1, hash: HASH_B },
        { height: 2, hash: HASH_C },
      ],
    });

    await pool.query(`DELETE FROM "network_header_reconciliations" WHERE "network" = 'signet'`);
    await expect(pool.query(`
      SELECT
        (SELECT count(*)::int FROM "network_header_reconciliation_headers"
          WHERE "network" = 'signet') AS staged,
        (SELECT count(*)::int FROM "network_header_confirmation_retries"
          WHERE "network" = 'signet') AS retries,
        (SELECT count(*)::int FROM "network_header_history"
          WHERE "network" = 'signet') AS history
    `)).resolves.toMatchObject({ rows: [{ staged: 0, retries: 0, history: 1 }] });

    await pool.query(`
      INSERT INTO "wallets" (
        "id", "name", "type", "scriptType", "network", "updatedAt"
      ) VALUES (
        'wallet-legacy-testnet', 'Legacy testnet', 'single_sig',
        'native_segwit', 'testnet', CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      INSERT INTO "wallet_users" ("id", "walletId", "userId", "role")
      VALUES ('wallet-user-legacy-testnet', 'wallet-legacy-testnet', 'rolling-owner', 'owner')
    `);
    await pool.query(`
      INSERT INTO "addresses" (
        "id", "walletId", "address", "derivationPath", "index", "createdAt"
      ) VALUES (
        'pre-trigger-missing', 'wallet-legacy-testnet', 'pre-trigger-missing',
        'm/84''/1''/0''/0/10', 10, $1
      )
    `, [new Date('2026-08-25T11:00:00.000Z')]);
    await expect(pool.query(`
      SELECT count(*)::int AS count FROM "address_subscription_checkpoints"
      WHERE "addressId" = 'pre-trigger-missing'
    `)).resolves.toMatchObject({ rows: [{ count: 0 }] });

    await applyMigration(pool, A3);
    await expect(pool.query(`
      SELECT "network", "requestedEnrollmentGeneration", "processedEnrollmentGeneration"
      FROM "address_subscription_checkpoints"
      WHERE "addressId" = 'pre-trigger-missing'
    `)).resolves.toMatchObject({
      rows: [{
        network: 'testnet3',
        requestedEnrollmentGeneration: 1,
        processedEnrollmentGeneration: 0,
      }],
    });

    const checkpointAwareClient = await pool.connect();
    try {
      await checkpointAwareClient.query('BEGIN');
      await checkpointAwareClient.query(`
        INSERT INTO "addresses" (
          "id", "walletId", "address", "derivationPath", "index"
        ) VALUES (
          'checkpoint-aware-testnet', 'wallet-legacy-testnet',
          'checkpoint-aware-testnet', 'm/84''/1''/0''/0/11', 11
        )
      `);
      await checkpointAwareClient.query(`
        INSERT INTO "address_subscription_checkpoints" (
          "addressId", "network", "requestedEnrollmentGeneration",
          "processedEnrollmentGeneration"
        ) VALUES ('checkpoint-aware-testnet', 'testnet', 1, 0)
      `);
      await checkpointAwareClient.query('COMMIT');
    } catch (error) {
      await checkpointAwareClient.query('ROLLBACK');
      throw error;
    } finally {
      checkpointAwareClient.release();
    }
    await expect(pool.query(`
      SELECT "network" FROM "address_subscription_checkpoints"
      WHERE "addressId" = 'checkpoint-aware-testnet'
    `)).resolves.toMatchObject({ rows: [{ network: 'testnet3' }] });

    const addressOnlyClient = await pool.connect();
    try {
      await addressOnlyClient.query('BEGIN');
      await addressOnlyClient.query(`
        INSERT INTO "addresses" (
          "id", "walletId", "address", "derivationPath", "index"
        ) VALUES (
          'address-only-mainnet', 'wallet-mainnet', 'address-only-mainnet',
          'm/84''/0''/0''/0/12', 12
        )
      `);
      await expect(addressOnlyClient.query(`
        SELECT count(*)::int AS count FROM "address_subscription_checkpoints"
        WHERE "addressId" = 'address-only-mainnet'
      `)).resolves.toMatchObject({ rows: [{ count: 0 }] });
      await addressOnlyClient.query('COMMIT');
    } catch (error) {
      await addressOnlyClient.query('ROLLBACK');
      throw error;
    } finally {
      addressOnlyClient.release();
    }
    await expect(pool.query(`
      SELECT "network", "requestedEnrollmentGeneration", "processedEnrollmentGeneration"
      FROM "address_subscription_checkpoints"
      WHERE "addressId" = 'address-only-mainnet'
    `)).resolves.toMatchObject({
      rows: [{
        network: 'mainnet',
        requestedEnrollmentGeneration: 1,
        processedEnrollmentGeneration: 0,
      }],
    });

    pool = await reconnect(pool, databaseUrl, schema);
    await expect(findPendingSubscriptionEnrollments({ network: 'testnet3' }))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          addressId: 'checkpoint-aware-testnet',
          walletId: 'wallet-legacy-testnet',
          network: 'testnet3',
          checkpointMissing: false,
        }),
        expect.objectContaining({
          addressId: 'pre-trigger-missing',
          walletId: 'wallet-legacy-testnet',
          network: 'testnet3',
          checkpointMissing: false,
        }),
      ]));
    await expect(pool.query(`
      SELECT count(*)::int AS count
      FROM "address_subscription_checkpoints"
      WHERE "addressId" IN (
        'pre-trigger-missing', 'checkpoint-aware-testnet', 'address-only-mainnet'
      )
    `)).resolves.toMatchObject({ rows: [{ count: 3 }] });
  }, 120_000);
});
