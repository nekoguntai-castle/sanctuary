import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(fileURLToPath(new URL(
  '../../../prisma/migrations/20260822070000_add_incremental_sync_intent/migration.sql',
  import.meta.url,
)), 'utf8');

describe('wallet sync intent compatibility migration', () => {
  it('is atomic so interrupted deployment cannot leave a partial compatibility floor', () => {
    expect(migrationSql.trimStart().startsWith('--')).toBe(true);
    expect(migrationSql).toMatch(/\nBEGIN;\s*\n\s*ALTER TABLE/);
    expect(migrationSql.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('adds bounded generations and coherent UUID lease evidence', () => {
    expect(migrationSql).toContain('ADD COLUMN "requestedIncrementalSyncGeneration" INTEGER NOT NULL DEFAULT 0');
    expect(migrationSql).toContain('ADD COLUMN "claimedIncrementalSyncGeneration" INTEGER NOT NULL DEFAULT 0');
    expect(migrationSql).toContain('ADD COLUMN "processedIncrementalSyncGeneration" INTEGER NOT NULL DEFAULT 0');
    expect(migrationSql).toContain('ADD COLUMN "incrementalSyncLeaseToken" UUID');
    expect(migrationSql).toMatch(
      /processedIncrementalSyncGeneration"\s+AND "processedIncrementalSyncGeneration" <= "claimedIncrementalSyncGeneration"\s+AND "claimedIncrementalSyncGeneration" <= "requestedIncrementalSyncGeneration"/,
    );
    expect(migrationSql).toMatch(
      /"incrementalSyncLeaseToken" IS NOT NULL[\s\S]*"incrementalSyncLeaseExpiresAt" > "incrementalSyncClaimedAt"/,
    );
  });

  it('preserves ambiguous legacy work without fabricating a live claim', () => {
    expect(migrationSql).toContain('SET "requestedIncrementalSyncGeneration" = 1');
    expect(migrationSql).toContain('"lastSyncedAt" IS NULL');
    expect(migrationSql).toContain('"syncInProgress" = TRUE');
    expect(migrationSql).toContain('"lastSyncStatus" <> \'success\'');
    expect(migrationSql).toContain('SET "syncActionRequiredAt" = "updatedAt"');
    expect(migrationSql).not.toMatch(/SET\s+"claimedIncrementalSyncGeneration"/);
  });

  it('separates full-resync preparation from proven rebuild completion', () => {
    expect(migrationSql).toContain(
      '"preparedFullResyncGeneration" = "processedFullResyncGeneration"',
    );
    expect(migrationSql).toMatch(
      /WHEN "lastSyncedAt" IS NOT NULL THEN "processedFullResyncGeneration"\s+ELSE 0/,
    );
    expect(migrationSql).toMatch(
      /0 <= "preparedFullResyncGeneration"\s+AND "preparedFullResyncGeneration" <= "requestedFullResyncGeneration"/,
    );
    expect(migrationSql).not.toContain(
      '"processedFullResyncGeneration" <= "preparedFullResyncGeneration"',
    );
  });

  it('backfills unknown checkpoints without conflating unknown and null status', () => {
    expect(migrationSql).toContain('CREATE TABLE "address_subscription_checkpoints"');
    expect(migrationSql).toContain('"statusKnown" BOOLEAN NOT NULL DEFAULT FALSE');
    expect(migrationSql).toContain('"observedStatus" TEXT');
    expect(migrationSql).toMatch(
      /"statusKnown" = FALSE\s+AND "observedStatus" IS NULL\s+AND "lastObservedAt" IS NULL/,
    );
    expect(migrationSql).toMatch(
      /SELECT "addresses"\."id", "wallets"\."network", 1, 0/,
    );
  });

  it('indexes only pending wallet and enrollment populations', () => {
    expect(migrationSql).toContain('"wallets_incremental_sync_pending_cursor_idx"');
    expect(migrationSql).toContain('"wallets_incremental_sync_retry_due_idx"');
    expect(migrationSql).toContain('"wallets_incremental_sync_lease_expiry_idx"');
    expect(migrationSql).toContain('"address_subscription_checkpoints_pending_enrollment_idx"');
    expect(migrationSql).toMatch(
      /WHERE "requestedIncrementalSyncGeneration" > "processedIncrementalSyncGeneration"\s+AND "syncActionRequiredAt" IS NULL/,
    );
  });
});
