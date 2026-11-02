import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceLabelOverlay } from '../../scripts/ownership/compose-resource-labels.mjs';

const composeLabels = {
  'com.docker.compose.config-hash': 'f'.repeat(64),
  'com.docker.compose.project': 'sanctuary',
  'com.docker.compose.version': '5.6.0',
};

const config = {
  volumes: {
    postgres_data: { name: 'sanctuary_postgres_data' },
    redis_data: { name: 'sanctuary_redis_data' },
    legacy_data: { name: 'sanctuary_legacy_data', external: true },
  },
  networks: {
    'sanctuary-network': { name: 'sanctuary_sanctuary-network' },
  },
};

test('re-declares existing volumes and networks with their creation labels', () => {
  const overlay = resourceLabelOverlay(config, {
    volumes: [
      { Name: 'sanctuary_redis_data', Labels: { ...composeLabels, 'io.sanctuary.created-at': '2026-10-13T05:03:49.000Z' } },
      { Name: 'sanctuary_postgres_data', Labels: {
        ...composeLabels, 'io.sanctuary.creation-run-id': 'run-1', 'io.runner-infra.owner-container': '',
      } },
    ],
    networks: [{ Name: 'sanctuary_sanctuary-network', Labels: { ...composeLabels, 'io.sanctuary.creation-run-id': 'run-1' } }],
  });
  assert.equal(overlay, [
    'volumes:',
    '  "postgres_data":',
    '    labels: !override',
    '      "io.runner-infra.owner-container": ""',
    '      "io.sanctuary.creation-run-id": "run-1"',
    '  "redis_data":',
    '    labels: !override',
    '      "io.sanctuary.created-at": "2026-10-13T05:03:49.000Z"',
    'networks:',
    '  "sanctuary-network":',
    '    labels: !override',
    '      "io.sanctuary.creation-run-id": "run-1"',
    '',
  ].join('\n'));
});

test('a resource created without ownership labels is re-declared with none', () => {
  assert.equal(
    resourceLabelOverlay(config, { volumes: [{ Name: 'sanctuary_postgres_data', Labels: composeLabels }] }),
    'volumes:\n  "postgres_data":\n    labels: !override {}\n',
  );
});

test('undeclared, external and missing resources are left out', () => {
  assert.equal(resourceLabelOverlay(config, {
    volumes: [
      { Name: 'sanctuary_tor_data', Labels: composeLabels },
      { Name: 'sanctuary_legacy_data', Labels: composeLabels },
      { Name: 'stray', Labels: null },
    ],
    networks: [],
  }), '');
  assert.equal(resourceLabelOverlay(config, {}), '');
  assert.equal(resourceLabelOverlay({}, { volumes: [{ Name: 'sanctuary_postgres_data', Labels: {} }] }), '');
});

test('label values that YAML would reinterpret stay strings', () => {
  const overlay = resourceLabelOverlay(config, { volumes: [{ Name: 'sanctuary_postgres_data', Labels: {
    'io.sanctuary.created-by-release': 'yes: #1 "quoted"\nline',
  } }] });
  assert.match(overlay, /"io.sanctuary.created-by-release": "yes: #1 \\"quoted\\"\\nline"\n$/);
});
