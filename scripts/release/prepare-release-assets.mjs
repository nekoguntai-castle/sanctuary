#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256File } from './release-asset-common.mjs';
import { verifyReleaseArtifacts } from './release-artifact-verifier.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const TAG_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

export function prepareReleaseAssets(input) {
  const options = normalizeOptions(input);
  const commit = validateCheckout(options.tag, options.repoRoot);
  mkdirSync(options.outputDir, { recursive: true });
  if (readdirSync(options.outputDir).length !== 0) {
    throw new Error(`output directory must be empty: ${options.outputDir}`);
  }

  const platformSlug = options.platform.replace('/', '-');
  const bundleName = `sanctuary-offline-${options.tag}-${platformSlug}.tar.gz`;
  const bundlePath = path.join(options.outputDir, bundleName);
  createOrCopyBundle(options, bundlePath);
  validateBundle(options, bundlePath, commit);

  const sourceName = `sanctuary-${options.tag}-source.tar.gz`;
  run('git', ['-C', options.repoRoot, 'archive', '--format=tar.gz', '--prefix', `sanctuary-${options.tag}/`, '-o', path.join(options.outputDir, sourceName), options.tag]);
  copyFileSync(path.join(options.repoRoot, 'install.sh'), path.join(options.outputDir, 'install.sh'));
  writeReleaseNotes(options, commit);

  const bundleSha = sha256File(bundlePath);
  const sbomName = `${bundleName}.spdx.json`;
  const provenanceName = `${bundleName}.provenance.json`;
  writeFileSync(path.join(options.outputDir, sbomName), `${JSON.stringify(buildSbom(options, bundlePath, bundleName, bundleSha), null, 2)}\n`);
  writeFileSync(path.join(options.outputDir, provenanceName), `${JSON.stringify(buildProvenance(options, commit, bundleName, bundleSha), null, 2)}\n`);

  const checksummedNames = [bundleName, sourceName, 'install.sh', 'release-notes.md', sbomName, provenanceName];
  const checksumLines = checksummedNames.map((name) => `${sha256File(path.join(options.outputDir, name))}  ${name}`);
  writeFileSync(path.join(options.outputDir, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`);
  signFile(path.join(options.outputDir, 'SHA256SUMS'), path.join(options.outputDir, 'SHA256SUMS.sig'), options.signingKey);

  const manifest = buildManifest(options, commit, {
    bundleName,
    sourceName,
    sbomName,
    provenanceName,
  });
  const manifestPath = path.join(options.outputDir, 'release-manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  signFile(manifestPath, `${manifestPath}.sig`, options.signingKey);

  verifyReleaseArtifacts({
    manifestPath,
    baseDir: options.outputDir,
    publicKeyPath: options.publicKey,
    strictStable: true,
  });
  verifySignature(manifestPath, `${manifestPath}.sig`, options.publicKey);
  return { commit, manifestPath, bundlePath };
}

function normalizeOptions(input) {
  if (!TAG_RE.test(input.tag ?? '')) throw new Error('tag must be a v-prefixed semantic version');
  if ((input.platform ?? 'linux/amd64') !== 'linux/amd64') {
    throw new Error('only linux/amd64 is release-verified; ARM64 requires a native acceptance rehearsal');
  }
  const options = {
    tag: input.tag,
    platform: input.platform ?? 'linux/amd64',
    outputDir: path.resolve(input.outputDir),
    signingKey: path.resolve(input.signingKey),
    publicKey: path.resolve(input.publicKey),
    repoRoot: path.resolve(input.repoRoot ?? REPO_ROOT),
    bundlePath: input.bundlePath ? path.resolve(input.bundlePath) : '',
    runId: input.runId ?? `operator-${new Date().toISOString().replace(/[^0-9A-Za-z.-]/g, '-')}`,
  };
  const outputRelative = path.relative(options.repoRoot, options.outputDir);
  if (outputRelative === '' || (!outputRelative.startsWith('..') && !path.isAbsolute(outputRelative))) {
    throw new Error('release asset output directory must be outside the release checkout');
  }
  requireFile(options.signingKey);
  requireFile(options.publicKey);
  return options;
}

function validateCheckout(tag, repoRoot) {
  const commit = capture('git', ['-C', repoRoot, 'rev-parse', `${tag}^{commit}`]);
  if (capture('git', ['-C', repoRoot, 'rev-parse', 'HEAD']) !== commit) {
    throw new Error(`checkout must be at ${tag} (${commit})`);
  }
  if (capture('git', ['-C', repoRoot, 'status', '--porcelain', '--untracked-files=all']) !== '') {
    throw new Error('release asset preparation requires a clean worktree');
  }
  const packageVersion = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  const tagVersion = tag.slice(1);
  const expectedPackageVersion = tagVersion.split('-')[0];
  if (packageVersion !== tagVersion && packageVersion !== expectedPackageVersion) {
    throw new Error(`package version ${packageVersion} does not match release tag ${tag}`);
  }
  return commit;
}

function createOrCopyBundle(options, destination) {
  if (options.bundlePath) {
    copyFileSync(options.bundlePath, destination);
    copyFileSync(`${options.bundlePath}.sig`, `${destination}.sig`);
    return;
  }
  run(path.join(options.repoRoot, 'scripts/offline/create-bundle.sh'), [
    '--tag', options.tag,
    '--platform', options.platform,
    '--output', destination,
    '--signing-key', options.signingKey,
    '--public-key', options.publicKey,
  ]);
}

function validateBundle(options, bundlePath, commit) {
  requireFile(`${bundlePath}.sig`);
  verifySignature(bundlePath, `${bundlePath}.sig`, options.publicKey);
  const stageDir = mkdtempSync(path.join(tmpdir(), 'sanctuary-release-bundle-'));
  try {
    run(path.join(options.repoRoot, 'scripts/offline/apply-bundle.sh'), [
      '--bundle', bundlePath,
      '--stage-dir', stageDir,
      '--prepare-only',
      '--public-key', options.publicKey,
    ]);
    const embedded = JSON.parse(readFileSync(path.join(stageDir, 'manifest.json'), 'utf8'));
    if (embedded.gitTag !== options.tag || embedded.gitCommit !== commit || embedded.platform !== options.platform) {
      throw new Error('offline bundle identity does not match the requested tag, commit, and platform');
    }
    if (embedded.flavor !== 'full' || embedded.includedProfiles !== 'core,monitoring,tor') {
      throw new Error('release offline bundle must contain the full core, monitoring, and Tor profiles');
    }
    const inventory = JSON.parse(readFileSync(path.join(stageDir, 'image-inventory.json'), 'utf8'));
    const expectedArchitecture = options.platform.split('/')[1];
    const expectedImages = capture('bash', ['-c', 'source "$1"; offline_all_release_images', '_', path.join(options.repoRoot, 'scripts/offline/bundle-common.sh')]).split('\n').filter(Boolean).sort();
    const inventoryImages = Array.isArray(inventory.images) ? inventory.images.map((image) => image.image).sort() : [];
    if (inventory.platform !== options.platform || JSON.stringify(inventoryImages) !== JSON.stringify(expectedImages)
      || inventory.images.some((image) => image.os !== 'linux' || image.architecture !== expectedArchitecture
        || !/^sha256:[a-f0-9]{64}$/.test(image.id ?? '')
        || (!image.image.startsWith('sanctuary-') && (!Array.isArray(image.repoDigests) || image.repoDigests.length === 0)))) {
      throw new Error('offline bundle image inventory does not match the release platform');
    }
    for (const image of inventory.images) requireFile(imageTarPath(stageDir, image.image));
    const bundledCommit = peelBundledCommit(stageDir, options.tag);
    if (bundledCommit !== commit) throw new Error('offline bundle git ref does not match the release commit');
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

function imageTarPath(stageDir, image) {
  let bucket = 'core';
  if (/^(jaegertracing|grafana|prom)\//.test(image)) bucket = 'monitoring';
  if (image.startsWith('dperson/torproxy:')) bucket = 'tor';
  return path.join(stageDir, 'images', bucket, `${image.replace(/[^A-Za-z0-9._-]/g, '-')}.tar`);
}

function peelBundledCommit(stageDir, tag) {
  const verifyRepo = mkdtempSync(path.join(tmpdir(), 'sanctuary-bundle-ref-'));
  try {
    run('git', ['-C', verifyRepo, 'init', '--bare', '-q']);
    run('git', ['-C', verifyRepo, 'fetch', '-q', path.join(stageDir, 'repo/sanctuary.git.bundle'), `refs/tags/${tag}:refs/tags/${tag}`]);
    return capture('git', ['-C', verifyRepo, 'rev-parse', `refs/tags/${tag}^{commit}`]);
  } finally {
    rmSync(verifyRepo, { recursive: true, force: true });
  }
}

function writeReleaseNotes(options, commit) {
  // Shared resolver: a stable tag measures from the previous STABLE tag, not
  // the nearest one (its own RC). These notes are checksummed into SHA256SUMS,
  // signed, and published as an immutable asset, so a wrong range cannot be
  // corrected after the fact. Same script backs create-forge-release.sh so the
  // Release body and this file cannot drift. See #720.
  const previous = capture(
    path.join(SCRIPT_DIR, 'previous-release-tag.sh'),
    [options.tag, options.repoRoot],
    true,
  );
  const range = previous ? `${previous}..${options.tag}` : options.tag;
  const log = capture('git', ['-C', options.repoRoot, 'log', '--format=- %s (%h)', range]);
  writeFileSync(path.join(options.outputDir, 'release-notes.md'), `# Sanctuary ${options.tag}\n\nCommit: \`${commit}\`\n\n${log || '- Initial release'}\n`);
}

function buildSbom(options, bundlePath, bundleName, bundleSha) {
  const files = readBundleInventory(bundlePath).map(({ fileName, sha256 }, index) => ({
    fileName,
    SPDXID: `SPDXRef-File-${index + 1}`,
    checksums: [{ algorithm: 'SHA256', checksumValue: sha256 }],
    licenseConcluded: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
  }));
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: bundleName,
    documentNamespace: `https://sanctuary.local/spdx/${options.tag}/${randomUUID()}`,
    creationInfo: { created: new Date().toISOString(), creators: ['Tool: Sanctuary trusted-operator release assembler'] },
    packages: [{
      name: bundleName,
      SPDXID: 'SPDXRef-Package',
      versionInfo: options.tag.slice(1),
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: true,
      checksums: [{ algorithm: 'SHA256', checksumValue: bundleSha }],
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: 'NOASSERTION',
      copyrightText: 'NOASSERTION',
    }],
    files,
    relationships: files.map((file) => ({ spdxElementId: 'SPDXRef-Package', relationshipType: 'CONTAINS', relatedSpdxElement: file.SPDXID })),
    documentDescribes: ['SPDXRef-Package'],
  };
}

function readBundleInventory(bundlePath) {
  const listing = run('tar', ['-tzf', bundlePath]).split('\n');
  const checksumMember = listing.find((name) => /(^|\/)checksums\.sha256$/.test(name));
  if (!checksumMember) throw new Error('offline bundle does not contain checksums.sha256');
  return run('tar', ['-xOzf', bundlePath, checksumMember]).split('\n').filter(Boolean).map((line) => {
    const match = line.match(/^([a-f0-9]{64})\s+[* ]?(\.\/)?(.+)$/);
    if (!match) throw new Error(`invalid offline bundle checksum entry: ${line}`);
    return { sha256: match[1], fileName: match[3] };
  });
}

function buildProvenance(options, commit, bundleName, bundleSha) {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: bundleName, digest: { sha256: bundleSha } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://sanctuary.local/build-types/offline-bundle/v1',
        externalParameters: { tag: options.tag, commit, platform: options.platform },
        resolvedDependencies: [{ uri: `git+https://github.com/nekoguntai-castle/sanctuary@${options.tag}`, digest: { gitCommit: commit } }],
      },
      runDetails: { builder: { id: 'https://sanctuary.local/builders/trusted-operator' }, metadata: { invocationId: options.runId } },
    },
  };
}

