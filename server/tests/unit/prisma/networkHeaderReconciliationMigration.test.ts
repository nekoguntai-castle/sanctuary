import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(new URL(
  '../../../prisma/migrations/20260824010000_add_header_reconciliation_state/migration.sql',
  import.meta.url,
), 'utf8');

const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');

describe('network header reconciliation migration', () => {
  it('creates separate resumable work, staged proof, and canonical history tables atomically', () => {
    expect(migrationSql).toContain('CREATE TABLE "network_header_reconciliations"');
    expect(migrationSql).toContain('CREATE TABLE "network_header_reconciliation_headers"');
    expect(migrationSql).toContain('CREATE TABLE "network_header_history"');
    expect(migrationSql).toMatch(/\nBEGIN;[\s\S]+\nCOMMIT;\s*$/);
  });

  it('fences one reconciliation generation and coherent optional cursor per network', () => {
    expect(migrationSql).toContain('PRIMARY KEY ("network")');
    expect(migrationSql).toContain('"network_header_reconciliations_generation_check"');
    expect(migrationSql).toContain('"generation" >= 1 AND "generation" <= 2147483647');
    expect(migrationSql).toContain('"network_header_reconciliations_cursor_check"');
    expect(migrationSql).toContain('("cursorHeight" IS NULL) = ("cursorHash" IS NULL)');
    expect(migrationSql).toContain('"cursorHeight" <= "targetHeight"');
    expect(migrationSql).toContain(
      '"cursorHeight" < "targetHeight" OR "cursorHash" = "targetHash"',
    );
    expect(migrationSql).toContain(
      '"network_header_reconciliations_retryEligibleAt_network_idx"',
    );
    expect(migrationSql).toContain('"consecutiveFailureCount" INTEGER NOT NULL DEFAULT 0');
    expect(migrationSql).toContain('"network_header_reconciliations_failure_count_check"');
    expect(migrationSql).toContain('"confirmationCursorWalletId" TEXT');
    expect(migrationSql).toContain('"network_header_reconciliations_confirmation_cursor_check"');
    expect(migrationSql).toMatch(/"confirmationEnumerationComplete" BOOLEAN NOT NULL DEFAULT (?:false|FALSE)/);
    for (const column of [
      'pendingTargetHeight',
      'pendingTargetHash',
      'pendingTargetPreviousHash',
      'pendingTargetHeaderHex',
      'pendingTargetObservedAt',
      'pendingTargetGenesisHash',
    ]) {
      expect(migrationSql).toContain(`"${column}"`);
    }
    expect(migrationSql).toContain('"network_header_reconciliations_pending_target_check"');
  });

  it('persists wallet-scoped confirmation retries with reconciliation and wallet cascades', () => {
    expect(migrationSql).toContain('CREATE TABLE "network_header_confirmation_retries"');
    expect(migrationSql).toContain('PRIMARY KEY ("network", "walletId")');
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("network"\) REFERENCES "network_header_reconciliations"\("network"\)[\s\S]+ON DELETE CASCADE/,
    );
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("walletId"\) REFERENCES "wallets"\("id"\)[\s\S]+ON DELETE CASCADE/,
    );
  });

  it('bounds modes, retry evidence, heights, hashes, and the exact 80-byte target header', () => {
    for (const value of ['forward', 'ancestor_search', 'genesis_rebuild']) {
      expect(migrationSql).toContain(`'${value}'`);
    }
    for (const value of [
      'endpoint_unavailable',
      'validation_failed',
      'confirmation_failed',
      'ownership_lost',
    ]) {
      expect(migrationSql).toContain(`'${value}'`);
    }
    expect(migrationSql).toContain('"targetHeaderHex" ~ \'^[0-9A-Fa-f]{160}$\'');
    expect(migrationSql.match(/\^\[0-9a-f\]\{64\}\$/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migrationSql).toContain('"height" >= 0 AND "height" <= 2147483647');
  });

  it('cascades staged proof with its active work but preserves canonical history independently', () => {
    expect(migrationSql).toMatch(
      /FOREIGN KEY \("network"\) REFERENCES "network_header_reconciliations"\("network"\)[\s\S]+ON DELETE CASCADE/,
    );
    const historyDdl = migrationSql.slice(migrationSql.indexOf('CREATE TABLE "network_header_history"'));
    expect(historyDdl).not.toContain('REFERENCES "network_header_reconciliations"');
    expect(migrationSql).toContain('"network_header_history_network_hash_idx"');
  });

  it('keeps partial proof separate from the authoritative checkpoint in the Prisma schema', () => {
    expect(schema).toMatch(/model NetworkHeaderCheckpoint \{[\s\S]+@@map\("network_header_checkpoints"\)/);
    expect(schema).toMatch(/model NetworkHeaderReconciliation \{[\s\S]+@@map\("network_header_reconciliations"\)/);
    expect(schema).toMatch(/model NetworkHeaderReconciliationHeader \{[\s\S]+onDelete: Cascade[\s\S]+@@id\(\[network, height\]\)/);
    expect(schema).toMatch(/model NetworkHeaderHistory \{[\s\S]+@@id\(\[network, height\]\)[\s\S]+@@index\(\[network, hash\]\)/);
    expect(schema).toMatch(/model NetworkHeaderConfirmationRetry \{[\s\S]+@@id\(\[network, walletId\]\)[\s\S]+@@map\("network_header_confirmation_retries"\)/);
    expect(schema).toMatch(/confirmationRetries\s+NetworkHeaderConfirmationRetry\[\]/);
  });
});
