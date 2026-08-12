import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(fileURLToPath(new URL(
  '../../../prisma/migrations/20260811000000_add_wallet_remediation_evidence/migration.sql',
  import.meta.url,
)), 'utf8');

const schema = readFileSync(fileURLToPath(new URL(
  '../../../prisma/schema.prisma',
  import.meta.url,
)), 'utf8');

const proposalModel = schema.slice(
  schema.indexOf('model WalletRemediationProposal'),
  schema.indexOf('model WalletRemediationEvent'),
);

const migrationFunction = (name: string): string => {
  const start = migrationSql.indexOf(`CREATE OR REPLACE FUNCTION "${name}"`);
  const end = migrationSql.indexOf('$$ LANGUAGE plpgsql;', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return migrationSql.slice(start, end);
};

describe('wallet remediation evidence migration', () => {
  it('is additive and performs no wallet-data rewrite', () => {
    expect(migrationSql).not.toMatch(/^\s*(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/im);
    expect(migrationSql).not.toMatch(/ALTER\s+TABLE\s+"(?:wallets|wallet_devices|addresses)"\s+ADD\s+COLUMN/i);
    expect(migrationSql).toContain('CREATE TABLE "wallet_remediation_proposals"');
    expect(migrationSql).toContain('CREATE TABLE "wallet_remediation_events"');
  });

  it('uses content-addressed proposal identity without wallet or user deletion cascades', () => {
    expect(migrationSql).toContain('"id" = \'wallet-remediation-v1:\' || "proposalDigest"');
    expect(migrationSql).toContain('"proposalDigest" ~ \'^[0-9a-f]{64}$\'');
    expect(migrationSql).toContain('"schemaVersion" = \'sanctuary.wallet-remediation.v1\'');
    expect(migrationSql).not.toMatch(/FOREIGN KEY \("walletId"\)/);
    expect(migrationSql).not.toMatch(/FOREIGN KEY \("(?:createdByUserId|actorUserId)"\)/);
    expect(schema).not.toMatch(/walletId\s+String\s+@relation/);
    expect(migrationSql).toContain('FOREIGN KEY ("proposalId", "proposalDigest")');
    expect(migrationSql).toContain(
      'REFERENCES "wallet_remediation_proposals"("id", "proposalDigest")',
    );
  });

  it('makes proposal and event rows immutable and terminal state unique', () => {
    expect(migrationSql).toContain('BEFORE UPDATE OR DELETE ON "wallet_remediation_proposals"');
    expect(migrationSql).toContain('BEFORE UPDATE OR DELETE ON "wallet_remediation_events"');
    expect(migrationSql).toContain('WHERE "kind" IN (\'approved_applied\', \'cancelled\')');
    expect(migrationSql).toContain('ON DELETE RESTRICT ON UPDATE RESTRICT');
    expect(migrationSql).toContain('"sequence" = 1 AND "previousEventDigest" IS NULL');
    expect(migrationSql).toMatch(
      /"sequence" > 1\s+AND "previousEventDigest" IS NOT NULL\s+AND "previousEventDigest" ~ '\^\[0-9a-f\]\{64\}\$'/,
    );
  });

  it('models proposal state as an append-only event stream', () => {
    expect(schema).toContain('model WalletRemediationProposal');
    expect(schema).toContain('model WalletRemediationEvent');
    expect(schema).toContain('events WalletRemediationEvent[]');
    expect(schema).toContain('@@unique([walletId, proposalDigest])');
    expect(schema).toContain('@@unique([proposalId, sequence])');
    expect(proposalModel).not.toMatch(/\bstatus\s+String/);
  });

  it('blocks descriptor and canonical-policy identity mutation during proof assignment', () => {
    const descriptorGuard = migrationFunction('protect_wallet_descriptor_policy');
    const canonicalGuard = migrationFunction('protect_wallet_canonical_policy_identity');
    expect(descriptorGuard).toContain('OLD."descriptorPolicyVersion" IS NULL');
    expect(descriptorGuard).toContain('NEW."descriptorPolicyVersion" IS NOT NULL');
    expect(descriptorGuard).toContain('AND OLD."descriptor" IS NOT NULL');
    expect(canonicalGuard).toContain('OLD."canonicalPolicyVersion" IS NULL');
    expect(canonicalGuard).toContain('NEW."canonicalPolicyVersion" IS NOT NULL');
    expect(canonicalGuard).toContain('AND OLD."descriptor" IS NOT NULL');
    for (const column of [
      'descriptor', 'fingerprint', 'type', 'scriptType', 'network', 'quorum', 'totalSigners',
    ]) {
      expect(descriptorGuard).toContain(`NEW."${column}" IS DISTINCT FROM OLD."${column}"`);
      expect(canonicalGuard).toContain(`NEW."${column}" IS DISTINCT FROM OLD."${column}"`);
    }
    for (const column of [
      'changeDescriptor',
      'descriptorSourceKind',
      'sourceDescriptor',
      'sourceChangeDescriptor',
      'sourceDescriptorChecksum',
      'sourceChangeDescriptorChecksum',
    ]) {
      expect(descriptorGuard).toContain(`OLD."${column}" IS NOT NULL`);
      expect(descriptorGuard).toContain(`NEW."${column}" IS DISTINCT FROM OLD."${column}"`);
    }
    expect(canonicalGuard).toContain('OLD."canonicalPolicyId" IS NOT NULL');
    expect(canonicalGuard).toContain(
      'NEW."canonicalPolicyId" IS DISTINCT FROM OLD."canonicalPolicyId"',
    );
  });

  it('blocks wallet-device identity mutation during signer proof assignment', () => {
    const signerGuard = migrationFunction('protect_wallet_device_signer_snapshot');
    expect(signerGuard).toContain('OLD."signerBindingVersion" IS NULL');
    expect(signerGuard).toContain('NEW."signerBindingVersion" IS NOT NULL');
    expect(signerGuard).toContain('NEW."walletId" IS DISTINCT FROM OLD."walletId"');
    expect(signerGuard).toContain('NEW."deviceId" IS DISTINCT FROM OLD."deviceId"');
    for (const column of [
      'deviceAccountId',
      'signerIndex',
      'signerFingerprint',
      'signerXpub',
      'signerDerivationPath',
      'signerPurpose',
      'signerScriptType',
    ]) {
      expect(signerGuard).toContain(`OLD."${column}" IS NOT NULL`);
      expect(signerGuard).toContain(`NEW."${column}" IS DISTINCT FROM OLD."${column}"`);
    }
  });

  it('blocks address identity mutation during coordinate proof assignment', () => {
    const addressGuard = migrationFunction('protect_address_canonical_evidence');
    expect(addressGuard).toContain('OLD."coordinateVersion" IS NULL');
    expect(addressGuard).toContain('NEW."coordinateVersion" IS NOT NULL');
    for (const column of ['walletId', 'address', 'derivationPath', 'index']) {
      expect(addressGuard).toContain(`NEW."${column}" IS DISTINCT FROM OLD."${column}"`);
    }
    for (const column of [
      'branch', 'canonicalPolicyId', 'canonicalPolicyVersion', 'scriptPubKey',
    ]) {
      expect(addressGuard).toContain(`OLD."${column}" IS NOT NULL`);
      expect(addressGuard).toContain(`NEW."${column}" IS DISTINCT FROM OLD."${column}"`);
    }
  });
});
