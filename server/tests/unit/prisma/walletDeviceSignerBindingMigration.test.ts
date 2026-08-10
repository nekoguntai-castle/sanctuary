import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(fileURLToPath(new URL(
  '../../../prisma/migrations/20260810000000_add_wallet_device_signer_bindings/migration.sql',
  import.meta.url,
)), 'utf8');

const schema = readFileSync(fileURLToPath(new URL(
  '../../../prisma/schema.prisma',
  import.meta.url,
)), 'utf8');

describe('wallet device signer binding migration', () => {
  it('is additive and deliberately leaves every existing link legacy-null', () => {
    expect(migrationSql).not.toMatch(/^\s*(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/im);
    expect(migrationSql).not.toMatch(/ADD COLUMN[^;]*NOT NULL/i);

    for (const column of [
      'deviceAccountId',
      'signerBindingVersion',
      'signerFingerprint',
      'signerXpub',
      'signerDerivationPath',
      'signerPurpose',
      'signerScriptType',
    ]) {
      expect(migrationSql).toContain(`ADD COLUMN "${column}"`);
    }
  });

  it('binds an optional account only when it belongs to the linked device', () => {
    expect(migrationSql).toContain('CREATE UNIQUE INDEX "device_accounts_id_deviceId_key"');
    expect(migrationSql).toContain('ON "device_accounts"("id", "deviceId")');
    expect(migrationSql).toContain('FOREIGN KEY ("deviceAccountId", "deviceId")');
    expect(migrationSql).toContain('REFERENCES "device_accounts"("id", "deviceId")');
    expect(migrationSql).toContain('ON DELETE RESTRICT ON UPDATE RESTRICT');
    expect(migrationSql).toContain('CREATE INDEX "wallet_devices_deviceAccountId_idx"');
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "wallet_devices_bound_walletId_signerIndex_key"',
    );
    expect(migrationSql).toContain('ON "wallet_devices"("walletId", "signerIndex")');
    expect(migrationSql).toContain('WHERE "signerBindingVersion" = 1');
  });

  it('permits only a wholly legacy-null row or a complete version-one snapshot', () => {
    const checkStart = migrationSql.indexOf(
      'ADD CONSTRAINT "wallet_devices_signer_snapshot_complete_check"',
    );
    const checkEnd = migrationSql.indexOf(
      'CREATE FUNCTION "protect_wallet_device_signer_snapshot"',
    );
    const check = migrationSql.slice(checkStart, checkEnd);

    expect(checkStart).toBeGreaterThanOrEqual(0);
    expect(check).toContain('"deviceAccountId" IS NULL');
    expect(check).toContain('"signerBindingVersion" IS NOT NULL');
    expect(check).toContain('"signerBindingVersion" = 1');
    expect(check).toContain('"signerIndex" IS NOT NULL');
    expect(check).toContain('"signerIndex" >= 0');
    expect(check).not.toContain('"signerIndex" IS NULL');
    for (const column of [
      'signerFingerprint',
      'signerXpub',
      'signerDerivationPath',
      'signerPurpose',
      'signerScriptType',
    ]) {
      expect(check).toContain(`"${column}" IS NULL`);
      expect(check).toContain(`"${column}" IS NOT NULL`);
    }
    expect(check).not.toContain('"deviceAccountId" IS NOT NULL');
  });

  it('makes a completed snapshot immutable while leaving unlink deletion unguarded', () => {
    expect(migrationSql).toContain('CREATE TRIGGER "wallet_devices_protect_signer_snapshot"');
    expect(migrationSql).toContain('BEFORE UPDATE ON "wallet_devices"');
    for (const column of [
      'walletId',
      'deviceId',
      'deviceAccountId',
      'signerIndex',
      'signerBindingVersion',
      'signerFingerprint',
      'signerXpub',
      'signerDerivationPath',
      'signerPurpose',
      'signerScriptType',
    ]) {
      expect(migrationSql).toContain(`NEW."${column}" IS DISTINCT FROM OLD."${column}"`);
    }
    expect(migrationSql).not.toContain('BEFORE DELETE ON "wallet_devices"');
  });

  it('rejects bound account identity mutation and bound device deletion', () => {
    expect(migrationSql).toContain('CREATE TRIGGER "device_accounts_protect_bound_identity_update"');
    expect(migrationSql).toContain('BEFORE UPDATE ON "device_accounts"');
    expect(migrationSql).toContain('CREATE TRIGGER "device_accounts_protect_bound_identity_delete"');
    expect(migrationSql).toContain('BEFORE DELETE ON "device_accounts"');
    expect(migrationSql).toContain('WHERE "deviceAccountId" = OLD."id"');
    for (const column of ['id', 'deviceId', 'purpose', 'scriptType', 'derivationPath', 'xpub']) {
      expect(migrationSql).toContain(`NEW."${column}" IS NOT DISTINCT FROM OLD."${column}"`);
    }

    expect(migrationSql).toContain('CREATE TRIGGER "devices_protect_bound_signer_delete"');
    expect(migrationSql).toContain('BEFORE DELETE ON "devices"');
    expect(migrationSql).toContain('AND "signerBindingVersion" IS NOT NULL');
  });

  it('keeps the Prisma composite relation aligned with the database constraints', () => {
    expect(schema).toContain('walletBindings WalletDevice[]');
    expect(schema).toContain('@@unique([id, deviceId])');
    expect(schema).toContain(
      'deviceAccount DeviceAccount? @relation(fields: [deviceAccountId, deviceId], references: [id, deviceId], onDelete: Restrict, onUpdate: Restrict)',
    );
    expect(schema).toContain('@@index([deviceAccountId])');
  });
});
