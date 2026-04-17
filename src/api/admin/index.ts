/**
 * Admin API
 *
 * Re-exports for admin-only API functionality.
 * Barrel file preserving the public API surface from the original admin.ts module.
 */

// Types
export type {
  AdminUser,
  CreateUserRequest,
  UpdateUserRequest,
  GroupMember,
  AdminGroup,
  CreateGroupRequest,
  SystemSettings,
  EncryptionKeysResponse,
  BackupMeta,
  SanctuaryBackup,
  BackupOptions,
  ValidationResult,
  RestoreResult,
  AuditLogEntry,
  AuditLogQuery,
  AuditLogResult,
  AuditLogStats,
  VersionInfo,
  TorContainerStatus,
  ContainerActionResponse,
  RateLimitEvent,
  WebSocketStats,
  MonitoringService,
  MonitoringServicesResponse,
  GrafanaConfig,
  FeatureFlagInfo,
  FeatureFlagAuditEntry,
  FeatureFlagAuditResult,
  AgentApiKeyMetadata,
  AgentAlertMetadata,
  AgentAlertSeverity,
  AgentAlertStatus,
  AgentWalletDashboardDraft,
  AgentWalletDashboardRow,
  AgentWalletDashboardTransaction,
  AgentManagementOptions,
  AgentOptionDevice,
  AgentOptionUser,
  AgentOptionWallet,
  CreatedAgentApiKey,
  CreateAgentApiKeyRequest,
  CreateWalletAgentRequest,
  UpdateWalletAgentRequest,
  WalletAgentMetadata,
  WalletAgentSignerDevice,
  WalletAgentStatus,
  WalletAgentWalletSummary,
} from './types';

// User management
export { getUsers, createUser, updateUser, deleteUser } from './users';

// Group management
export {
  getGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  addGroupMember,
  removeGroupMember,
} from './groups';

// Settings, node config, Electrum servers, proxy
export {
  getSystemSettings,
  updateSystemSettings,
  getNodeConfig,
  updateNodeConfig,
  testNodeConfig,
  getElectrumServers,
  addElectrumServer,
  updateElectrumServer,
  deleteElectrumServer,
  testElectrumServer,
  reorderElectrumServers,
  testElectrumConnection,
  testProxy,
} from './settings';

// Backup, restore, audit logs, version check
export {
  getEncryptionKeys,
  createBackup,
  createBackupJson,
  validateBackup,
  restoreBackup,
  getAuditLogs,
  getAuditLogStats,
  checkVersion,
} from './backup';

// Monitoring, Grafana, WebSocket stats, Tor container
export {
  getMonitoringServices,
  updateMonitoringServiceUrl,
  getGrafanaConfig,
  updateGrafanaConfig,
  getWebSocketStats,
  getTorContainerStatus,
  startTorContainer,
  stopTorContainer,
} from './monitoring';

// Feature flags
export {
  getFeatureFlags,
  updateFeatureFlag,
  resetFeatureFlag,
  getFeatureFlagAuditLog,
} from './features';

// Wallet agents
export {
  getAgentWalletDashboard,
  getWalletAgents,
  getWalletAgentOptions,
  createWalletAgent,
  updateWalletAgent,
  revokeWalletAgent,
  getAgentAlerts,
  getAgentApiKeys,
  createAgentApiKey,
  revokeAgentApiKey,
} from './agents';

// Support package
export { downloadSupportPackage } from './supportPackage';
