import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20260506000000_scope_address_uniqueness_to_wallet/migration.sql',
  ),
  'utf8',
);

describe('address scoped uniqueness migration', () => {
  it('replaces the global address uniqueness index with wallet-scoped uniqueness', () => {
    expect(migrationSql).toContain('DROP INDEX IF EXISTS "addresses_address_key";');
    expect(migrationSql).toContain(
      'CREATE INDEX IF NOT EXISTS "addresses_address_idx" ON "addresses"("address");',
    );
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "addresses_walletId_address_key" ON "addresses"("walletId", "address");',
    );
  });
});
