import type { AdminUser } from './types';

export type WalletAgentStatus = 'active' | 'paused' | 'revoked';
export type AgentAlertSeverity = 'info' | 'warning' | 'critical';
export type AgentAlertStatus = 'open' | 'acknowledged' | 'resolved';

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
  minOperationalBalanceSats: string | null;
  largeOperationalSpendSats: string | null;
  largeOperationalFeeSats: string | null;
  repeatedFailureThreshold: number | null;
  repeatedFailureLookbackMinutes: number | null;
  alertDedupeMinutes: number | null;
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
  minOperationalBalanceSats?: string;
  largeOperationalSpendSats?: string;
  largeOperationalFeeSats?: string;
  repeatedFailureThreshold?: number;
  repeatedFailureLookbackMinutes?: number;
  alertDedupeMinutes?: number;
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
  minOperationalBalanceSats?: string | null;
  largeOperationalSpendSats?: string | null;
  largeOperationalFeeSats?: string | null;
  repeatedFailureThreshold?: number | null;
  repeatedFailureLookbackMinutes?: number | null;
  alertDedupeMinutes?: number | null;
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

export interface AgentAlertMetadata {
  id: string;
  agentId: string;
  walletId: string | null;
  type: string;
  severity: AgentAlertSeverity;
  status: AgentAlertStatus;
  txid: string | null;
  amountSats: string | null;
  feeSats: string | null;
  thresholdSats: string | null;
  observedCount: number | null;
  reasonCode: string | null;
  message: string;
  dedupeKey: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

export type AgentFundingOverrideStatus = 'active' | 'used' | 'revoked';

export interface AgentFundingOverrideMetadata {
  id: string;
  agentId: string;
  fundingWalletId: string;
  operationalWalletId: string;
  createdByUserId: string | null;
  reason: string;
  maxAmountSats: string;
  expiresAt: string;
  status: AgentFundingOverrideStatus;
  usedAt: string | null;
  usedDraftId: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentFundingOverrideRequest {
  maxAmountSats: string;
  expiresAt: string;
  reason: string;
}

export interface AgentWalletDashboardDraft {
  id: string;
  walletId: string;
  recipient: string;
  amountSats: string;
  feeSats: string;
  feeRate: number;
  status: string;
  approvalStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentWalletDashboardTransaction {
  id: string;
  txid: string;
  walletId: string;
  type: string;
  amountSats: string;
  feeSats: string | null;
  confirmations: number;
  blockTime: string | null;
  counterpartyAddress: string | null;
  createdAt: string;
}

export interface AgentWalletDashboardRow {
  agent: WalletAgentMetadata;
  operationalBalanceSats: string;
  pendingFundingDraftCount: number;
  openAlertCount: number;
  activeKeyCount: number;
  lastFundingDraft: AgentWalletDashboardDraft | null;
  lastOperationalSpend: AgentWalletDashboardTransaction | null;
  recentFundingDrafts: AgentWalletDashboardDraft[];
  recentOperationalSpends: AgentWalletDashboardTransaction[];
  recentAlerts: AgentAlertMetadata[];
}

export interface AgentOptionUser
  extends Pick<AdminUser, 'id' | 'username' | 'email' | 'emailVerified' | 'isAdmin' | 'createdAt' | 'updatedAt'> {}

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
