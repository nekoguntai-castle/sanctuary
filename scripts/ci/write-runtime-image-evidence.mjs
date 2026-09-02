#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROLE_LOCKFILES = {
  frontend: ['package-lock.json'],
  backend: ['package-lock.json'],
  gateway: ['package-lock.json'],
  'llm-egress-proxy': ['llm-egress-proxy/package-lock.json'],
  'grafana-migration': [],
};

const OWNERSHIP_ENV = {
  'io.sanctuary.project': 'SANCTUARY_PROJECT',
  'io.sanctuary.deployment-id': 'SANCTUARY_DEPLOYMENT_ID',
  'io.sanctuary.owner-id': 'SANCTUARY_OWNER_ID',
  'io.sanctuary.lifecycle': 'SANCTUARY_RESOURCE_LIFECYCLE',
  'io.sanctuary.created-at': 'SANCTUARY_CLEANUP_CREATED_AT',
  'io.sanctuary.created-by-release': 'SANCTUARY_RELEASE',
  'io.sanctuary.created-by-commit': 'SANCTUARY_COMMIT',
  'io.sanctuary.creation-run-id': 'SANCTUARY_OPERATION_RUN_ID',
};

function fail(message) {
  throw new Error(`runtime-image-evidence: ${message}`);
}

function parseArgs(argv) {
  if (argv.length !== 10) {
    fail('usage: --role ROLE --image IMAGE --commit SHA --image-lock FILE --output-dir DIR');
  }
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag.startsWith('--') || !value) fail('arguments must be flag/value pairs');
    values[flag.slice(2)] = value;
  }
  const role = values.role;
  if (!Object.hasOwn(ROLE_LOCKFILES, role)) fail(`unsupported image role: ${role}`);
  if (!/^[0-9a-f]{40}$/.test(values.commit ?? '')) fail('commit must be a 40-character SHA');
  return {
    role,
    image: values.image,
    commit: values.commit,
    imageLock: values['image-lock'],
    outputDir: values['output-dir'],
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function transientOwnershipArgs() {
  if (process.env.SANCTUARY_CLEANUP_COORDINATED !== '1') {
    fail('signed cleanup coordinator authority is required');
  }
  const labels = {
    'io.sanctuary.resource-class': 'compose_container',
    'io.sanctuary.cleanup-policy': 'exact_delete',
  };
  for (const [label, variable] of Object.entries(OWNERSHIP_ENV)) {
    const value = process.env[variable];
    if (!value) fail(`${variable} is required for transient ownership`);
    labels[label] = value;
  }
  return Object.entries(labels).flatMap(([key, value]) => ['--label', `${key}=${value}`]);
}

function runTransientContainer(args) {
  return docker(['run', '--rm', ...transientOwnershipArgs(), ...args]);
}

function inspectImage(image) {
  const parsed = JSON.parse(docker(['image', 'inspect', image]));
  if (!Array.isArray(parsed) || parsed.length !== 1) fail(`expected one inspected image for ${image}`);
  return parsed[0];
}

function assertImageIdentity(inspect, options, imageLockSha) {
  const labels = inspect.Config?.Labels ?? {};
  if (labels['org.opencontainers.image.revision'] !== options.commit) {
    fail('OCI revision label does not match the tested commit');
  }
  if (labels['dev.sanctuary.image-lock-sha256'] !== imageLockSha) {
    fail('image-lock label does not match the checked-in lock');
  }
  const user = String(inspect.Config?.User ?? '').trim();
  if (!user || user === '0' || user === 'root' || user.startsWith('0:')) {
    fail(`${options.role} image must declare a non-root runtime user`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(inspect.Id ?? '')) fail('image ID is not a sha256 digest');
}

function smokeImage(options) {
  if (options.role === 'frontend') {
    runTransientContainer([
      '--env', 'ENABLE_SSL=false',
      '--env', 'BACKEND_HOST=127.0.0.1',
      options.image, 'nginx', '-t',
    ]);
    return;
  }
  const checks = {
    backend: ['sh', '-c', 'node --version && test -f dist/server/src/index.js'],
    gateway: ['sh', '-c', 'node --version && test -f dist/gateway/src/index.js'],
    'llm-egress-proxy': ['sh', '-c', 'node --version && test -f dist/index.js'],
    'grafana-migration': ['sh', '-c', 'test -x /opt/sanctuary/migrate-grafana-password.sh'],
  };
  runTransientContainer(['--entrypoint', checks[options.role][0], options.image, ...checks[options.role].slice(1)]);
}

function imagePackages(image) {
  const command = [
    'if command -v apk >/dev/null 2>&1; then apk info -v;',
    "elif command -v dpkg-query >/dev/null 2>&1; then dpkg-query -W -f='${Package}=${Version}\\n';",
    'else exit 0; fi',
  ].join(' ');
  const output = runTransientContainer(['--entrypoint', 'sh', image, '-c', command]);
  return output.split('\n').map(value => value.trim()).filter(Boolean).sort();
}

function lockPackages(repoRoot, role) {
  const packages = [];
  for (const relativePath of ROLE_LOCKFILES[role]) {
    const lock = JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
    for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
      if (!packagePath || !metadata?.version) continue;
      const name = metadata.name ?? packagePath.replace(/^.*node_modules\//, '');
      packages.push(`${name}=${metadata.version}`);
    }
  }
  return [...new Set(packages)].sort();
}

function spdxPackage(value, index) {
  const separator = value.lastIndexOf('=');
  const apkMatch = separator < 0 ? value.match(/^(.+)-([0-9][0-9A-Za-z._+~-]*(?:-r[0-9]+)?)$/) : null;
  const name = separator > 0 ? value.slice(0, separator) : (apkMatch?.[1] ?? value);
  const version = separator > 0 ? value.slice(separator + 1) : (apkMatch?.[2] ?? 'NOASSERTION');
  return {
    SPDXID: `SPDXRef-Package-${index + 1}`,
    name,
    versionInfo: version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
  };
}

function buildSbom(options, inspect, packages, imageLockSha) {
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `sanctuary-${options.role}-${inspect.Id}`,
    documentNamespace: `https://sanctuary.invalid/sbom/${options.commit}/${options.role}/${imageLockSha}`,
    creationInfo: { creators: ['Tool: sanctuary-runtime-image-evidence-v1'], created: new Date(0).toISOString() },
    packages: packages.map(spdxPackage),
    annotations: [{
      annotationType: 'OTHER',
      annotator: 'Tool: sanctuary-runtime-image-evidence-v1',
      annotationDate: new Date(0).toISOString(),
      comment: `imageId=${inspect.Id};sourceCommit=${options.commit};imageLockSha256=${imageLockSha}`,
    }],
  };
}

function buildProvenance(options, inspect, imageLockSha, sbomSha) {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: options.image, digest: { sha256: inspect.Id.slice('sha256:'.length) } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://sanctuary.invalid/runtime-image/v1',
        externalParameters: {
          role: options.role,
          sourceCommit: options.commit,
          imageLockSha256: imageLockSha,
        },
        resolvedDependencies: (inspect.RepoDigests ?? []).sort().map(uri => ({ uri })),
      },
      runDetails: {
        builder: { id: 'sanctuary-ci/runtime-image-evidence-v1' },
        metadata: { invocationId: `${options.commit}:${options.role}` },
      },
      evidence: { sbomSha256: sbomSha, os: inspect.Os, architecture: inspect.Architecture },
    },
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const lockBytes = readFileSync(path.resolve(options.imageLock));
  const imageLockSha = sha256(lockBytes);
  const inspect = inspectImage(options.image);
  assertImageIdentity(inspect, options, imageLockSha);
  smokeImage(options);

  const packages = [...new Set([
    ...imagePackages(options.image),
    ...lockPackages(repoRoot, options.role),
  ])].sort();
  if (packages.length === 0) fail('component inventory is empty');

  mkdirSync(options.outputDir, { recursive: true });
  const sbom = buildSbom(options, inspect, packages, imageLockSha);
  const sbomText = `${JSON.stringify(sbom, null, 2)}\n`;
  const provenance = buildProvenance(options, inspect, imageLockSha, sha256(sbomText));
  writeFileSync(path.join(options.outputDir, `${options.role}.spdx.json`), sbomText);
  writeFileSync(
    path.join(options.outputDir, `${options.role}.provenance.json`),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
