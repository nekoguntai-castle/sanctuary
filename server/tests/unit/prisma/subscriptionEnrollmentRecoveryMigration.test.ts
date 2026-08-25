import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(new URL(
  '../../../prisma/migrations/20260825010000_make_subscription_enrollment_indexable/migration.sql',
  import.meta.url,
), 'utf8');

describe('subscription enrollment recovery migration', () => {
  it('backfills every address without a checkpoint from its owning wallet network', () => {
    expect(migrationSql).toContain(
      'INSERT INTO "address_subscription_checkpoints"',
    );
    expect(migrationSql).toContain(
      'INNER JOIN "wallets" AS wallet ON wallet."id" = address."walletId"',
    );
    expect(migrationSql).toContain('WHERE checkpoint."addressId" IS NULL');
    expect(migrationSql).toContain('ON CONFLICT ("addressId") DO NOTHING');
  });

  it('normalizes address-only rolling-version inserts in the same transaction', () => {
    expect(migrationSql).toContain(
      'CREATE FUNCTION "ensure_address_subscription_checkpoint"()',
    );
    expect(migrationSql).toContain(
      "CASE WHEN wallet.\"network\" = 'testnet' THEN 'testnet3' ELSE wallet.\"network\" END",
    );
    expect(migrationSql).toContain('WHERE wallet."id" = NEW."walletId"');
    expect(migrationSql).toContain(
      'CREATE CONSTRAINT TRIGGER "ensure_address_subscription_checkpoint"',
    );
    expect(migrationSql).toContain('AFTER INSERT ON "addresses"');
    expect(migrationSql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migrationSql).toContain(
      'EXECUTE FUNCTION "ensure_address_subscription_checkpoint"()',
    );
  });

  it('applies the backfill and trigger atomically', () => {
    expect(migrationSql).toMatch(/\nBEGIN;[\s\S]+\nCOMMIT;\s*$/);
    expect(migrationSql.indexOf('CREATE CONSTRAINT TRIGGER'))
      .toBeLessThan(migrationSql.lastIndexOf('INSERT INTO "address_subscription_checkpoints"'));
  });
});
