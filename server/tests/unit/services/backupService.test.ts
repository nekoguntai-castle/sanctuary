/**
 * Backup Service Tests
 *
 * Tests for backup validation logic, serialization, and migration handling.
 * These tests focus on the validation and data transformation logic,
 * not actual database operations.
 */

import { registerBackupServiceCoreTests } from './backupService/backupService-core.contracts';
import { registerBackupAgentWalletMetadataTests } from './backupService/agent-wallet-metadata.contracts';
import { registerBackupDataStructureTests } from './backupService/data-structure.contracts';
import { registerBackupEdgeCaseTests } from './backupService/edge-cases.contracts';
import { registerBackupInternalHelperTests } from './backupService/internal-helpers.contracts';
import { registerBackupNodeConfigPasswordTests } from './backupService/node-config-password.contracts';
import { registerBackupRestoreErrorTests } from './backupService/restore-errors.contracts';
import { registerBackupRestoreTests } from './backupService/restore.contracts';
import { registerBackupSchemaMigrationTests } from './backupService/schema-migration.contracts';
import { registerBackupUser2faSecretTests } from './backupService/user-2fa-secret.contracts';
import { registerBackupValidationEdgeCaseTests } from './backupService/validation-edge-cases.contracts';

registerBackupServiceCoreTests();
registerBackupAgentWalletMetadataTests();
registerBackupDataStructureTests();
registerBackupRestoreTests();
registerBackupRestoreErrorTests();
registerBackupSchemaMigrationTests();
registerBackupEdgeCaseTests();
registerBackupNodeConfigPasswordTests();
registerBackupUser2faSecretTests();
registerBackupValidationEdgeCaseTests();
registerBackupInternalHelperTests();
