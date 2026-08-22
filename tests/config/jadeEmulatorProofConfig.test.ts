import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const read = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');
const manifest = JSON.parse(read('config/jade-emulator-proof.json')) as {
  schemaVersion: number;
  platform: string;
  firmware: Record<string, string>;
  builder: { image: string };
  qemu: { configArgs: string; machine: string; serialPort: number; webDisplayPort: number };
  sdk: { cborX: string; cborXIntegrity: string };
  runtimeCompatibility: Record<string, string>;
  submodules: Array<Record<string, string>>;
};

describe('pinned Jade QEMU proof configuration', () => {
  it('pins the exact vendor source, Dockerfile, builder parent, platform, and QEMU contract', () => {
    expect(manifest).toMatchObject({ schemaVersion: 1, platform: 'linux/amd64' });
    expect(manifest.firmware.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.firmware.buildVersionTag).toBe(manifest.firmware.release);
    expect(manifest.firmware.runtimeVersion).toBe(manifest.firmware.release);
    expect(manifest.firmware.sourceTarball).toContain(manifest.firmware.sourceCommit);
    expect(manifest.firmware.sourceTarball).toMatch(/^https:\/\/codeload\.github\.com\//);
    expect(manifest.firmware.sourceTarballSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.firmware.dockerfileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.builder.image).toMatch(/^blockstream\/jade_builder@sha256:[0-9a-f]{64}$/);
    expect(manifest.submodules).toHaveLength(5);
    for (const submodule of manifest.submodules) {
      expect(submodule.path).toMatch(/^components\//);
      expect(submodule.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(submodule.sourceTarball).toContain(submodule.sourceCommit);
      expect(submodule.sourceTarball).toMatch(/^https:\/\/codeload\.github\.com\//);
      expect(submodule.sourceTarballSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest.qemu).toEqual({
      configArgs: '--dev --ci --psram',
      machine: 'esp32',
      serialPort: 30121,
      webDisplayPort: 30122,
    });
  });

  it('binds the production CBOR package and exact runner toolchain', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, { version?: string; integrity?: string }>;
    };
    expect(lock.packages['node_modules/cbor-x']).toMatchObject({
      version: manifest.sdk.cborX,
      integrity: manifest.sdk.cborXIntegrity,
    });
    expect(manifest.runtimeCompatibility.node).toBe(read('.nvmrc').trim());
    expect(JSON.parse(read('package.json')).packageManager).toBe(`npm@${manifest.runtimeCompatibility.npm}`);
  });

  it('downloads and verifies source, builds without bind mounts, and attests runtime artifacts', () => {
    const runner = read('scripts/ci/run-jade-emulator-proof.sh');
    for (const required of [
      'sourceTarballSha256',
      'scripts/ci/download-verified-source.sh',
      'dockerfileSha256',
      'FROM $expected_builder',
      'GitHub source archives omit Git metadata',
      'docker buildx build',
      '--build-arg "QEMU_CONFIG_ARGS=$config_args"',
      '/jade/build/jade.bin /jade/build/jade.elf /flash_image.bin',
      'qemu-system-xtensa',
      'JADE_EMULATOR_PROOF=1',
      'config/tooling/vitest.jade-emulator.config.ts',
      'verify-jade-junit.mjs',
      '--slurpfile verifiedJunit',
      '($verifiedJunit[0] + {',
      'proof-sources.sha256',
      'network-${network}.json',
      'cleanBoot: true',
      'controller_ready=0',
      'Jade QEMU controller did not become ready',
      'cleanBootPerNetwork: true',
      'networkProofs: [$mainnetProof[0], $testnetProof[0]]',
      'hardware-emulator-source-inventory.mjs',
      'list --vendor jade --format lines --require-clean',
      'if ! proof_sources_text=',
      'Jade proof-source inventory resolved empty',
      'scripts/ci/verify-jade-junit.mjs',
    ]) expect(runner).toContain(required);
    expect(runner).not.toContain('readonly -a proof_sources=(');
    expect(runner).not.toContain('curl --fail --location');
    expect(runner).not.toContain('testCount: 3');
    expect(runner).not.toMatch(/docker run[^\n]*(?:-v|--volume|--mount)/);
    expect(runner).not.toContain('docker build -v');
    expect(runner).not.toContain('--entrypoint qemu-system-xtensa');
    expect(runner).toContain('"$image" qemu-system-xtensa --version');
  });

  it('runs the production protocol session proof on both Bitcoin coin families', () => {
    const integration = read('tests/integration/jadeEmulator.integration.test.ts');
    expect(integration).toContain("from '../../src/services/hardwareWallet/adapters/jadeProtocol'");
    expect(integration).toContain('session.authenticate');
    expect(integration).toContain("session.rpc('get_xpub'");
    expect(integration).toContain("session.rpc('get_receive_address'");
    expect(integration).toContain('session.signPsbt');
    expect(integration).toContain('masterFingerprintFromRootXpub');
    expect(integration).toContain('assertJadeAccountXpubChain');
    expect(integration).toContain('validatePsbtSigningRequest');
    expect(integration).toContain('validateJadeSignedPsbt');
    const runner = read('scripts/ci/run-jade-emulator-proof.sh');
    expect(runner).toContain('for network in mainnet testnet');
    expect(runner).toContain('junit-jade-${network}.xml');
    expect(runner).toContain('node scripts/ci/verify-jade-junit.mjs');
  });
});
