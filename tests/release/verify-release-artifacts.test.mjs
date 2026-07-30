import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ReleaseArtifactVerificationError,
  verifyReleaseArtifacts,
} from '../../scripts/release/release-artifact-verifier.mjs';

const GOOD_COMMIT = 'a'.repeat(40);
const DIGESTS = {
  frontendManifest: `sha256:${'b'.repeat(64)}`,
  frontendAmd64: `sha256:${'c'.repeat(64)}`,
  frontendArm64: `sha256:${'d'.repeat(64)}`,
  backendManifest: `sha256:${'e'.repeat(64)}`,
  backendAmd64: `sha256:${'f'.repeat(64)}`,
  backendArm64: `sha256:${'0'.repeat(64)}`,
};

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function writeFixtureFile(dir, relativePath, content) {
  const fullPath = path.join(dir, relativePath);
  writeFileSync(fullPath, content);
  return { path: relativePath, sha256: sha256(fullPath) };
}

function signFile(filePath, signaturePath, privateKey) {
  const signer = createSign('RSA-SHA256');
  signer.update(readFileSync(filePath));
  signer.end();
  writeFileSync(signaturePath, signer.sign(privateKey));
}

function writeChecksums(dir, references) {
  const lines = references
    .map((reference) => `${reference.sha256}  ${reference.path}`)
    .join('\n');
  const checksumPath = path.join(dir, 'SHA256SUMS');
  writeFileSync(checksumPath, `${lines}\n`);
  return { path: 'SHA256SUMS', sha256: sha256(checksumPath) };
}

function createCompleteFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sanctuary-release-artifacts-'));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPath = path.join(dir, 'release-public.pem');
  writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));

  const localArtifacts = {
    bundle: writeFixtureFile(dir, 'sanctuary-offline-v1.2.3-linux-amd64.tar.gz', 'offline bundle\n'),
    bundleSbom: writeFixtureFile(dir, 'sanctuary-offline-v1.2.3-linux-amd64.spdx.json', '{"sbom":"bundle"}\n'),
    bundleProvenance: writeFixtureFile(dir, 'sanctuary-offline-v1.2.3-linux-amd64.provenance.json', '{"builder":"offline"}\n'),
    source: writeFixtureFile(dir, 'sanctuary-v1.2.3-source.tar.gz', 'source archive\n'),
    installScript: writeFixtureFile(dir, 'install.sh', '#!/usr/bin/env bash\n'),
    releaseNotes: writeFixtureFile(dir, 'release-notes.md', '# v1.2.3\n'),
    frontendSbom: writeFixtureFile(dir, 'frontend.spdx.json', '{"sbom":"frontend"}\n'),
    frontendProvenance: writeFixtureFile(dir, 'frontend.provenance.json', '{"builder":"frontend"}\n'),
    backendSbom: writeFixtureFile(dir, 'backend.spdx.json', '{"sbom":"backend"}\n'),
    backendProvenance: writeFixtureFile(dir, 'backend.provenance.json', '{"builder":"backend"}\n'),
  };

  const checksum = writeChecksums(dir, Object.values(localArtifacts));
  signFile(path.join(dir, checksum.path), path.join(dir, 'SHA256SUMS.sig'), privateKey);

  const manifest = {
    schema: 1,
    release: {
      tag: 'v1.2.3',
      version: '1.2.3',
      commit: GOOD_COMMIT,
      stability: 'stable',
    },
    builder: {
      workflow: '.github/workflows/release.yml',
      runId: '123456',
    },
    artifacts: [
      {
        name: 'SHA256SUMS',
        type: 'checksum-file',
        path: checksum.path,
        sha256: checksum.sha256,
        signature: {
          path: 'SHA256SUMS.sig',
          format: 'openssl-rsa-sha256',
        },
      },
      {
        name: localArtifacts.bundle.path,
        type: 'offline-bundle',
        platform: 'linux/amd64',
        path: localArtifacts.bundle.path,
        sha256: localArtifacts.bundle.sha256,
        sbom: localArtifacts.bundleSbom,
        provenance: localArtifacts.bundleProvenance,
      },
      {
        name: localArtifacts.source.path,
        type: 'source-archive',
        path: localArtifacts.source.path,
        sha256: localArtifacts.source.sha256,
      },
      {
        name: localArtifacts.installScript.path,
        type: 'install-script',
        path: localArtifacts.installScript.path,
        sha256: localArtifacts.installScript.sha256,
      },
      {
        name: localArtifacts.releaseNotes.path,
        type: 'release-notes',
        path: localArtifacts.releaseNotes.path,
        sha256: localArtifacts.releaseNotes.sha256,
      },
      containerArtifact('frontend', DIGESTS.frontendManifest, DIGESTS.frontendAmd64, DIGESTS.frontendArm64, localArtifacts.frontendSbom, localArtifacts.frontendProvenance),
      containerArtifact('backend', DIGESTS.backendManifest, DIGESTS.backendAmd64, DIGESTS.backendArm64, localArtifacts.backendSbom, localArtifacts.backendProvenance),
    ],
  };

  const manifestPath = path.join(dir, 'release-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, manifest, manifestPath, publicKeyPath };
}

