import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(fileURLToPath(new URL(
  '../../../prisma/migrations/20260810020000_add_canonical_address_coordinates/migration.sql',
  import.meta.url,
)), 'utf8');

const schema = readFileSync(fileURLToPath(new URL(
  '../../../prisma/schema.prisma',
  import.meta.url,
)), 'utf8');

describe('canonical address coordinate migration', () => {
  it('is additive and leaves all existing wallet and address rows legacy-null', () => {
    expect(migrationSql).not.toMatch(/^\s*(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/im);
    expect(migrationSql).not.toMatch(/ADD COLUMN[^;]*NOT NULL/i);
    expect(migrationSql).not.toMatch(/ADD COLUMN[^;]*DEFAULT/i);

    expect(migrationSql.match(/ADD COLUMN "canonicalPolicyId" TEXT/g)).toHaveLength(2);
    expect(migrationSql.match(/ADD COLUMN "canonicalPolicyVersion" INTEGER/g)).toHaveLength(2);
    expect(migrationSql).toContain('ADD COLUMN "branch" INTEGER');
    expect(migrationSql).toContain('ADD COLUMN "coordinateVersion" INTEGER');
    expect(migrationSql).toContain('ADD COLUMN "scriptPubKey" TEXT');
  });

  it('requires wallet policy identity to be wholly null or complete and versioned', () => {
    const check = migrationSql.slice(
      migrationSql.indexOf('ADD CONSTRAINT "wallets_canonical_policy_identity_complete_check"'),
      migrationSql.indexOf('ADD CONSTRAINT "addresses_canonical_coordinate_complete_check"'),
    );

    expect(check).toContain('"canonicalPolicyId" IS NULL');
    expect(check).toContain('"canonicalPolicyVersion" IS NULL');
    expect(check).toContain('"canonicalPolicyId" IS NOT NULL');
    expect(check).toContain('btrim("canonicalPolicyId") <> \'\'');
    expect(check).toContain('"canonicalPolicyVersion" >= 1');
  });

  it('permits only wholly legacy-null address evidence or complete bounded coordinates', () => {
    const check = migrationSql.slice(
      migrationSql.indexOf('ADD CONSTRAINT "addresses_canonical_coordinate_complete_check"'),
      migrationSql.indexOf('CREATE UNIQUE INDEX "addresses_walletId_branch_index_key"'),
    );

    for (const column of [
      'branch',
      'coordinateVersion',
      'canonicalPolicyId',
      'canonicalPolicyVersion',
      'scriptPubKey',
    ]) {
      expect(check).toContain(`"${column}" IS NULL`);
      expect(check).toContain(`"${column}" IS NOT NULL`);
    }
    expect(check).toContain('"coordinateVersion" = 1');
    expect(check).toContain('"branch" IN (0, 1)');
    expect(check).toContain('"index" >= 0');
    expect(check).toContain('"index" <= 2147483647');
    expect(check).toContain('btrim("canonicalPolicyId") <> \'\'');
    expect(check).toContain('"canonicalPolicyVersion" >= 1');
  });

  it('uniquely constrains only canonical wallet-relative coordinates', () => {
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "addresses_walletId_branch_index_key"',
    );
    expect(migrationSql).toContain('ON "addresses"("walletId", "branch", "index")');
    expect(migrationSql).toContain('WHERE "branch" IS NOT NULL');
  });

  it('binds canonical addresses to the exact immutable wallet policy identity', () => {
    expect(migrationSql).toContain('CREATE TRIGGER "wallets_protect_canonical_policy_identity"');
    expect(migrationSql).toContain('OLD."canonicalPolicyVersion" IS NOT NULL');
    expect(migrationSql).toContain('CREATE TRIGGER "addresses_enforce_wallet_policy_identity"');
    expect(migrationSql).toContain('BEFORE INSERT OR UPDATE ON "addresses"');
    expect(migrationSql).toContain('FROM "wallets"');
    expect(migrationSql).toContain('Address canonical policy identity does not match its wallet');
    expect(migrationSql).toContain('CREATE TRIGGER "addresses_protect_canonical_evidence"');

    for (const column of [
      'walletId',
      'address',
      'derivationPath',
      'index',
      'branch',
      'coordinateVersion',
      'canonicalPolicyId',
      'canonicalPolicyVersion',
      'scriptPubKey',
    ]) {
      expect(migrationSql).toContain(`NEW."${column}" IS DISTINCT FROM OLD."${column}"`);
    }
  });

  it('keeps every additive Prisma field nullable and without defaults', () => {
    for (const field of [
      'branch',
      'coordinateVersion',
      'canonicalPolicyId',
      'canonicalPolicyVersion',
      'scriptPubKey',
    ]) {
      expect(schema).toMatch(new RegExp(`^\\s*${field}\\s+\\w+\\?`, 'm'));
      expect(schema).not.toMatch(new RegExp(`^\\s*${field}.*@default`, 'm'));
    }
  });
});
