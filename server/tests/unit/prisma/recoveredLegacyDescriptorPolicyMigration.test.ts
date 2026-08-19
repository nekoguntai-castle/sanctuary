import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readMigration = (name: string): string => readFileSync(fileURLToPath(new URL(
  `../../../prisma/migrations/${name}/migration.sql`,
  import.meta.url,
)), 'utf8');

const originalSql = readMigration('20260810010000_add_wallet_descriptor_policy');
const recoverySql = readMigration('20260818000000_add_recovered_legacy_descriptor_policy');

const constraintBody = (sql: string): string => {
  const match = /ADD CONSTRAINT "wallets_descriptor_policy_complete_check"\nCHECK \(\n([\s\S]*?)\n\);/
    .exec(sql);
  if (!match) throw new Error('descriptor policy constraint not found');
  return match[1];
};

/** Significant clause lines, ignoring comments and blank lines. */
const clauseLines = (body: string): string[] => body
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('--'));

describe('recovered legacy descriptor policy migration', () => {
  it('rewrites no data', () => {
    expect(recoverySql).not.toMatch(/^\s*(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/im);
  });

  it('records that it cannot be reversed', () => {
    // Prisma has no down migrations, and once a wallet carries the new kind the previous
    // constraint can no longer be restored. An operator reading this file must see that.
    expect(recoverySql).toMatch(/IRREVERSIBLE/i);
  });

  it('preserves every clause of the constraint it replaces', () => {
    // A `toContain` spot-check cannot detect a dropped AND. This constraint is the
    // outermost completeness guard for EVERY wallet, not just recovered ones, so each
    // original clause is asserted individually.
    const original = clauseLines(constraintBody(originalSql));
    const replacement = new Set(
      // The source-kind list gains a trailing comma when a fourth value follows it.
      clauseLines(constraintBody(recoverySql)).map((line) => line.replace(/,$/, '')),
    );

    const dropped = original
      .map((line) => line.replace(/,$/, ''))
      .filter((line) => !replacement.has(line));

    expect(dropped).toEqual([]);
  });

  it('admits the recovered kind only under exact, self-pinning evidence', () => {
    const body = constraintBody(recoverySql);

    expect(body).toContain("'recovered_legacy'");
    // sourceDescriptor is pinned equal to descriptor, so this kind can never introduce
    // descriptor bytes the wallet did not already hold.
    expect(body).toMatch(/"descriptorSourceKind" = 'recovered_legacy'\s*\n\s*AND "sourceDescriptor" = "descriptor"/);
    expect(body).toMatch(/AND "sourceChangeDescriptor" IS NULL/);
    expect(body).toMatch(/AND "sourceDescriptorChecksum" IS NULL/);
    expect(body).toMatch(/AND "sourceChangeDescriptorChecksum" IS NULL/);
  });

  it('leaves the pair kinds still requiring their second source token', () => {
    // Relaxing the new arm must not weaken the existing ones.
    expect(constraintBody(recoverySql)).toMatch(
      /"descriptorSourceKind" IN \(\s*'generated_pair',\s*'imported_pair'\s*\)\s*\n\s*AND "sourceChangeDescriptor" IS NOT NULL/,
    );
  });

  it('drops exactly one thing, and only the constraint it replaces', () => {
    // The immutability triggers and the canonical-coordinate constraints must survive
    // untouched; this migration is only widening one allowlist.
    const dropped = [...recoverySql.matchAll(
      /DROP\s+(?:CONSTRAINT|TRIGGER|FUNCTION|INDEX)\s+"([\w]+)"/gi,
    )].map((match) => match[1]);

    expect(dropped).toEqual(['wallets_descriptor_policy_complete_check']);
  });
});
