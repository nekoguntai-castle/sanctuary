import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDatabase } from '../../integration/setup/testDatabase';
import { getTestPrisma } from '../../integration/repositories/setup/database';

// P2 `prepare-integration-db-no-production-guard`: both integration-test
// database bootstrappers must refuse a non-loopback, non-opt-in target
// before ever creating a Prisma client (so no connection is attempted).
// These assertions never touch a real database — the guard throws
// synchronously before `new PrismaPg(...)` / `client.$connect()` run — so
// they are safe to run as ordinary unit tests.
describe('integration-test database bootstrappers refuse non-test targets', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalTestDatabaseUrl = process.env.TEST_DATABASE_URL;
  const originalOptIn = process.env.SANCTUARY_ALLOW_INTEGRATION_DB_TARGET;

  beforeEach(() => {
    delete process.env.TEST_DATABASE_URL;
    delete process.env.SANCTUARY_ALLOW_INTEGRATION_DB_TARGET;
    process.env.DATABASE_URL = 'postgresql://u:p@prod-db.internal:5432/wallet';
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalTestDatabaseUrl === undefined) {
      delete process.env.TEST_DATABASE_URL;
    } else {
      process.env.TEST_DATABASE_URL = originalTestDatabaseUrl;
    }
    if (originalOptIn === undefined) {
      delete process.env.SANCTUARY_ALLOW_INTEGRATION_DB_TARGET;
    } else {
      process.env.SANCTUARY_ALLOW_INTEGRATION_DB_TARGET = originalOptIn;
    }
  });

  it('server/tests/integration/setup/testDatabase.ts refuses a production host', async () => {
    await expect(setupTestDatabase()).rejects.toThrow(
      /refusing to target integration database host "prod-db\.internal"/
    );
  });

  it('server/tests/integration/repositories/setup/database.ts refuses a production host', async () => {
    await expect(getTestPrisma()).rejects.toThrow(
      /refusing to target integration database host "prod-db\.internal"/
    );
  });
});