function buildManifest(options, commit, names) {
  const ref = (name) => ({ path: name, sha256: sha256File(path.join(options.outputDir, name)) });
  return {
    schema: 1,
    release: { tag: options.tag, version: options.tag.slice(1), commit, stability: options.tag.includes('-') ? 'prerelease' : 'stable' },
    builder: { workflow: 'trusted-operator', runId: options.runId },
    artifacts: [
      { name: 'SHA256SUMS', type: 'checksum-file', ...ref('SHA256SUMS'), signature: { path: 'SHA256SUMS.sig', sha256: sha256File(path.join(options.outputDir, 'SHA256SUMS.sig')), format: 'openssl-rsa-sha256' } },
      { name: names.bundleName, type: 'offline-bundle', platform: options.platform, ...ref(names.bundleName), signature: { path: `${names.bundleName}.sig`, sha256: sha256File(path.join(options.outputDir, `${names.bundleName}.sig`)), format: 'openssl-rsa-sha256' }, sbom: ref(names.sbomName), provenance: ref(names.provenanceName) },
      { name: names.sourceName, type: 'source-archive', ...ref(names.sourceName) },
      { name: 'install.sh', type: 'install-script', ...ref('install.sh') },
      { name: 'release-notes.md', type: 'release-notes', ...ref('release-notes.md') },
    ],
  };
}

