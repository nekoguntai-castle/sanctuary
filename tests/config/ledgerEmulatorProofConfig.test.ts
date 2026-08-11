import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const manifest = JSON.parse(readFileSync(
  path.join(repoRoot, 'config/ledger-emulator/proof.json'),
  'utf8',
)) as {
  schemaVersion: number;
  platform: string;
  model: string;
  speculos: { version: string; image: string };
  builder: { image: string };
  bitcoinApp: Record<string, string>;
  sdk: { ledgerBitcoin: string; webUsbTransport: string };
};
const dockerfile = readFileSync(path.join(repoRoot, 'config/ledger-emulator/Dockerfile'), 'utf8');
const automation = readFileSync(path.join(repoRoot, 'config/ledger-emulator/automation.json'), 'utf8');
const runner = readFileSync(path.join(repoRoot, 'scripts/ci/run-ledger-emulator-proof.sh'), 'utf8');
const packageLock = JSON.parse(readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string }>;
};

describe('pinned Ledger emulator proof configuration', () => {
  it('pins every executable input and both reproducible app binaries', () => {
    expect(manifest).toMatchObject({ schemaVersion: 1, platform: 'linux/amd64', model: 'nanosp' });
    expect(manifest.speculos.image).toMatch(/^ghcr\.io\/ledgerhq\/speculos@sha256:[0-9a-f]{64}$/);
    expect(manifest.builder.image).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(manifest.bitcoinApp.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    for (const field of [
      'sourceTarballSha256',
      'mainnetElfSha256',
      'testnetElfSha256',
    ]) {
      expect(manifest.bitcoinApp[field]).toMatch(/^[0-9a-f]{64}$/);
      expect(dockerfile).toContain(manifest.bitcoinApp[field]);
    }
    expect(dockerfile).toContain(manifest.speculos.image);
    expect(dockerfile).toContain(manifest.builder.image);
    expect(dockerfile).toContain(manifest.bitcoinApp.sourceCommit);
  });

  it('binds the production SDK lock and requires automated transaction approval', () => {
    expect(packageLock.packages['node_modules/@ledgerhq/ledger-bitcoin']?.version)
      .toBe(manifest.sdk.ledgerBitcoin);
    expect(packageLock.packages['node_modules/@ledgerhq/hw-transport-webusb']?.version)
      .toBe(manifest.sdk.webUsbTransport);
    expect(automation).toContain('Sign transaction');
    expect(runner).toContain("readonly manifest='config/ledger-emulator/proof.json'");
    expect(runner).toContain('docker build');
    expect(runner).toContain('docker rm "$container"');
    expect(runner).not.toMatch(/docker run[^\n]*--publish/);
    expect(runner).toContain('LEDGER_EMULATOR_PROOF=1');
    expect(runner).toContain('proof-sources.sha256');
    expect(runner).toContain('sourceTreeState');
    expect(runner).toContain('src/services/hardwareWallet/adapters/ledger/signPsbt.ts');
    expect(runner).toContain('.github/workflows/verify-vectors.yml');
  });
});
