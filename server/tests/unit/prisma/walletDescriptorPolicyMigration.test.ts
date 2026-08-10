import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(fileURLToPath(new URL(
  '../../../prisma/migrations/20260810010000_add_wallet_descriptor_policy/migration.sql',
  import.meta.url,
)), 'utf8');

const schema = readFileSync(fileURLToPath(new URL(
  '../../../prisma/schema.prisma',
  import.meta.url,
)), 'utf8');

const policyColumns = [
  'changeDescriptor',
  'descriptorPolicyVersion',
  'descriptorSourceKind',
  'sourceDescriptor',
  'sourceChangeDescriptor',
  'sourceDescriptorChecksum',
  'sourceChangeDescriptorChecksum',
];

const checksumShape = '^[qpzry9x8gf2tvdw0s3jn54khce6mua7lQPZRYXGF2TVDWSJN54KHCEMUA]{8}$';

describe('wallet descriptor policy migration', () => {
  it('is additive and does not mark legacy or old create paths as verified', () => {
    expect(migrationSql).not.toMatch(/^\s*(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/im);
    expect(migrationSql).not.toMatch(/ADD COLUMN[^;]*NOT NULL/i);
    expect(migrationSql).not.toMatch(/\bDEFAULT\b/i);

    for (const column of policyColumns) {
      expect(migrationSql).toContain(`ADD COLUMN "${column}"`);
    }
  });

  it('permits only a wholly legacy-null policy or a complete version-one policy', () => {
    const checkStart = migrationSql.indexOf(
      'ADD CONSTRAINT "wallets_descriptor_policy_complete_check"',
    );
    const checkEnd = migrationSql.indexOf(
      'CREATE FUNCTION "protect_wallet_descriptor_policy"',
    );
    const check = migrationSql.slice(checkStart, checkEnd);

    expect(checkStart).toBeGreaterThanOrEqual(0);
    expect(checkEnd).toBeGreaterThan(checkStart);
    for (const column of policyColumns) {
      expect(check).toContain(`"${column}" IS NULL`);
    }
    expect(check).not.toContain('"descriptor" IS NULL');
    expect(check).toContain('"descriptorPolicyVersion" IS NOT NULL');
    expect(check).toContain('"descriptorPolicyVersion" = 1');
    expect(check).toContain('"descriptor" IS NOT NULL');
    expect(check).toContain('"fingerprint" IS NOT NULL');
    expect(check).toContain('"type" IN (\'single_sig\', \'multi_sig\')');
    expect(check).toContain('"scriptType" IN (\'legacy\', \'nested_segwit\', \'native_segwit\', \'taproot\')');
    expect(check).toContain('"network" IN (\'mainnet\', \'testnet3\', \'testnet4\', \'signet\', \'regtest\')');
    expect(check).toContain('"quorum" IS NOT NULL');
    expect(check).toContain('"totalSigners" IS NOT NULL');
    expect(check).toContain('"totalSigners" >= "quorum"');
    expect(check).toContain('"changeDescriptor" IS NOT NULL');
    expect(check).toContain('"descriptorSourceKind" IS NOT NULL');
    expect(check).toContain('"descriptorSourceKind" IN (');
    expect(check).toContain("'generated_pair'");
    expect(check).toContain("'imported_pair'");
    expect(check).toContain("'imported_multipath'");
    expect(check).toContain('"sourceDescriptor" IS NOT NULL');
  });

  it('uses explicit non-null guards for every required versioned policy field', () => {
    const checkStart = migrationSql.indexOf(
      'ADD CONSTRAINT "wallets_descriptor_policy_complete_check"',
    );
    const checkEnd = migrationSql.indexOf(
      'CREATE FUNCTION "protect_wallet_descriptor_policy"',
    );
    const check = migrationSql.slice(checkStart, checkEnd);

    for (const column of [
      'descriptorPolicyVersion',
      'descriptor',
      'fingerprint',
      'changeDescriptor',
      'descriptorSourceKind',
      'sourceDescriptor',
    ]) {
      expect(check).toContain(`"${column}" IS NOT NULL`);
    }
    expect(check).toContain('"sourceChangeDescriptor" IS NOT NULL');
  });

  it('preserves exact optional source checksums while constraining their shape', () => {
    expect(migrationSql).toContain(
      `"sourceDescriptorChecksum" ~ '${checksumShape}'`,
    );
    expect(migrationSql).toContain(
      `"sourceChangeDescriptorChecksum" ~ '${checksumShape}'`,
    );
    expect(migrationSql).toContain('"sourceDescriptorChecksum" IS NULL');
    expect(migrationSql).toContain('"sourceChangeDescriptorChecksum" IS NULL');
  });

  it('distinguishes paired sources from a single multipath source', () => {
    expect(migrationSql).toContain(
      '"descriptorSourceKind" IN (\'generated_pair\', \'imported_pair\')',
    );
    expect(migrationSql).toContain('"sourceChangeDescriptor" IS NOT NULL');
    expect(migrationSql).toContain('"descriptorSourceKind" = \'imported_multipath\'');
    expect(migrationSql).toContain('"sourceChangeDescriptor" IS NULL');
    expect(migrationSql).toContain('"sourceChangeDescriptorChecksum" IS NULL');
  });

  it('makes an assigned descriptor policy immutable while allowing wallet deletion', () => {
    expect(migrationSql).toContain('CREATE TRIGGER "wallets_protect_descriptor_policy"');
    expect(migrationSql).toContain('BEFORE UPDATE ON "wallets"');
    expect(migrationSql).toContain('OLD."descriptorPolicyVersion" IS NOT NULL');
    for (const column of [
      'descriptor',
      'fingerprint',
      'type',
      'scriptType',
      'network',
      'quorum',
      'totalSigners',
      ...policyColumns,
    ]) {
      expect(migrationSql).toContain(`NEW."${column}" IS DISTINCT FROM OLD."${column}"`);
    }
    expect(migrationSql).not.toContain('BEFORE DELETE ON "wallets"');
  });

  it('keeps every new Prisma field nullable and without an application default', () => {
    for (const column of policyColumns) {
      expect(schema).toMatch(new RegExp(`^\\s*${column}\\s+\\w+\\?`, 'm'));
      expect(schema).not.toMatch(new RegExp(`^\\s*${column}.*@default`, 'm'));
    }
  });
});