function signFile(input, output, key) {
  run('openssl', ['dgst', '-sha256', '-sign', key, '-out', output, input]);
}

function verifySignature(input, signature, key) {
  run('openssl', ['dgst', '-sha256', '-verify', key, '-signature', signature, input]);
}

function requireFile(filePath) {
  if (!filePath || !statSync(filePath).isFile()) throw new Error(`required file is missing: ${filePath}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

function capture(command, args, allowFailure = false) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    if (allowFailure) return '';
    throw new Error(`${path.basename(command)} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!value || !key.startsWith('--')) throw new Error(`missing value for ${key}`);
    const names = { '--tag': 'tag', '--platform': 'platform', '--output-dir': 'outputDir', '--signing-key': 'signingKey', '--public-key': 'publicKey', '--bundle': 'bundlePath', '--run-id': 'runId' };
    if (!names[key]) throw new Error(`unknown argument: ${key}`);
    options[names[key]] = value;
  }
  for (const required of ['tag', 'outputDir', 'signingKey', 'publicKey']) {
    if (!options[required]) throw new Error(`--${required.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = prepareReleaseAssets(parseArgs(process.argv.slice(2)));
    console.log(`Prepared and verified release assets for ${result.commit} in ${path.dirname(result.manifestPath)}`);
  } catch (error) {
    failClosed(`release asset preparation failed: ${error.message}`);
  }
}

function failClosed(message) {
  console.error(message);
  process.exit(1);
}