function containerArtifact(role, digest, amd64Digest, arm64Digest, sbom, provenance) {
  return {
    name: `sanctuary ${role} image`,
    type: 'container-image',
    image: `ghcr.io/nekoguntai-castle/sanctuary-${role}`,
    tag: 'v1.2.3',
    digest,
    platforms: [
      { platform: 'linux/amd64', digest: amd64Digest },
      { platform: 'linux/arm64', digest: arm64Digest },
    ],
    sbom,
    provenance,
  };
}

function rewriteManifest(fixture, mutate) {
  const nextManifest = structuredClone(fixture.manifest);
  mutate(nextManifest);
  writeFileSync(fixture.manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
}

function expectVerificationFailure(fixture, messagePattern) {
  assert.throws(
    () => verifyReleaseArtifacts({
      manifestPath: fixture.manifestPath,
      publicKeyPath: fixture.publicKeyPath,
      strictStable: true,
    }),
    (error) => error instanceof ReleaseArtifactVerificationError
      && messagePattern.test(error.message),
  );
}

function expectStrictImagesFailure(fixture, messagePattern) {
  assert.throws(
    () => verifyReleaseArtifacts({
      manifestPath: fixture.manifestPath,
      strictImages: true,
    }),
    (error) => error instanceof ReleaseArtifactVerificationError
      && messagePattern.test(error.message),
  );
}

function useContainerOnlyManifest(fixture) {
  rewriteManifest(fixture, (manifest) => {
    manifest.artifacts = manifest.artifacts.filter((artifact) => artifact.type === 'container-image');
    for (const artifact of manifest.artifacts) {
      delete artifact.sbom;
      delete artifact.provenance;
    }
  });
  fixture.manifest.artifacts = fixture.manifest.artifacts.filter((artifact) => artifact.type === 'container-image');
  for (const artifact of fixture.manifest.artifacts) {
    delete artifact.sbom;
    delete artifact.provenance;
  }
}

function withFixture(testFn) {
  const fixture = createCompleteFixture();
  try {
    testFn(fixture);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
}

function testCompleteStableManifestPasses() {
  withFixture((fixture) => {
    const result = verifyReleaseArtifacts({
      manifestPath: fixture.manifestPath,
      publicKeyPath: fixture.publicKeyPath,
      strictStable: true,
    });
    assert.equal(result.artifactsChecked, 7);
    assert.equal(result.checksumEntries, 10);
  });
}

function testStableManifestRequiresSignedChecksumFile() {
  withFixture((fixture) => {
    rewriteManifest(fixture, (manifest) => {
      delete manifest.artifacts[0].signature;
    });
    expectVerificationFailure(fixture, /signed checksum-file artifact/);
  });
}

function testStableOfflineBundleRequiresProvenance() {
  withFixture((fixture) => {
    rewriteManifest(fixture, (manifest) => {
      delete manifest.artifacts[1].provenance;
    });
    expectVerificationFailure(fixture, /offline.*provenance/);
  });
}

function testStableContainerRequiresArm64Digest() {
  withFixture((fixture) => {
    rewriteManifest(fixture, (manifest) => {
      manifest.artifacts[5].platforms = manifest.artifacts[5].platforms.filter((entry) => entry.platform !== 'linux/arm64');
    });
    expectVerificationFailure(fixture, /linux\/arm64 image digest evidence/);
  });
}

function testStrictImagesContainerOnlyManifestPasses() {
  withFixture((fixture) => {
    useContainerOnlyManifest(fixture);
    const result = verifyReleaseArtifacts({
      manifestPath: fixture.manifestPath,
      strictImages: true,
    });
    assert.equal(result.artifactsChecked, 2);
    assert.equal(result.localFilesChecked, 0);
    assert.equal(result.checksumEntries, 0);
  });
}

function testStrictImagesRejectsNullPlatforms() {
  withFixture((fixture) => {
    useContainerOnlyManifest(fixture);
    rewriteManifest(fixture, (manifest) => {
      manifest.artifacts[0].platforms = null;
    });
    expectStrictImagesFailure(fixture, /platforms must contain linux\/amd64 and linux\/arm64/);
  });
}

function testStrictImagesRejectsDuplicatePlatformDigest() {
  withFixture((fixture) => {
    useContainerOnlyManifest(fixture);
    rewriteManifest(fixture, (manifest) => {
      manifest.artifacts[0].platforms.push({
        platform: 'linux/amd64',
        digest: `sha256:${'1'.repeat(64)}`,
      });
    });
    expectStrictImagesFailure(fixture, /duplicate linux\/amd64 image digest evidence/);
  });
}

function testStrictImagesRejectsMissingPlatformDigest() {
  withFixture((fixture) => {
    useContainerOnlyManifest(fixture);
    rewriteManifest(fixture, (manifest) => {
      manifest.artifacts[1].platforms = manifest.artifacts[1].platforms
        .filter((entry) => entry.platform !== 'linux/arm64');
    });
    expectStrictImagesFailure(fixture, /requires linux\/arm64 image digest evidence/);
  });
}

function testStrictImagesRejectsDuplicateRole() {
  withFixture((fixture) => {
    useContainerOnlyManifest(fixture);
    rewriteManifest(fixture, (manifest) => {
      manifest.artifacts.push(structuredClone(manifest.artifacts[0]));
    });
    expectStrictImagesFailure(fixture, /exactly one frontend container-image artifact; found 2/);
  });
}

function testStrictImagesRejectsMissingRole() {
  withFixture((fixture) => {
    useContainerOnlyManifest(fixture);
    rewriteManifest(fixture, (manifest) => {
      manifest.artifacts = manifest.artifacts.filter((artifact) => !artifact.image.endsWith('-backend'));
    });
    expectStrictImagesFailure(fixture, /requires one backend container-image artifact/);
  });
}

function testStrictImagesRejectsMalformedManifestDigestBoundary() {
  withFixture((fixture) => {
    useContainerOnlyManifest(fixture);
    rewriteManifest(fixture, (manifest) => {
      manifest.artifacts[0].digest = `sha256:${'a'.repeat(63)}`;
    });
    expectStrictImagesFailure(fixture, /sha256 manifest digest/);
  });
}

function testStrictImagesDoesNotMatchPartialRoleName() {
  withFixture((fixture) => {
    useContainerOnlyManifest(fixture);
    rewriteManifest(fixture, (manifest) => {
      manifest.artifacts[0].name = 'sanctuary frontendish image';
      manifest.artifacts[0].image = 'ghcr.io/nekoguntai-castle/sanctuary-frontendish';
    });
    expectStrictImagesFailure(fixture, /requires one frontend container-image artifact/);
  });
}

function testTamperedArtifactFailsChecksum() {
  withFixture((fixture) => {
    writeFileSync(path.join(fixture.dir, 'install.sh'), 'tampered\n');
    expectVerificationFailure(fixture, /checksum mismatch/);
  });
}

function testUncoveredArtifactFailsClosed() {
  withFixture((fixture) => {
    const extra = writeFixtureFile(fixture.dir, 'extra-notes.md', 'extra\n');
    rewriteManifest(fixture, (manifest) => {
      manifest.artifacts.push({
        name: extra.path,
        type: 'release-notes',
        path: extra.path,
        sha256: extra.sha256,
      });
    });
    expectVerificationFailure(fixture, /not covered by a signed checksum file/);
  });
}

function testBadReleaseIdentityFailsClosed() {
  withFixture((fixture) => {
    rewriteManifest(fixture, (manifest) => {
      manifest.release.commit = 'abc123';
    });
    expectVerificationFailure(fixture, /manifest\.release\.commit/);
  });
}

function testPathTraversalFailsClosed() {
  withFixture((fixture) => {
    rewriteManifest(fixture, (manifest) => {
      manifest.artifacts[3].path = '../install.sh';
    });
    expectVerificationFailure(fixture, /inside the release artifact directory/);
  });
}

function runTest(name, testFn) {
  testFn();
  console.log(`ok - ${name}`);
}

runTest('complete stable release manifest passes', testCompleteStableManifestPasses);
runTest('stable release requires signed checksum file', testStableManifestRequiresSignedChecksumFile);
runTest('stable offline bundle requires provenance', testStableOfflineBundleRequiresProvenance);
runTest('stable container requires arm64 digest', testStableContainerRequiresArm64Digest);
runTest('strict images accepts a complete container-only manifest', testStrictImagesContainerOnlyManifestPasses);
runTest('strict images rejects null platform evidence', testStrictImagesRejectsNullPlatforms);
runTest('strict images rejects duplicate platform digests', testStrictImagesRejectsDuplicatePlatformDigest);
runTest('strict images rejects missing platform digests', testStrictImagesRejectsMissingPlatformDigest);
runTest('strict images rejects duplicate role artifacts', testStrictImagesRejectsDuplicateRole);
runTest('strict images rejects a missing role artifact', testStrictImagesRejectsMissingRole);
runTest('strict images rejects a malformed manifest digest boundary', testStrictImagesRejectsMalformedManifestDigestBoundary);
runTest('strict images does not match a partial role name', testStrictImagesDoesNotMatchPartialRoleName);
runTest('tampered artifact fails checksum verification', testTamperedArtifactFailsChecksum);
runTest('uncovered local artifact fails closed', testUncoveredArtifactFailsClosed);
runTest('bad release identity fails closed', testBadReleaseIdentityFailsClosed);
runTest('path traversal fails closed', testPathTraversalFailsClosed);
console.log('release artifact verifier tests passed');
