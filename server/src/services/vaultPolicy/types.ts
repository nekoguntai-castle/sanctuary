/**
 * Vault Policy Types
 *
 * TypeScript interfaces for all vault policy configurations.
 */

// ========================================
// Policy Types
// ========================================

export type PolicyType =
  | 'spending_limit'
  | 'approval_required'
  | 'time_delay'
  | 'address_control'
  | 'velocity';

export type PolicyEnforcement = 'enforce' | 'monitor';

export type PolicySourceType = 'system' | 'group' | 'wallet';

export type ApprovalStatus =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'vetoed'
  | 'expired';

export type ApprovalRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'vetoed';

export type VoteDecision = 'approve' | 'reject' | 'veto';

export type QuorumType = 'any_n' | 'specific' | 'all';

export type WindowType = 'hourly' | 'daily' | 'weekly' | 'monthly';

export type AddressListType = 'allow' | 'deny';

// ========================================
// Policy Config Interfaces
// ========================================

export interface SpendingLimitConfig {
  /** Per-transaction limit in satoshis. 0 = no limit. */
  perTransaction?: number;
  /** Daily rolling limit in satoshis. 0 = no limit. */
  daily?: number;
  /** Weekly rolling limit in satoshis. 0 = no limit. */
  weekly?: number;
  /** Monthly rolling limit in satoshis. 0 = no limit. */
  monthly?: number;
  /** 'wallet' = shared budget, 'per_user' = individual budgets */
  scope: 'wallet' | 'per_user';
  /** Roles exempt from this limit */
  exemptRoles?: string[];
}

export interface ApprovalRequiredConfig {
  trigger: {
    /** Always require approval for any transaction */
    always?: boolean;
    /** Require approval for amounts above this threshold (satoshis) */
    amountAbove?: number;
    /** Only require approval for non-allowlisted addresses */
    unknownAddressesOnly?: boolean;
  };
  /** Number of approvals needed */
  requiredApprovals: number;
  /** Quorum type */
  quorumType: QuorumType;
  /** For 'specific' quorum: user IDs that must approve */
  specificApprovers?: string[];
  /** Can the transaction creator approve their own transaction? */
  allowSelfApproval: boolean;
  /** Auto-expire pending requests after this many hours (0 = never) */
  expirationHours: number;
}

export interface TimeDelayConfig {
  trigger: {
    always?: boolean;
    amountAbove?: number;
  };
  /** Cooling period in hours */
  delayHours: number;
  /** Who can veto during the delay */
  vetoEligible: 'any_approver' | 'specific';
  /** For 'specific': user IDs that can veto */
  specificVetoers?: string[];
  notifyOnStart: boolean;
  notifyOnVeto: boolean;
  notifyOnClear: boolean;
}

export interface AddressControlConfig {
  mode: 'allowlist' | 'denylist';
  /** Allow sending to own wallet addresses (change, consolidation) */
  allowSelfSend: boolean;
  /** Who can manage the address list */
  managedBy: 'owner_only' | 'approvers';
}

export interface VelocityConfig {
  maxPerHour?: number;
  maxPerDay?: number;
  maxPerWeek?: number;
  scope: 'wallet' | 'per_user';
  exemptRoles?: string[];
}

/** Union of all policy config types */
export type PolicyConfig =
  | SpendingLimitConfig
  | ApprovalRequiredConfig
  | TimeDelayConfig
  | AddressControlConfig
  | VelocityConfig;

// ========================================
// Service Input/Output Types
// ========================================

export interface CreatePolicyInput {
  walletId?: string;
  groupId?: string;
  name: string;
  description?: string | null;
  type: PolicyType;
  config: PolicyConfig;
  priority?: number;
  enforcement?: PolicyEnforcement;
  enabled?: boolean;
}

export interface UpdatePolicyInput {
  name?: string;
  description?: string | null;
  config?: PolicyConfig;
  priority?: number;
  enforcement?: PolicyEnforcement;
  enabled?: boolean;
}

export interface PolicyEvaluationInput {
  walletId: string;
  userId: string;
  recipient: string;
  amount: bigint;
  outputs?: Array<{ address: string; amount: number }>;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  triggered: Array<{
    policyId: string;
    policyName: string;
    type: PolicyType;
    action: 'approval_required' | 'blocked' | 'monitored';
    reason: string;
  }>;
  limits?: {
    daily?: { used: number; limit: number; remaining: number };
    weekly?: { used: number; limit: number; remaining: number };
    monthly?: { used: number; limit: number; remaining: number };
    perTransaction?: { limit: number };
  };
}

export interface CreateApprovalVoteInput {
  decision: VoteDecision;
  reason?: string;
}

// ========================================
// Validation Constants
// ========================================

export const VALID_POLICY_TYPES = [
  'spending_limit',
  'approval_required',
  'time_delay',
  'address_control',
  'velocity',
] as const satisfies readonly PolicyType[];

export const VALID_ENFORCEMENT_MODES = ['enforce', 'monitor'] as const satisfies readonly PolicyEnforcement[];

export const VALID_SOURCE_TYPES: PolicySourceType[] = ['system', 'group', 'wallet'];

export const VALID_VOTE_DECISIONS = ['approve', 'reject', 'veto'] as const satisfies readonly VoteDecision[];

export const VALID_QUORUM_TYPES: QuorumType[] = ['any_n', 'specific', 'all'];

export const VALID_ADDRESS_LIST_TYPES = ['allow', 'deny'] as const satisfies readonly AddressListType[];
