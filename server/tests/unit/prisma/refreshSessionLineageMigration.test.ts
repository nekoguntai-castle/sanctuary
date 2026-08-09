import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(new URL(
  '../../../prisma/migrations/20260809000000_add_refresh_session_lineage/migration.sql',
  import.meta.url
));
const migrationSql = readFileSync(migrationPath, 'utf8');

describe('refresh session lineage migration', () => {
  it('holds a refresh-writer fence through legacy invalidation and NOT NULL enforcement', () => {
    const lock = migrationSql.indexOf('LOCK TABLE "refresh_tokens" IN ACCESS EXCLUSIVE MODE');
    const versionBump = migrationSql.indexOf('SET "sessionVersion" = u."sessionVersion" + 1');
    const deleteLegacy = migrationSql.indexOf('DELETE FROM "refresh_tokens"');
    const notNull = migrationSql.indexOf('ALTER COLUMN "accessTokenJti" SET NOT NULL');

    expect(lock).toBeGreaterThanOrEqual(0);
    expect(migrationSql.indexOf('BEGIN;')).toBeLessThan(lock);
    expect(versionBump).toBeGreaterThan(lock);
    expect(deleteLegacy).toBeGreaterThan(versionBump);
    expect(notNull).toBeGreaterThan(deleteLegacy);
    expect(migrationSql.indexOf('COMMIT;')).toBeGreaterThan(notNull);
  });

  it('adds and verifies all required lineage columns and the family tombstone', () => {
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "accessTokenJti" TEXT');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "accessTokenExpiresAt" TIMESTAMP(3)');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "sessionFamilyId" TEXT');
    expect(migrationSql).toContain('OR rt."sessionFamilyId" IS NULL');
    expect(migrationSql).toContain('ALTER COLUMN "accessTokenExpiresAt" SET NOT NULL');
    expect(migrationSql.match(/"accessTokenExpiresAt" IS NULL/g))
      .toHaveLength(3);
    expect(migrationSql).toContain('ALTER COLUMN "sessionFamilyId" SET NOT NULL');
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS "revoked_refresh_session_families"');
  });
});
