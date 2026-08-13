import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const productionRoots = [
  'server/src',
  'src',
  'shared',
  'gateway/src',
];
const explicitLegacyAllowlist = new Set([
  // BitBox signing remains capability-blocked until its physical account proof
  // is implemented. PR4 removes this fallback before enabling the adapter.
  'src/services/hardwareWallet/adapters/bitbox/signPsbt.ts',
]);

const sourceFiles = (relativePath: string): string[] => {
  const absolutePath = path.join(repoRoot, relativePath);
  if (relativePath.endsWith('.ts')) return [absolutePath];
  return readdirSync(absolutePath, { withFileTypes: true }).flatMap(entry => {
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.tsx?$/.test(entry.name) ? [path.join(repoRoot, child)] : [];
  });
};

describe('address derivation boundary policy', () => {
  it('does not permit implicit account origins or permissive coordinate parsers', () => {
    const violations: string[] = [];
    const banned = [
      /\bgetAccountPath\b/,
      /\bextractChangeAndAddressIndex\b/,
      /\bfindAccountPathEnd\b/,
      /account\s*:\s*number\s*=\s*0/,
      /derivationPath\s*(?:\|\||\?\?)\s*(?:getDerivationPath|getMultisigDerivationPath)/,
    ];
    for (const filename of productionRoots.flatMap(sourceFiles)) {
      const source = readFileSync(filename, 'utf8');
      const relative = path.relative(repoRoot, filename);
      if (banned.some(pattern => pattern.test(source)) && !explicitLegacyAllowlist.has(relative)) {
        violations.push(relative);
      }
    }
    expect(violations).toEqual([]);
  });

  it('exposes low-level single-sig derivation only as wallet-relative output', () => {
    const barrel = readFileSync(
      path.join(repoRoot, 'server/src/services/bitcoin/addressDerivation/index.ts'),
      'utf8',
    );
    expect(barrel).toContain('deriveRelativeAddress');
    expect(barrel).not.toMatch(/\bderiveAddress\b/);
    expect(barrel).not.toMatch(/\bderiveAddresses\b/);
    expect(barrel).not.toContain('deriveMultisigAddress');
    expect(barrel).not.toContain('deriveRelativeMultisigAddress');
    expect(barrel).not.toContain('deriveAddressFromParsedDescriptor');
  });
});
