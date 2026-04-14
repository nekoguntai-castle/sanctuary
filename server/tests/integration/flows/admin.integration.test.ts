import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
/**
 * Admin API Integration Tests
 *
 * Tests admin-only endpoints for user and group management.
 * Uses real database transactions with rollback for isolation.
 */

import { createTestApp, resetTestApp } from '../setup/testServer';
import {
  setupTestDatabase,
  teardownTestDatabase,
  cleanupTestData,
  canRunIntegrationTests,
} from '../setup/testDatabase';
import { registerAdminAccessControlContracts } from './admin/access-control.contracts';
import { registerAdminAuditLoggingContracts } from './admin/audit.contracts';
import { registerAdminGroupManagementContracts } from './admin/groups.contracts';
import { setAdminIntegrationContext } from './admin/adminIntegrationTestHarness';
import { registerAdminUserManagementContracts } from './admin/users.contracts';

// Skip tests if no database available
const describeIfDb = canRunIntegrationTests() ? describe : describe.skip;

describeIfDb('Admin API Integration', () => {
  beforeAll(async () => {
    const app = createTestApp();
    const prisma = await setupTestDatabase();
    setAdminIntegrationContext(app, prisma);
  });

  afterAll(async () => {
    resetTestApp();
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  registerAdminUserManagementContracts();
  registerAdminGroupManagementContracts();
  registerAdminAuditLoggingContracts();
  registerAdminAccessControlContracts();
});
