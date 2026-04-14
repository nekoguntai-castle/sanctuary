/**
 * Admin OpenAPI Schemas
 *
 * Schema definitions for administrative endpoints.
 */

import { adminCoreSettingsBackupSchemas } from './admin/core-settings-backup';
import { adminElectrumRuntimeSchemas } from './admin/electrum-runtime';
import { adminFeatureAuditSchemas } from './admin/features-audit';
import { adminIdentityGroupSchemas } from './admin/identity-groups';
import { adminOpsMonitoringNodeSchemas } from './admin/ops-monitoring-node';

export const adminSchemas = {
  ...adminCoreSettingsBackupSchemas,
  ...adminIdentityGroupSchemas,
  ...adminElectrumRuntimeSchemas,
  ...adminOpsMonitoringNodeSchemas,
  ...adminFeatureAuditSchemas,
} as const;
