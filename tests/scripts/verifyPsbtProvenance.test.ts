import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertPinnedCoreExecution,
  PSBT_PROOF_MANIFEST,
} from '../../scripts/verify-psbt/provenance';

const repoRoot = join(import.meta.dirname, '../..');
const originalMode = process.env.VERIFY_PSBT_CORE_PROVENANCE_MODE;
const originalImage = process.env.VERIFY_PSBT_CORE_IMAGE;

afterEach(() => {
  if (originalMode === undefined) delete process.env.VERIFY_PSBT_CORE_PROVENANCE_MODE;
  else process.env.VERIFY_PSBT_CORE_PROVENANCE_MODE = originalMode;
  if (originalImage === undefined) delete process.env.VERIFY_PSBT_CORE_IMAGE;
  else process.env.VERIFY_PSBT_CORE_IMAGE = originalImage;
});

describe('PSBT proof provenance', () => {
  it('pins Bitcoin Core by exact image digest and runtime identity', () => {
    expect(PSBT_PROOF_MANIFEST).toEqual(
      {
        schemaVersion: 1,
        coreImage: 'bitcoin/bitcoin:29.0@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78',
        coreVersion: 290000,
        coreSubversion: '/Satoshi:29.0.0/',
      },
    );
    process.env.VERIFY_PSBT_CORE_PROVENANCE_MODE = 'pinned-container';
    process.env.VERIFY_PSBT_CORE_IMAGE = PSBT_PROOF_MANIFEST.coreImage;
    expect(() => assertPinnedCoreExecution({
      version: PSBT_PROOF_MANIFEST.coreVersion,
      subversion: PSBT_PROOF_MANIFEST.coreSubversion,
    })).not.toThrow();
  });

  it('rejects unpinned execution and image or runtime drift', () => {
    expect(() => assertPinnedCoreExecution({
      version: PSBT_PROOF_MANIFEST.coreVersion,
      subversion: PSBT_PROOF_MANIFEST.coreSubversion,
    })).toThrow(/exact digest-pinned/);

    process.env.VERIFY_PSBT_CORE_PROVENANCE_MODE = 'pinned-container';
    process.env.VERIFY_PSBT_CORE_IMAGE = 'bitcoin/bitcoin:29.0';
    expect(() => assertPinnedCoreExecution({
      version: PSBT_PROOF_MANIFEST.coreVersion,
      subversion: PSBT_PROOF_MANIFEST.coreSubversion,
    })).toThrow(/exact digest-pinned/);

    process.env.VERIFY_PSBT_CORE_IMAGE = PSBT_PROOF_MANIFEST.coreImage;
    expect(() => assertPinnedCoreExecution({
      version: PSBT_PROOF_MANIFEST.coreVersion - 1,
      subversion: PSBT_PROOF_MANIFEST.coreSubversion,
    })).toThrow(/runtime drift/);

    expect(() => assertPinnedCoreExecution({
      version: PSBT_PROOF_MANIFEST.coreVersion,
      subversion: '/Satoshi:29.0.1/',
    })).toThrow(/runtime drift/);
  });

  it('binds compose, workflow, and checked-in vectors to the manifest', () => {
    const expected = PSBT_PROOF_MANIFEST.coreImage;
    const compose = readFileSync(join(repoRoot, 'scripts/verify-psbt/docker-compose.yml'), 'utf8');
    const workflow = readFileSync(join(repoRoot, '.github/workflows/verify-vectors.yml'), 'utf8');
    const unsignedFixture = readFileSync(
      join(repoRoot, 'server/tests/fixtures/generated-psbt-vectors.ts'),
      'utf8',
    );
    const signedFixture = readFileSync(
      join(repoRoot, 'server/tests/fixtures/generated-signed-psbt-vectors.ts'),
      'utf8',
    );

    expect(compose).toContain(`image: ${expected}`);
    expect(workflow).toContain(`VERIFY_PSBT_CORE_IMAGE: ${expected}`);
    expect(workflow).toContain("docker image inspect \"$VERIFY_PSBT_CORE_IMAGE\" --format '{{.Id}}'");
    expect(workflow).toContain("docker inspect bitcoin-core --format '{{.Image}}'");
    expect(workflow).toContain("--format '{{join .RepoDigests \"\\n\"}}'");
    expect(workflow).toContain('VERIFY_PSBT_CORE_PROVENANCE_MODE: pinned-container');
    expect(workflow).toContain('working-directory: scripts/verify-psbt');
    expect(workflow).toContain('npm run verify');
    expect(workflow).not.toMatch(/bitcoin\/bitcoin:\d+\.\d+(?:\s|\\)/);
    for (const fixture of [unsignedFixture, signedFixture]) {
      expect(fixture).toContain(expected);
      expect(fixture).toContain(String(PSBT_PROOF_MANIFEST.coreVersion));
      expect(fixture).toContain(PSBT_PROOF_MANIFEST.coreSubversion);
    }
  });
});
