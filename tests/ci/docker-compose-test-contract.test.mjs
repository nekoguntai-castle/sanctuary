import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const compose = readFileSync('docker/compose/test.yml', 'utf8');
const frontendDockerfile = 'docker/frontend/Dockerfile';
const dockerfile = readFileSync(frontendDockerfile, 'utf8');

function mappingBlock(source, key, indentation) {
  const lines = source.split('\n');
  const marker = `${' '.repeat(indentation)}${key}:`;
  const matches = lines.flatMap((line, index) => (line === marker ? [index] : []));

  assert.equal(matches.length, 1, `${key} must exist exactly once at indentation ${indentation}`);

  const body = [];
  for (const line of lines.slice(matches[0] + 1)) {
    if (line !== '' && line.length - line.trimStart().length <= indentation) break;
    body.push(line);
  }
  return body.join('\n');
}

function serviceBlock(source, serviceName) {
  return mappingBlock(mappingBlock(source, 'services', 0), serviceName, 2);
}

function scalarValue(source) {
  const value = source.trim();
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function mappingHasKey(source, key, indentation) {
  const prefix = ' '.repeat(indentation);
  return source.split('\n').some((line) => {
    if (!line.startsWith(prefix) || line.startsWith(`${prefix} `)) return false;
    const separator = line.indexOf(':', indentation);
    if (separator === -1) return false;
    return scalarValue(line.slice(indentation, separator)) === key;
  });
}

function hasHostNodeModulesMount(volumes) {
  return volumes.split('\n').some((line) => {
    const shortMount = line.match(/^ {6}- (?<value>.+)$/)?.groups?.value;
    if (shortMount) {
      const value = scalarValue(shortMount);
      if (value.includes('node_modules') && value !== '/app/node_modules') return true;
    }

    const source = line.match(/^ {8}(?:source|"source"|'source')\s*:\s*(?<value>.+)$/)?.groups
      ?.value;
    return source ? scalarValue(source) === './node_modules' : false;
  });
}

function assertFrontendServiceContract(source, serviceName) {
  const service = serviceBlock(source, serviceName);
  const build = mappingBlock(service, 'build', 4);
  const volumes = mappingBlock(service, 'volumes', 4);

  assert.match(
    build,
    /^      context: \.\n      dockerfile: docker\/frontend\/Dockerfile\n      target: deps$/m,
  );
  assert.equal(mappingHasKey(service, 'image', 4), false);
  assert.match(volumes, /^      - \/app\/node_modules$/m);
  assert.equal(hasHostNodeModulesMount(volumes), false);
  assert.match(volumes, /^      - \.:\/app$/m);
}

test('frontend dependency image supports the repository-wide frontend test contract', () => {
  assert.match(dockerfile, /apk add --no-cache[^\n]*\bbash\b/);
  for (const manifest of ['server/package.json', 'gateway/package.json']) {
    assert.match(
      dockerfile,
      new RegExp(`COPY .*${manifest.replace('/', '\\/')}`),
      `${manifest} must participate in the workspace-aware npm ci layer`,
    );
  }
  assert.match(dockerfile, /COPY shared \.\/shared/);
  assert.match(dockerfile, /COPY server\/prisma \.\/server\/prisma/);
  assert.match(dockerfile, /COPY server\/\.husky \.\/server\/\.husky/);
});

for (const serviceName of ['frontend-test', 'frontend-coverage']) {
  test(`${serviceName} preserves host dependency and workspace compatibility`, () => {
    assertFrontendServiceContract(compose, serviceName);
  });
}

test('service contract rejects structurally misplaced and host-native mounts', () => {
  const validService = `
  frontend-test:
    build:
      context: .
      dockerfile: docker/frontend/Dockerfile
      target: deps
    volumes:
      - .:/app
      - /app/node_modules`;

  assert.throws(() => assertFrontendServiceContract(`networks:${validService}`, 'frontend-test'));
  assert.throws(() =>
    assertFrontendServiceContract(
      `services:
  frontend-test:
    build:
      context: .
      dockerfile: docker/frontend/Dockerfile
      target: deps
    labels:
      - .:/app
      - /app/node_modules`,
      'frontend-test',
    ),
  );
  assert.throws(() =>
    assertFrontendServiceContract(
      `services:
  frontend-test:
    build:
      context: .
      dockerfile: docker/frontend/Dockerfile
      target: deps
    volumes:
      - .:/app
      - /app/node_modules
      - type: bind
        source: ./node_modules
        target: /tmp/host-node-modules`,
      'frontend-test',
    ),
  );
  for (const violation of [
    '      - "./node_modules:/tmp/host"',
    "      - type: bind\n        source: './node_modules'\n        target: /tmp/host",
    '      - {type: bind, source: ./node_modules, target: /tmp/host}',
  ]) {
    assert.throws(() =>
      assertFrontendServiceContract(
        `services:
  frontend-test:
    build:
      context: .
      dockerfile: docker/frontend/Dockerfile
      target: deps
    volumes:
      - .:/app
      - /app/node_modules
${violation}`,
        'frontend-test',
      ),
    );
  }
  assert.throws(() =>
    assertFrontendServiceContract(
      `services:
  frontend-test:
    build:
      context: .
      dockerfile: docker/frontend/Dockerfile
      target: deps
    "image": host/frontend
    volumes:
      - .:/app
      - /app/node_modules`,
      'frontend-test',
    ),
  );
});

for (const serviceName of ['backend-test', 'backend-coverage']) {
  test(`${serviceName} uses the prepared isolated workspace and real Vitest scope`, () => {
    const service = serviceBlock(compose, serviceName);
    assert.match(service, /working_dir: \/repo\/server/);
    assert.match(service, /dockerfile: docker\/test\/backend.Dockerfile/);
    assert.match(service, /image: sanctuary-backend-test:/);
    assert.match(service, /SANCTUARY_SOURCE_COMMIT: \$\{SANCTUARY_SOURCE_COMMIT:-\}/);
    assert.match(service, /SANCTUARY_IMAGE_LOCK_SHA256: \$\{SANCTUARY_IMAGE_LOCK_SHA256:-\}/);
    assert.match(service, /SANCTUARY_BUILD_VERSION: \$\{SANCTUARY_VERSION:-\}/);
    assert.match(service, /SANCTUARY_BUILD_ID: \$\{SANCTUARY_BUILD_ID:-\}/);
    assert.match(service, /backend-docker-test.sh/);
    assert.doesNotMatch(service, /jest|--ci|\/app|\.\/server\/coverage/);
    assert.match(service, /TEST_DATABASE_URL: postgresql:\/\/test:test@postgres:5432\/sanctuary_test/);
    assert.match(service, /read_only: true/);
    assert.match(service, /create_host_path: false/);
    assert.match(service, serviceName === 'backend-test' ? /full/ : /unit-coverage/);
  });
}

test('Docker integration caller delegates to the same preparation entry', () => {
  const caller = readFileSync('scripts/run-tests.sh', 'utf8');
  assert.match(caller, /backend-test bash \/repo\/scripts\/ci\/backend-docker-test.sh integration/);
  assert.doesNotMatch(caller, /test:integration -- --ci/);
});

test('backend image contains workspace tools and excludes operational material', () => {
  const source = readFileSync('docker/test/backend.Dockerfile', 'utf8');
  assert.match(source, /FROM node:24-alpine@sha256:[a-f0-9]{64}/);
  assert.match(source, /NPM_VERSION=12\.0\.2/);
  assert.match(source, /WORKDIR \/repo/);
  assert.match(source, /npm ci --strict-allow-scripts/);
  assert.match(source, /io\.sanctuary\.build-id="\$SANCTUARY_BUILD_ID"/);
  const ignore = readFileSync('docker/test/backend.Dockerfile.dockerignore', 'utf8');
  for (const rule of ['**', '!server/**', '!shared/**', '!src/**', '!config/**', '!scripts/**', '**/node_modules', '**/.git', '**/.env.*', '**/.tmp', '**/backups', '**/*.key', '**/.stryker-tmp']) {
    assert.ok(ignore.split('\n').includes(rule), `missing ${rule}`);
  }
  assert.match(compose, /aliases: \[postgres\]/);
  assert.match(compose, /TEST_POSTGRES_PORT:-0/);
});

test('backend context includes gateway source imported by the destructive operations proof', () => {
  const proof = readFileSync('server/tests/integration/ops/phase2OperationsProof.integration.test.ts', 'utf8');
  assert.match(proof, /import\('\.\.\/\.\.\/\.\.\/\.\.\/gateway\/src\/middleware\/requestLogger'\)/);
  const rules = readFileSync('docker/test/backend.Dockerfile.dockerignore', 'utf8').split('\n');
  for (const rule of ['!gateway/src/', '!gateway/src/**', '!gateway/tsconfig*.json']) {
    assert.ok(rules.includes(rule), `missing gateway runtime support rule: ${rule}`);
  }
  assert.ok(!rules.includes('!gateway/**'), 'do not admit unrelated gateway artifacts');
  const sourceAdmission = rules.indexOf('!gateway/src/**');
  for (const rule of ['**/node_modules', '**/dist', '**/coverage', '**/.env', '**/.env.*', '**/*.pem', '**/*.key']) {
    assert.ok(rules.indexOf(rule) > sourceAdmission, `private/generated exclusion must follow source admission: ${rule}`);
  }
});
