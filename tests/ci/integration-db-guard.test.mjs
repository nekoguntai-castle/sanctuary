// Regression coverage for the shared integration-DB target guard (P2 finding
// `prepare-integration-db-no-production-guard`). Exercises the pure module
// directly so the three call sites (scripts/ci/check-integration-db.mjs,
// server/tests/integration/repositories/setup/database.ts, and
// scripts/ci/resolve-postgres-service.sh's opt-in) all share one contract.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertAllowedIntegrationDbTarget,
  isAllowedIntegrationDbHost,
  redactDatabaseUrl,
} from '../../scripts/ci/integration-db-guard.mjs';

test('refuses a production-looking host', () => {
  assert.throws(
    () => assertAllowedIntegrationDbTarget('postgresql://u:p@prod-db.internal:5432/wallet'),
    /refusing to target integration database host "prod-db\.internal"/
  );
});

test('accepts loopback hosts', () => {
  for (const host of ['localhost', '127.0.0.1', '::1']) {
    const url =
      host === '::1'
        ? 'postgresql://u:p@[::1]:5432/wallet'
        : `postgresql://u:p@${host}:5432/wallet`;
    assert.doesNotThrow(() => assertAllowedIntegrationDbTarget(url));
  }
});

test('accepts the compose/CI "postgres" service alias', () => {
  assert.doesNotThrow(() =>
    assertAllowedIntegrationDbTarget('postgresql://u:p@postgres:5432/wallet')
  );
});

test('refuses a resolver-style gateway IP without the opt-in', () => {
  assert.throws(
    () => assertAllowedIntegrationDbTarget('postgresql://u:p@10.0.2.2:5432/wallet', {}),
    /refusing to target integration database host "10\.0\.2\.2"/
  );
});

test('accepts a resolver-style gateway IP once SANCTUARY_ALLOW_INTEGRATION_DB_TARGET=1 is set', () => {
  assert.doesNotThrow(() =>
    assertAllowedIntegrationDbTarget('postgresql://u:p@10.0.2.2:5432/wallet', {
      SANCTUARY_ALLOW_INTEGRATION_DB_TARGET: '1',
    })
  );
});

test('the opt-in does not do anything half-hearted — any non-"1" value still refuses', () => {
  assert.throws(
    () =>
      assertAllowedIntegrationDbTarget('postgresql://u:p@prod-db.internal:5432/wallet', {
        SANCTUARY_ALLOW_INTEGRATION_DB_TARGET: 'true',
      }),
    /refusing to target integration database host/
  );
});

test('rejects an unparseable URL instead of connecting to it', () => {
  assert.throws(() => assertAllowedIntegrationDbTarget('not-a-url', {}), /could not parse database URL/);
});

test('isAllowedIntegrationDbHost is case-insensitive and brackets-tolerant', () => {
  assert.equal(isAllowedIntegrationDbHost('LOCALHOST'), true);
  assert.equal(isAllowedIntegrationDbHost('[::1]'), true);
  assert.equal(isAllowedIntegrationDbHost('POSTGRES'), true);
  assert.equal(isAllowedIntegrationDbHost('prod-db.internal'), false);
});

test('redactDatabaseUrl hides the password', () => {
  assert.equal(
    redactDatabaseUrl('postgresql://user:secret@localhost:5432/db'),
    'postgresql://user:***@localhost:5432/db'
  );
});
