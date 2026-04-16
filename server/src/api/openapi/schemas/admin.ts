/**
 * Admin OpenAPI Schemas
 *
 * Schema definitions for administrative endpoints.
 */

import { adminCoreSettingsBackupSchemas } from './admin/core-settings-backup';
import { adminElectrumRuntimeSchemas } from './admin/electrum-runtime';
import { adminFeatureAuditSchemas } from './admin/features-audit';
import { adminIdentityGroupSchemas } from './admin/identity-groups';
import { adminAgentSchemas } from './admin/agents';
import { adminMcpKeySchemas } from './admin/mcp-keys';
import { adminOpsMonitoringNodeSchemas } from './admin/ops-monitoring-node';

export const adminSchemas = {
  ...adminCoreSettingsBackupSchemas,
  ...adminIdentityGroupSchemas,
  ...adminElectrumRuntimeSchemas,
  ...adminOpsMonitoringNodeSchemas,
  ...adminFeatureAuditSchemas,
  ...adminAgentSchemas,
  ...adminMcpKeySchemas,
} as const;
