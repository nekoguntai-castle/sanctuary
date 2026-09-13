#!/usr/bin/env node
// Shared guard for every integration-DB entry point (P2 finding
// `prepare-integration-db-no-production-guard`).
//
// `scripts/ci/prepare-integration-db.sh` (via `check-integration-db.mjs`) and
// `server/tests/integration/repositories/setup/database.ts` both resolve
// `TEST_DATABASE_URL || DATABASE_URL` and connect/migrate with no check on
// *what* that URL points at. A misconfigured environment (a stray
// `DATABASE_URL` pointing at a real deployment, for example) could otherwise
// have its schema migrated and its data wiped by `cleanupTestData()`.
//
// This module is the single source of truth for "is this URL an acceptable
// integration-test target": loopback hosts, the `postgres` compose/CI
// service alias, or an explicit operator opt-in via
// `SANCTUARY_ALLOW_INTEGRATION_DB_TARGET=1`. `scripts/ci/resolve-postgres-service.sh`
// sets that opt-in itself, once (and only once) it has proven the resolved
// host with an authenticated `SELECT 1` — see `ci_emit_env` calls there.
//
// Usable three ways:
//   - imported from Node/ESM code (`check-integration-db.mjs`):
//       import { assertAllowedIntegrationDbTarget } from './integration-db-guard.mjs';
//   - imported from TypeScript under `bundler`/`node` module resolution
//     (`server/tests/integration/repositories/setup/database.ts`).
//   - invoked directly as a CLI for shell-level tests:
//       node scripts/ci/integration-db-guard.mjs '<database-url>'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const COMPOSE_SERVICE_HOST = 'postgres';

/** Redacts credentials from a connection URL for safe logging. */
export function redactDatabaseUrl(url) {
  return url.replace(/(\/\/[^:/?#]+:)[^@]*@/, '$1***@');
}

function normalizeHostname(hostname) {
  // `new URL(...).hostname` already strips the brackets around a literal
  // IPv6 address (e.g. `::1`), but normalize defensively in case a caller
  // passes an already-parsed hostname through.
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

/**
 * Returns true when `hostname` is an acceptable integration-test database
 * host on its own — without consulting the opt-in override.
 */
export function isAllowedIntegrationDbHost(hostname) {
  const normalized = normalizeHostname(hostname);
  return LOOPBACK_HOSTS.has(normalized) || normalized === COMPOSE_SERVICE_HOST;
}

/**
 * Throws a clear, actionable error unless `url` is an acceptable
 * integration-test database target. Accepts a URL when:
 *   - its host is loopback (`localhost` / `127.0.0.1` / `::1`), or
 *   - its host is the compose/CI Postgres service alias (`postgres`), or
 *   - `env.SANCTUARY_ALLOW_INTEGRATION_DB_TARGET === '1'` (an explicit,
 *     already-proven opt-in — see `resolve-postgres-service.sh`).
 *
 * Never connects or performs I/O; this is a pure precondition check that
 * every guarded entry point must call before any migrate/connect.
 */
export function assertAllowedIntegrationDbTarget(url, env = process.env) {
  if (env.SANCTUARY_ALLOW_INTEGRATION_DB_TARGET === '1') {
    return;
  }

  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`integration-db-guard: could not parse database URL: ${message}`);
  }

  if (isAllowedIntegrationDbHost(hostname)) {
    return;
  }

  throw new Error(
    `integration-db-guard: refusing to target integration database host "${hostname}" ` +
      '(only localhost, 127.0.0.1, ::1, or the "postgres" compose/CI service are allowed). ' +
      'Set SANCTUARY_ALLOW_INTEGRATION_DB_TARGET=1 to override deliberately.'
  );
}

function isMainModule() {
  return process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
}

if (isMainModule()) {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: integration-db-guard.mjs <database-url>');
    process.exit(2);
  }
  try {
    assertAllowedIntegrationDbTarget(url);
    console.log(`integration-db-guard: allowed ${redactDatabaseUrl(url)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
