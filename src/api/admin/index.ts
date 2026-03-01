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
