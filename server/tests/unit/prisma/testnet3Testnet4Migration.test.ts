import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20260505000000_explicit_testnet3_testnet4_support/migration.sql',
  ),
  'utf8',
);

describe('explicit testnet3/testnet4 migration', () => {
  it('migrates legacy testnet rows to testnet3 and adds independent testnet4 config fields', () => {
    expect(migrationSql).toMatch(/UPDATE "wallets"\s+SET "network" = 'testnet3'\s+WHERE "network" = 'testnet';/);
    expect(migrationSql).toMatch(/UPDATE "electrum_servers"\s+SET "network" = 'testnet3'\s+WHERE "network" = 'testnet';/);
    expect(migrationSql).toMatch(/UPDATE "node_configs"\s+SET "network" = 'testnet3'\s+WHERE "network" = 'testnet';/);
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "testnet3Enabled" BOOLEAN');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "testnet4Enabled" BOOLEAN');
    expect(migrationSql).toContain('"testnet3SingletonHost" = COALESCE("testnetSingletonHost", \'electrum.blockstream.info\')');
    expect(migrationSql).toContain('ADD COLUMN IF NOT EXISTS "testnet4SingletonHost" TEXT');
    expect(migrationSql).not.toContain('"testnet4SingletonHost" = COALESCE("testnetSingletonHost"');
  });
});
