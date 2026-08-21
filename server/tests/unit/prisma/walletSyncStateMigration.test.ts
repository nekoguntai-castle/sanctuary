import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SYNC_EXECUTION_OWNER_VALUES,
  WALLET_SYNC_FAILURE_CLASS_VALUES,
} from '@sanctuary/shared/constants/sync';

const migrationSql = readFileSync(fileURLToPath(new URL(
  '../../../prisma/migrations/20260820000000_add_wallet_sync_state/migration.sql',
  import.meta.url,
)), 'utf8');

const checkValues = (name: string): string[] => {
  const match = new RegExp(
    `ADD CONSTRAINT "${name}"\\nCHECK \\(\\n([\\s\\S]*?)\\n\\)(?:,|;)`,
  ).exec(migrationSql);
  if (!match) throw new Error(`constraint not found: ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1]);
};

describe('wallet sync state migration', () => {
  it('adds the structured current-state columns with safe defaults', () => {
    expect(migrationSql).toContain('ADD COLUMN "syncExecutionOwner" TEXT');
    expect(migrationSql).toContain('ADD COLUMN "syncRetryCount" INTEGER NOT NULL DEFAULT 0');
    expect(migrationSql).toContain('ADD COLUMN "syncNextRetryAt" TIMESTAMP(3)');
    expect(migrationSql).toContain('ADD COLUMN "syncStartedAt" TIMESTAMP(3)');
    expect(migrationSql).toContain('ADD COLUMN "syncStateVersion" INTEGER NOT NULL DEFAULT 0');
    expect(migrationSql).toContain('ADD COLUMN "lastSyncFailureClass" TEXT');
  });

  it('keeps execution owner and failure class aligned with the shared contracts', () => {
    expect(checkValues('wallets_sync_execution_owner_check')).toEqual(
      SYNC_EXECUTION_OWNER_VALUES,
    );
    expect(checkValues('wallets_sync_failure_class_check')).toEqual(
      WALLET_SYNC_FAILURE_CLASS_VALUES,
    );
  });

  it('bounds retry count and the monotonic state version', () => {
    expect(migrationSql).toMatch(/"syncRetryCount" >= 0\s+AND "syncRetryCount" <= 2147483647/);
    expect(migrationSql).toMatch(/"syncStateVersion" >= 0\s+AND "syncStateVersion" <= 2147483647/);
  });

  it('recovers a bounded legacy retry count as inline-owned state', () => {
    expect(migrationSql).toMatch(
      /SET\s+"syncExecutionOwner" = 'inline',\s+"syncRetryCount" = LEAST\(/,
    );
    expect(migrationSql).toContain("WHERE \"lastSyncStatus\" = 'retrying'");
    expect(migrationSql).toContain('[1-9][0-9]{0,9}');
  });

  it('backfills every bounded failure class without rewriting readable errors', () => {
    expect(migrationSql).toContain('SET "lastSyncFailureClass" = CASE');
    expect(migrationSql).toContain('WHERE "lastSyncError" IS NOT NULL');
    expect(migrationSql).not.toMatch(/SET\s+"lastSyncError"/i);
  });

  it('indexes owner recovery and due retry queries', () => {
    expect(migrationSql).toContain(
      'ON "wallets"("syncExecutionOwner", "syncInProgress")',
    );
    expect(migrationSql).toContain(
      'ON "wallets"("lastSyncStatus", "syncNextRetryAt")',
    );
  });
});
