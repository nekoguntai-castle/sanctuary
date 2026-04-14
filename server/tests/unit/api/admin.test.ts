/**
 * Admin API Tests
 *
 * Comprehensive tests for admin-only endpoints including:
 * - User management
 * - Group management
 * - System settings
 * - Node configuration
 * - Backup/Restore
 * - Audit logs
 * - Version/Updates
 * - Electrum server management
 */

import { describe } from 'vitest';
import { registerAdminAuditVersionElectrumTests } from './admin/admin.audit-version-electrum.contracts';
import { registerAdminSettingsNodeBackupTests } from './admin/admin.settings-node-backup.contracts';
import { setupAdminApiTestHooks } from './admin/adminTestHarness';
import { registerAdminUsersGroupsTests } from './admin/admin.users-groups.contracts';

describe('Admin API', () => {
  setupAdminApiTestHooks();
  registerAdminUsersGroupsTests();
  registerAdminSettingsNodeBackupTests();
  registerAdminAuditVersionElectrumTests();
});
