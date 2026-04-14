/**
 * Admin Routes Integration Tests
 *
 * HTTP-level tests for admin sub-routes using supertest.
 * Covers: users, groups, settings, backup, audit logs, etc.
 */

import { describe } from 'vitest';
import { registerAdminRoutesAuditVersionContracts } from './adminRoutes/adminRoutes.audit-version.contracts';
import { registerAdminRoutesDeleteContracts } from './adminRoutes/adminRoutes.delete.contracts';
import { registerAdminRoutesGroupContracts } from './adminRoutes/adminRoutes.groups.contracts';
import { registerAdminRoutesSettingsContracts } from './adminRoutes/adminRoutes.settings.contracts';
import { setupAdminRoutesTestHooks } from './adminRoutes/adminRoutesTestHarness';
import { registerAdminRoutesUserReadCreateContracts } from './adminRoutes/adminRoutes.users-read-create.contracts';
import { registerAdminRoutesUserUpdateDeleteContracts } from './adminRoutes/adminRoutes.users-update-delete.contracts';

describe('Admin Routes', () => {
  setupAdminRoutesTestHooks();

  registerAdminRoutesUserReadCreateContracts();
  registerAdminRoutesUserUpdateDeleteContracts();
  registerAdminRoutesGroupContracts();
  registerAdminRoutesSettingsContracts();
  registerAdminRoutesAuditVersionContracts();
  registerAdminRoutesDeleteContracts();
});
