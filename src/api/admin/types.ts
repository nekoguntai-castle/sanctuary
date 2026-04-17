/**
 * Admin API Types
 *
 * Type definitions for admin-only API calls
 */

// ========================================
// USER MANAGEMENT TYPES
// ========================================

export interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  isAdmin: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  email: string;
  isAdmin?: boolean;
}

export interface UpdateUserRequest {
  username?: string;
  password?: string;
  email?: string;
  isAdmin?: boolean;
}

// ========================================
// GROUP MANAGEMENT TYPES
// ========================================

export interface GroupMember {
  userId: string;
  username: string;
  role: string;
}

export interface AdminGroup {
  id: string;
  name: string;
  description: string | null;
  purpose: string | null;
  createdAt: string;
  updatedAt?: string;
  members: GroupMember[];
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
  purpose?: string;
  memberIds?: string[];
}

// ========================================
// SYSTEM SETTINGS TYPES
// ========================================

export interface SystemSettings {
  registrationEnabled: boolean;
  confirmationThreshold?: number;
  deepConfirmationThreshold?: number;
  dustThreshold?: number;
  // AI settings
  aiEnabled?: boolean;
  aiEndpoint?: string;
  aiModel?: string;
}

// ========================================
// BACKUP & RESTORE TYPES
// ========================================

export interface EncryptionKeysResponse {
  encryptionKey: string;
  encryptionSalt: string;
  hasEncryptionKey: boolean;
  hasEncryptionSalt: boolean;
}

export interface BackupMeta {
  version: string;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  createdBy: string;
  description?: string;
  includesCache: boolean;
  recordCounts: Record<string, number>;
}

export interface SanctuaryBackup {
  meta: BackupMeta;
  data: Record<string, unknown[]>;
}

export interface BackupOptions {
  includeCache?: boolean;
  description?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  warnings: string[];
  info: {
    createdAt: string;
    appVersion: string;
    schemaVersion: number;
    totalRecords: number;
    tables: string[];
  };
}

export interface RestoreResult {
  success: boolean;
  message?: string;
  tablesRestored: number;
  recordsRestored: number;
  warnings: string[];
  error?: string;
}

// ========================================
// AUDIT LOG TYPES
// ========================================

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  username: string;
  action: string;
  category: string;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  errorMsg: string | null;
  createdAt: string;
}

