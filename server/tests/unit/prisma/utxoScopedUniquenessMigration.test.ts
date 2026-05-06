import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20260506001000_scope_utxo_uniqueness_to_wallet/migration.sql',
  ),
  'utf8',
);

describe('utxo scoped uniqueness migration', () => {
  it('replaces global outpoint uniqueness with wallet-scoped uniqueness', () => {
    expect(migrationSql).toContain('DROP INDEX IF EXISTS "utxos_txid_vout_key";');
    expect(migrationSql).toContain(
      'CREATE INDEX IF NOT EXISTS "utxos_txid_vout_idx" ON "utxos"("txid", "vout");',
    );
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "utxos_walletId_txid_vout_key" ON "utxos"("walletId", "txid", "vout");',
    );
  });
});
