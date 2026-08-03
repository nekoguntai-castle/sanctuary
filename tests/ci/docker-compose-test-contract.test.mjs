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