export interface AuditLogQuery {
  userId?: string;
  username?: string;
  action?: string;
  category?: string;
  success?: boolean;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogResult {
  logs: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditLogStats {
  totalEvents: number;
  byCategory: Record<string, number>;
  byAction: Record<string, number>;
  failedEvents: number;
}

// ========================================
// VERSION CHECK TYPES
// ========================================

export interface VersionInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  releaseName: string;
  publishedAt: string;
  releaseNotes: string;
}

// ========================================
// TOR CONTAINER TYPES
// ========================================

export interface TorContainerStatus {
  available: boolean;  // Docker proxy available
  exists: boolean;     // Container exists
  running: boolean;    // Container is running
  status: string;      // Container state (running, exited, etc.)
  message?: string;
}

export interface ContainerActionResponse {
  success: boolean;
  message: string;
}

// ========================================
// WEBSOCKET STATISTICS TYPES
// ========================================

export interface RateLimitEvent {
  timestamp: string;
  userId: string | null;
  reason: 'grace_period_exceeded' | 'per_second_exceeded' | 'subscription_limit';
  details: string;
}

export interface WebSocketStats {
  connections: {
    current: number;
    max: number;
    uniqueUsers: number;
    maxPerUser: number;
  };
  subscriptions: {
    total: number;
    channels: number;
    channelList: string[];
  };
  rateLimits: {
    maxMessagesPerSecond: number;
    gracePeriodMs: number;
    gracePeriodMessageLimit: number;
    maxSubscriptionsPerConnection: number;
  };
  recentRateLimitEvents: RateLimitEvent[];
}

// ========================================
// MONITORING TYPES
// ========================================

export interface MonitoringService {
  id: string;
  name: string;
  description: string;
  url: string;
  defaultPort: number;
  icon: string;
  isCustomUrl: boolean;
  status?: 'unknown' | 'healthy' | 'unhealthy';
}

export interface MonitoringServicesResponse {
  enabled: boolean;
  services: MonitoringService[];
}

export interface GrafanaConfig {
  username: string;
  passwordSource: 'GRAFANA_PASSWORD' | 'ENCRYPTION_KEY';
  password: string;
  anonymousAccess: boolean;
  anonymousAccessNote: string;
}

// ========================================
// FEATURE FLAG TYPES
// ========================================

export interface FeatureFlagInfo {
  key: string;
  enabled: boolean;
  description: string | null;
  category: string;
  source: 'environment' | 'database';
  modifiedBy: string | null;
  updatedAt: string | null;
  hasSideEffects?: boolean;
  sideEffectDescription?: string | null;
}

export interface FeatureFlagAuditEntry {
  id: string;
  key: string;
  previousValue: boolean;
  newValue: boolean;
  changedBy: string;
  reason: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface FeatureFlagAuditResult {
  entries: FeatureFlagAuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

// ========================================
// WALLET AGENT TYPES
// ========================================

export type WalletAgentStatus = 'active' | 'paused' | 'revoked';

export interface AgentApiKeyScope {
  allowedActions?: string[];
}

export interface AgentApiKeyMetadata {
  id: string;
  agentId: string;
  createdByUserId: string | null;
  name: string;
  keyPrefix: string;
  scope: AgentApiKeyScope;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  lastUsedAgent: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface WalletAgentWalletSummary {
  id: string;
  name: string;
  type: string;
  network: string;
}

export interface WalletAgentSignerDevice {
  id: string;
  label: string;
  fingerprint: string;
}

export interface WalletAgentMetadata {
  id: string;
  userId: string;
  name: string;
  status: WalletAgentStatus;
  fundingWalletId: string;
  operationalWalletId: string;
  signerDeviceId: string;
  maxFundingAmountSats: string | null;
  maxOperationalBalanceSats: string | null;
  dailyFundingLimitSats: string | null;
  weeklyFundingLimitSats: string | null;
  cooldownMinutes: number | null;
  requireHumanApproval: boolean;
  notifyOnOperationalSpend: boolean;
  pauseOnUnexpectedSpend: boolean;
  lastFundingDraftAt: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  user?: Pick<AdminUser, 'id' | 'username' | 'isAdmin'>;
  fundingWallet?: WalletAgentWalletSummary;
  operationalWallet?: WalletAgentWalletSummary;
  signerDevice?: WalletAgentSignerDevice;
  apiKeys?: AgentApiKeyMetadata[];
}

export interface CreateWalletAgentRequest {
  userId: string;
  name: string;
  fundingWalletId: string;
  operationalWalletId: string;
  signerDeviceId: string;
  status?: WalletAgentStatus;
  maxFundingAmountSats?: string;
  maxOperationalBalanceSats?: string;
  dailyFundingLimitSats?: string;
  weeklyFundingLimitSats?: string;
  cooldownMinutes?: number;
  requireHumanApproval?: boolean;
  notifyOnOperationalSpend?: boolean;
  pauseOnUnexpectedSpend?: boolean;
}

export interface UpdateWalletAgentRequest {
  name?: string;
  status?: WalletAgentStatus;
  maxFundingAmountSats?: string | null;
  maxOperationalBalanceSats?: string | null;
  dailyFundingLimitSats?: string | null;
  weeklyFundingLimitSats?: string | null;
  cooldownMinutes?: number | null;
  requireHumanApproval?: boolean;
  notifyOnOperationalSpend?: boolean;
  pauseOnUnexpectedSpend?: boolean;
}

export interface CreateAgentApiKeyRequest {
  name: string;
  allowedActions?: string[];
  expiresAt?: string;
}

export interface CreatedAgentApiKey extends AgentApiKeyMetadata {
  apiKey: string;
}

export interface AgentOptionUser extends Pick<AdminUser, 'id' | 'username' | 'email' | 'emailVerified' | 'isAdmin' | 'createdAt' | 'updatedAt'> {}

export interface AgentOptionWallet {
  id: string;
  name: string;
  type: string;
  network: string;
  accessUserIds: string[];
  deviceIds: string[];
}

export interface AgentOptionDevice {
  id: string;
  label: string;
  fingerprint: string;
  type: string;
  userId: string;
  walletIds: string[];
}

export interface AgentManagementOptions {
  users: AgentOptionUser[];
  wallets: AgentOptionWallet[];
  devices: AgentOptionDevice[];
}
